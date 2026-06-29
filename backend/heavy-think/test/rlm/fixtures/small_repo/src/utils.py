# utils.py — small fixture for rlm() tests

def to_dict(obj):
    """Convert an object with __dict__ to a dict."""
    return obj.__dict__


def parse_int(s, default=0):
    """Parse a string to int, returning default on failure."""
    try:
        return int(s)
    except (TypeError, ValueError):
        return default


def format_error(msg, code=400):
    """Format an error response."""
    return {'error': msg, 'code': code}