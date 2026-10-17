"""Independent FastAPI process, using the same environment as the launcher."""
from dotenv import load_dotenv


def main():
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
