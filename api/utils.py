import os

def deepwiki_root() -> str:
    path = os.path.abspath(os.path.expanduser(os.environ.get("DEEPWIKI_DATA_DIR") or
        os.path.join(os.path.dirname(os.path.dirname(__file__)), ".local", "deepwiki-data")))
    if not os.path.exists(path):
        os.makedirs(path, exist_ok=True)
    return path
