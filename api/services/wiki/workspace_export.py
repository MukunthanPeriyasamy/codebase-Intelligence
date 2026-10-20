"""Write a durable reference copy after successful local wiki generation."""
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid4


def save_workspace_document(request, title, pages):
    if request.type != 'local':
        return None
    root = Path(request.repo_url).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError('Documentation workspace is not a directory')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    target = root / f'deepwiki-document-{stamp}-{uuid4().hex[:8]}.md'
    content = f'# {title}\n\nWorkspace: {root}\n\nLanguage: {request.language}\n\n'
    content += '\n\n---\n\n'.join(f'## {page.title}\n\n{page.content}' for page in pages.values())
    # Exclusive creation preserves previous exports and refuses existing links.
    try:
        with target.open('x', encoding='utf-8') as output:
            output.write(content)
    except OSError as exc:
        raise OSError(f'Document index/cache saved, but workspace export failed: {root}. Check directory write permissions.') from exc
    return str(target)
