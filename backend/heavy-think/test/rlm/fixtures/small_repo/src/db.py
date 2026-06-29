# db.py — small fixture for rlm() tests

import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data.json')


def load_db():
    if not os.path.exists(DB_PATH):
        return {}
    with open(DB_PATH, 'r') as f:
        return json.load(f)


def save_db(db):
    with open(DB_PATH, 'w') as f:
        json.dump(db, f)