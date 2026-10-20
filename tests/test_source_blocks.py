from api.services.source_blocks import locate_snippet, ground_blocks


def test_exact_unique_match_recovers_real_lines():
    source = 'header\r\ndef run():\r\n    return 1\r\n'
    assert locate_snippet(source, 'def run():\n    return 1', strict=True) == (2, 3)
    blocks = ground_blocks([{'path': 'a.py', 'snippet': 'def run():\n    return 1'}], {'a.py': source}, {'a.py': {1, 2, 3}})
    assert blocks[0]['start_line'] == 2
    assert blocks[0]['code'].startswith('2: def run():')


def test_duplicate_partial_and_hidden_blocks_rejected():
    assert locate_snippet('return 1\nreturn 1', 'return 1', strict=True) is None
    assert locate_snippet('def run():\n    return 1', 'def run():\n    return 2', strict=True) is None
    assert not ground_blocks([{'path': 'a.py', 'snippet': 'second'}], {'a.py': 'first\nsecond'}, {'a.py': {1}})
    assert not ground_blocks([{'path': '../a.py', 'snippet': 'first'}], {'a.py': 'first'}, {'a.py': {1}})
