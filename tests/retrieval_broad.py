"""Deterministic retrieval checks; model quality is evaluated separately."""
import hashlib
import json
import sqlite3
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
from retrieval import retrieve

files = {
    "README.md": "# Parcel service\nAccepts shipment requests through an HTTP API.\nStart with python server.py.\n",
    "pyproject.toml": '[project]\nname = "parcel"\ndependencies = ["fastapi"]\n',
    "server.py": "from fastapi import FastAPI\napp = FastAPI()\n",
    "settings.py": "import os\nPORT = int(os.getenv('PORT', '8080'))\n",
    "auth.py": "def authorize(user):\n    if not user:\n        raise PermissionError('Sign in required')\n    return True\n",
    "storage.py": "import sqlite3\ndef save_order(order):\n    with sqlite3.connect('orders.db') as db:\n        db.execute('insert into orders values (?)', (order,))\n",
    "tests/test_auth.py": "def test_anonymous_rejected():\n    with raises(PermissionError):\n        authorize(None)\n",
}
db = sqlite3.connect(":memory:"); db.row_factory = sqlite3.Row
db.execute("CREATE TABLE files(path, hash, size, status, symbols, calls)")
for path, source in files.items():
    db.execute("INSERT INTO files VALUES(?,?,?,?,?,?)", (path, hashlib.sha256(source.encode()).hexdigest(), len(source), "parsed", "[]", "[]"))

def check(question, expected):
    result = retrieve(db, None, {"question": question}, lambda _, row: files[row['path']].splitlines())
    paths = {item['path'] for item in result['units']}
    assert expected <= paths, (question, paths)
    assert not result['exact']
    for item in result['units']:
        assert 1 <= item['start'] <= item['end'] <= len(files[item['path']].splitlines())

check("What is this codebase about?", {"README.md", "pyproject.toml", "server.py"})
check("How do I launch the application?", {"README.md"})
check("How can I change the listening port?", {"settings.py"})
check("How is access secured?", {"auth.py"})
check("Which libraries does this project use?", {"pyproject.toml"})
check("Where does it persist orders?", {"storage.py"})
check("How can I verify anonymous users are rejected?", {"tests/test_auth.py"})
result = retrieve(db, None, {"question": "unicorn_quantum_feature_987"}, lambda _, row: files[row['path']].splitlines())
assert result['units'] == [], result
print("8 broad retrieval checks passed")
