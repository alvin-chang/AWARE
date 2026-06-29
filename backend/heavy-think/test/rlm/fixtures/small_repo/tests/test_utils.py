# test_utils.py — fixture test file

from src.utils import parse_int, format_error


def test_parse_int_ok():
    assert parse_int('42') == 42


def test_parse_int_default():
    assert parse_int('notanumber', default=99) == 99


def test_format_error():
    r = format_error('oops', code=500)
    assert r['code'] == 500