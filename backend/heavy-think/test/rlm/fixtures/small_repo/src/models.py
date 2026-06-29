# models.py — small fixture for rlm() tests

class User:
    def __init__(self, name, email):
        self.name = name
        self.email = email

    def to_dict(self):
        return {'name': self.name, 'email': self.email}


class Session:
    def __init__(self, token, user):
        self.token = token
        self.user = user

    def is_valid(self):
        return bool(self.token)