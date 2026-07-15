"""
Firebase Admin SDK bootstrap.

Supports two ways to supply the service account credentials, checked in order:
  1. FIREBASE_SERVICE_ACCOUNT_JSON — the full JSON key pasted as one env var
     value. This is the simplest option on Render: paste it into the
     Environment tab, no file upload needed.
  2. FIREBASE_SERVICE_ACCOUNT_PATH — a path to the JSON key file on disk.
     On Render this can point at a Secret File (mounted under /etc/secrets/).

Exposes `db` (Firestore client) and `auth` for use across the app.
"""
import json
import os

import firebase_admin
from firebase_admin import credentials, firestore, auth as firebase_auth

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_credentials():
    raw_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")
    if raw_json:
        try:
            return credentials.Certificate(json.loads(raw_json))
        except (json.JSONDecodeError, ValueError) as e:
            raise ValueError(
                "FIREBASE_SERVICE_ACCOUNT_JSON is set but isn't valid JSON. "
                "Paste the full contents of your service account key file, unmodified."
            ) from e

    path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH")
    if not path:
        raise FileNotFoundError(
            "No Firebase credentials configured. Set either FIREBASE_SERVICE_ACCOUNT_JSON "
            "(paste the full key file contents) or FIREBASE_SERVICE_ACCOUNT_PATH "
            "(a path to the key file) in your environment. See README.md > Firebase setup."
        )
    if not os.path.isabs(path):
        path = os.path.join(_BASE_DIR, path)
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"FIREBASE_SERVICE_ACCOUNT_PATH is set to '{path}' but no file exists there."
        )
    return credentials.Certificate(path)


if not firebase_admin._apps:
    firebase_admin.initialize_app(_load_credentials())

db = firestore.client()
auth = firebase_auth
