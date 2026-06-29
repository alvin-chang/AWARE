# api.py — small fixture for rlm() tests

from .auth import authenticate


def handle_login(request):
    user = request.get('user')
    pw = request.get('password')
    if authenticate(user, pw):
        return {'status': 'ok', 'user': user}
    return {'status': 'denied'}


def handle_logout(session):
    session.pop('user', None)
    return {'status': 'ok'}