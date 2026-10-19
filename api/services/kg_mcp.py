"""Persistent, isolated CodeGraphContext MCP stdio connection for the chat sandbox.

No graph code is imported into the API process. Configuration is operator-owned.
"""
import atexit
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time

from jsonschema import validate


READ_ONLY = {
    "find_code", "analyze_code_relationships", "find_dead_code",
    "calculate_cyclomatic_complexity", "find_most_complex_functions",
    "list_indexed_repositories", "check_job_status", "list_jobs",
    "list_watched_paths", "get_repository_stats", "list_graphs",
    "find_java_spring_endpoints", "find_java_spring_beans", "find_datasource_nodes",
}


class GraphMCP:
    def __init__(self):
        self.lock = threading.RLock()
        self.process = None
        self.counter = 0
        self.tools = []
        self.workspace = ""
        self.log = None

    def close(self):
        with self.lock:
            if self.process is not None:
                if self.process.poll() is None:
                    self.process.terminate()
                    try:
                        self.process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        self.process.kill()
                        self.process.wait()
                for stream in (self.process.stdin, self.process.stdout):
                    if stream:
                        stream.close()
            self.process = None
            self.tools = []
            if self.log:
                self.log.close()
                self.log = None

    def _request(self, method, params):
        self.counter += 1
        request_id = self.counter
        self.process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": request_id,
                                            "method": method, "params": params}) + "\n")
        self.process.stdin.flush()
        deadline = time.monotonic() + 90
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("KG command timed out. Its outcome is unknown; check jobs before retrying.")
            try:
                line = self.messages.get(timeout=remaining)
            except queue.Empty as exc:
                raise TimeoutError("KG server timed out; check jobs before retrying.") from exc
            if line is None:
                raise RuntimeError("KG MCP server stopped. See .local/logs/kg-mcp.log")
            try:
                message = json.loads(line)
            except ValueError:
                continue  # Some CGC releases emit startup diagnostics to stdout.
            if message.get("id") != request_id:
                continue
            if "error" in message:
                raise RuntimeError(str(message["error"].get("message", message["error"])))
            return message.get("result", {})

    def connect(self):
        if self.process is not None and self.process.poll() is None:
            return
        self.close()
        path = Path(os.getenv("DEEPWIKI_KG_CONFIG", ".local/kg-mcp.json"))
        if not path.is_file():
            raise RuntimeError("KG is not configured. Create .local/kg-mcp.json using config/kg-mcp.example.json.")
        config = json.loads(path.read_text(encoding="utf-8-sig"))
        self.workspace = str(Path(config["cwd"]).resolve(strict=True))
        log_path = Path(".local/logs/kg-mcp.log")
        log_path.parent.mkdir(parents=True, exist_ok=True)
        self.log = log_path.open("a", encoding="utf-8")
        self.process = subprocess.Popen(
            [config["command"], *config.get("args", [])], cwd=self.workspace,
            env={**os.environ, **config.get("env", {})}, shell=False,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log,
            text=True, encoding="utf-8", errors="replace", bufsize=1,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        self.messages = queue.Queue()
        messages, stream = self.messages, self.process.stdout

        def read():
            try:
                for line in stream:
                    messages.put(line)
            finally:
                messages.put(None)

        threading.Thread(target=read, daemon=True).start()
        try:
            self._request("initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                                         "clientInfo": {"name": "deepwiki-kg-chat", "version": "1.0"}})
            self.process.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
            self.process.stdin.flush()
            self.tools = self._request("tools/list", {}).get("tools", [])
        except Exception:
            self.close()
            raise

    def catalog(self):
        with self.lock:
            self.connect()
            return {"workspace": self.workspace, "tools": [
                {**tool, "requires_confirmation": tool["name"] not in READ_ONLY}
                for tool in self.tools
            ]}

    def call(self, name, arguments, confirmed=False):
        with self.lock:
            self.connect()
            tool = next((t for t in self.tools if t["name"] == name), None)
            if tool is None:
                raise ValueError("Unknown KG command; refresh the command list")
            if name not in READ_ONLY and not confirmed:
                raise ValueError("Confirm this operation before running it")
            validate(arguments, tool.get("inputSchema", {"type": "object"}))
            # CGC stores source paths with '/' even on Windows. Its query filters
            # do not consistently normalize user-provided repository paths.
            arguments = {key: value.replace('\\', '/') if isinstance(value, str)
                         and (key == 'path' or key.endswith('_path')) else value
                         for key, value in arguments.items()}
            try:
                return self._request("tools/call", {"name": name, "arguments": arguments})
            except (TimeoutError, BrokenPipeError):
                self.close()
                raise


graph = GraphMCP()
atexit.register(graph.close)
