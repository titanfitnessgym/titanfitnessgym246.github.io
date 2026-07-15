"""
Shared helpers: token verification decorators, atomic Member ID generation,
and small response/formatting utilities used across routes.
"""
import datetime
from functools import wraps
from flask import request, jsonify, g
from firebase_config import db, auth


def verify_token(f):
    """Requires a valid Firebase ID token in the Authorization: Bearer <token> header.
    Attaches the decoded token to flask.g.user (contains uid, and any custom claims)."""

    @wraps(f)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify({"error": "Missing or malformed Authorization header"}), 401
        id_token = header.split("Bearer ")[1]
        try:
            decoded = auth.verify_id_token(id_token)
        except Exception as e:
            return jsonify({"error": "Invalid or expired token", "detail": str(e)}), 401
        g.user = decoded
        return f(*args, **kwargs)

    return wrapper


def require_admin(f):
    """Stack after @verify_token. Requires the decoded token to carry role=admin
    (set via custom claims — see /api/admin/bootstrap-first-admin for how to set it)."""

    @wraps(f)
    def wrapper(*args, **kwargs):
        if getattr(g, "user", None) is None:
            return jsonify({"error": "Unauthenticated"}), 401
        if g.user.get("role") not in ("admin", "owner", "manager", "receptionist"):
            return jsonify({"error": "Admin privileges required"}), 403
        return f(*args, **kwargs)

    return wrapper


def generate_member_id():
    """Atomically generates the next sequential Member ID, e.g. TITAN-2026-0001.
    Uses a Firestore transaction against counters/members so concurrent
    registrations never collide or skip.
    """
    year = datetime.datetime.now().year
    counter_ref = db.collection("counters").document(f"members_{year}")

    from google.cloud import firestore as gc_firestore

    transaction = db.transaction()

    @gc_firestore.transactional
    def _txn(transaction, ref):
        snapshot = ref.get(transaction=transaction)
        current = snapshot.get("count") if snapshot.exists else 0
        current = current or 0
        next_val = current + 1
        transaction.set(ref, {"count": next_val}, merge=True)
        return next_val

    next_number = _txn(transaction, counter_ref)
    return f"TITAN-{year}-{str(next_number).zfill(4)}"


def error_response(message, status=400, **extra):
    payload = {"error": message}
    payload.update(extra)
    return jsonify(payload), status


def success_response(data=None, message=None, status=200):
    payload = {"success": True}
    if message:
        payload["message"] = message
    if data is not None:
        payload["data"] = data
    return jsonify(payload), status
