"""Version-one private transport. No repository operations or model calls yet."""
import argparse
import json
import sqlite3
import sys
import uuid
from pathlib import Path


def emit(message):
    print(json.dumps({"v": 1, **message}), flush=True)


def initialize_storage(directory):
    directory.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(directory / "metadata.sqlite3", timeout=5)
    try:
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, 1):
            raise ValueError("Unsupported schema")
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Invalid database")
        connection.execute("PRAGMA journal_mode=WAL")
        with connection:
            connection.execute("CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            connection.execute("INSERT OR IGNORE INTO app_metadata VALUES ('schema_version', '1')")
            if connection.execute("SELECT value FROM app_metadata WHERE key='schema_version'").fetchone() != ('1',):
                raise ValueError("Invalid metadata")
            connection.execute("PRAGMA user_version=1")
        return connection
    except Exception:
        connection.close()
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    args = parser.parse_args()
    if sys.version_info[:2] != (3, 12):
        emit({"type": "error", "code": "RUNTIME_VERSION"})
        return 1
    try:
        connection = initialize_storage(args.data_dir)
    except Exception:
        emit({"type": "error", "code": "STORAGE_INIT"})
        return 1
    try:
        emit({"type": "ready", "python": ".".join(map(str, sys.version_info[:3])), "schema": 1})
        while True:
            line = sys.stdin.buffer.readline(65537)
            if not line:
                return 0
            try:
                if len(line) > 65536 or not line.endswith(b'\n'):
                    raise ValueError("Message limit")
                message = json.loads(line)
                if not isinstance(message, dict) or type(message.get('v')) is not int or message['v'] != 1:
                    raise ValueError("Version")
                if message.get('type') == 'shutdown' and set(message) == {'v', 'type'}:
                    return 0
                if message.get('type') != 'ping' or set(message) != {'v', 'type', 'id'}:
                    raise ValueError("Request")
                if not isinstance(message['id'], str) or str(uuid.UUID(message['id'])) != message['id']:
                    raise ValueError("ID")
                emit({"type": "pong", "id": message['id']})
            except (ValueError, TypeError, KeyError):
                emit({"type": "error", "code": "REQUEST_INVALID"})
                return 1
    finally:
        connection.close()


if __name__ == '__main__':
    sys.exit(main())
