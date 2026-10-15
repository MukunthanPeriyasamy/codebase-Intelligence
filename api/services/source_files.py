"""Bounded read access shared by document cross-checking and reviewed edits."""
from pathlib import Path, PurePosixPath
import re

MAX_FILE = 100_000


def safe_path(root: Path, name: str) -> Path:
    parts = PurePosixPath(name).parts
    if (not parts or PurePosixPath(name).is_absolute() or name != "/".join(parts)
            or "\\" in name or ":" in name
            or any(p in (".", "..") or p.lower() == ".git" or p.endswith((".", " "))
                   or re.fullmatch(r"(?i)(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?", p)
                   for p in parts)):
        raise ValueError("Invalid repository-relative path")
    target = root.joinpath(*parts)
    if not target.resolve().is_relative_to(root):
        raise ValueError("Path escapes the repository")
    current = root
    for part in parts:
        current /= part
        if current.is_symlink() or (hasattr(current, "is_junction") and current.is_junction()):
            raise ValueError("Linked paths cannot be edited")
    return target


def read_source(path: Path) -> str | None:
    if not path.exists():
        return None
    if not path.is_file() or path.stat().st_size > MAX_FILE:
        raise ValueError("Only text files up to 100 KB can be edited")
    text = path.read_bytes().decode("utf-8")
    if "\0" in text:
        raise ValueError("Binary files cannot be edited")
    return text
