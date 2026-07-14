"""
Firebase Admin SDK bootstrap.
Loads the service account key and exposes `db` (Firestore client) and `auth`
for use across the app.
"""
import os
import firebase_admin
from firebase_admin import credentials, firestore, auth as firebase_auth

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_SERVICE_ACCOUNT_PATH = os.path.join(
    _BASE_DIR,
    "titan-gym-10f7b-firebase-adminsdk-fbsvc-afb3c9a8d2.json",
)

_SERVICE_ACCOUNT_PATH = os.environ.get(
    "FIREBASE_SERVICE_ACCOUNT_PATH", _DEFAULT_SERVICE_ACCOUNT_PATH
)
if not os.path.isabs(_SERVICE_ACCOUNT_PATH):
    _SERVICE_ACCOUNT_PATH = os.path.join(_BASE_DIR, _SERVICE_ACCOUNT_PATH)

if not firebase_admin._apps:
    if not os.path.exists(_SERVICE_ACCOUNT_PATH):
        raise FileNotFoundError(
            f"Firebase service account key not found at '{_SERVICE_ACCOUNT_PATH}'. "
            "Download it from Firebase Console > Project Settings > Service Accounts "
            "and set FIREBASE_SERVICE_ACCOUNT_PATH in your .env file."
        )
    cred = credentials.Certificate(_SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred)

db = firestore.client()
auth = firebase_auth
