# test_auth.py — fixture test file (intentionally minimal so 'untested modules' is detectable)

from src.auth import authenticate


def test_authenticate_ok():
    assert authenticate('alice', 'secret1') is True


def test_authenticate_fail():
    assert authenticate('alice', 'wrong') is False