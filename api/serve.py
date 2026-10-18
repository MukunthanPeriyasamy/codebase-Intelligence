"""Independent FastAPI process, using the same environment as the launcher."""
import faulthandler
from pathlib import Path
from dotenv import load_dotenv


def main():
    # Keep the file open throughout the process, including native-extension crashes.
    crash_dir = Path(__file__).resolve().parent.parent / '.local' / 'logs'
    crash_dir.mkdir(parents=True, exist_ok=True)
    crash_log = (crash_dir / 'backend-fault.log').open('a', encoding='utf-8')
    faulthandler.enable(file=crash_log, all_threads=True)
    print(f'Native crash diagnostics: {crash_log.name}', flush=True)
    load_dotenv()
    from api.services.document_store import client
    try:
        client().heartbeat()
    except Exception as exc:
        raise SystemExit(f'Backend storage preflight failed: {exc}. Run scripts/setup-deepwiki.ps1.') from exc
    import uvicorn
    uvicorn.run('api.main:app', host='127.0.0.1', port=8001)


if __name__ == '__main__':
    main()
