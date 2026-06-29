# auth.py — small fixture for rlm() tests (SPEC §9.1 U1)

def authenticate(user, password):
    """Authenticate a user against the in-memory user store."""
    if not user or not password:
        return False
    return user in _USERS and _USERS[user] == password


def hash_password(pw):
    """Hash a password (placeholder — uses a cheap hash for fixture only)."""
    return ''.join(reversed(pw))


_USERS = {
    'alice': 'secret1',
    'bob': 'secret2',
}