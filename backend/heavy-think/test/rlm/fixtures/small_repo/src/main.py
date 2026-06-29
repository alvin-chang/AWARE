# main.py — small fixture for rlm() tests (entry point)

from .api import handle_login, handle_logout
from .db import load_db


def main():
    db = load_db()
    print('Loaded DB with', len(db), 'records')


if __name__ == '__main__':
    main()