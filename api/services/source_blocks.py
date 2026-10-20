"""Shared source-snippet grounding for Code Map and edit planning."""
def locate_snippet(text, snippet, *, strict=False):
    text = text.replace('\r\n', '\n')
    snippet = snippet.replace('\r\n', '\n').strip('\n')
    if not snippet:
        return None
    pos = text.find(snippet)
    if pos >= 0 and (not strict or text.count(snippet) == 1):
        start = text.count('\n', 0, pos) + 1
        return start, start + snippet.count('\n')
    if strict:
        return None
    first = next((line.strip() for line in snippet.splitlines() if line.strip()), '')
    if first and (pos := text.find(first)) >= 0:
        start = text.count('\n', 0, pos) + 1
        return start, start + snippet.count('\n')
    return None


def ground_blocks(blocks, sources, visible):
    grounded = []
    for block in blocks[:12]:
        if not isinstance(block, dict):
            continue
        name, snippet = block.get('path'), block.get('snippet')
        if not isinstance(name, str) or name not in sources or not isinstance(snippet, str):
            continue
        location = locate_snippet(sources[name], snippet, strict=True)
        if location and set(range(location[0], location[1] + 1)) <= visible[name]:
            start, end = location
            lines = sources[name].splitlines()[start-1:end]
            grounded.append({'path': name, 'start_line': start, 'end_line': end,
                             'code': '\n'.join(f'{start+i}: {line}' for i, line in enumerate(lines))})
    return grounded
