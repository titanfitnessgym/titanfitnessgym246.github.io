"""
Titan Fitness Management System — Flask backend.

Covers PRD sections: Auth/Registration (4), Login support (5), Member data (6),
Admin dashboard stats (7), Member management (8), Admissions (9), Plans (10),
Attendance (12), Trainers (13), Announcements (17), Reports (18).

Run: `python app.py` (dev) or `gunicorn app:app` (prod).
"""
import os
import datetime
from zoneinfo import ZoneInfo

from flask import Flask, request, g
from flask_cors import CORS
from dotenv import load_dotenv

from firebase_config import db, auth
from utils import verify_token, require_admin, generate_member_id, error_response, success_response

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-key-change-me")
frontend_origin = os.environ.get("FRONTEND_ORIGIN", "http://localhost:5500")
allowed_origins = [frontend_origin, "http://localhost:5500", "http://127.0.0.1:5500"]
CORS(app, origins="*", supports_credentials=True)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return success_response({"status": "ok", "time": datetime.datetime.utcnow().isoformat()})


def _parse_local_datetime(date_value, time_value):
    if not date_value:
        return None
    time_part = time_value or "00:00"
    try:
        return datetime.datetime.fromisoformat(f"{date_value}T{time_part}")
    except ValueError:
        return None


def sync_expired_memberships():
    try:
        now = datetime.datetime.utcnow()
        updated = 0
        for doc in db.collection("users").stream():
            data = doc.to_dict() or {}
            membership = data.get("membership", {})
            renewal_date = membership.get("renewalDate")
            if not renewal_date:
                continue
            # Handle both datetime (from Timestamp) and string
            renewal_dt = renewal_date
            if isinstance(renewal_dt, str):
                try:
                    renewal_dt = datetime.datetime.fromisoformat(renewal_dt)
                except ValueError:
                    continue
            elif hasattr(renewal_dt, "seconds"):  # Handle Firestore Timestamp
                renewal_dt = datetime.datetime.fromtimestamp(renewal_dt.seconds + renewal_dt.nanoseconds / 1e9)
            if membership.get("status") == "active" and renewal_dt <= now:
                db.collection("users").document(doc.id).update({"membership.status": "inactive", "profile.status": "inactive"})
                updated += 1
        return updated
    except Exception as e:
        print(f"Error in sync_expired_memberships: {e}")
        return 0


# ---------------------------------------------------------------------------
# 4. Registration
# ---------------------------------------------------------------------------
@app.post("/api/register/create-account")
def create_member_account():
    """Create a free Firebase Auth user and the matching Firestore profile."""
    body = request.get_json(force=True) or {}
    required_reg = [
        "fullName", "mobile", "email", "password", "dob", "gender", "address",
        "emergencyContact", "fitnessGoal", "height", "weight", "bloodGroup",
    ]
    missing = [f for f in required_reg if not body.get(f)]
    if missing:
        return error_response(f"Missing required registration fields: {', '.join(missing)}")

    try:
        user_record = auth.create_user(
            email=body["email"],
            password=body["password"],
            display_name=body["fullName"],
            phone_number=None,
        )
    except auth.EmailAlreadyExistsError:
        return error_response("An account with this email already exists", 409)

    auth.set_custom_user_claims(user_record.uid, {"role": "member"})

    member_id = generate_member_id()
    now = datetime.datetime.utcnow()
    join_dt = _parse_local_datetime(body.get("joinDate"), body.get("joinTime")) or now

    profile = {
        "fullName": body["fullName"],
        "mobile": body["mobile"],
        "email": body["email"],
        "dob": body["dob"],
        "gender": body["gender"],
        "address": body["address"],
        "emergencyContact": body["emergencyContact"],
        "fitnessGoal": body["fitnessGoal"],
        "height": body["height"],
        "weight": body["weight"],
        "bloodGroup": body["bloodGroup"],
        "medicalConditions": body.get("medicalConditions", ""),
        "memberId": member_id,
        "createdAt": now,
        "status": "pending_approval",
    }
    membership = {
        "plan": None,
        "status": "inactive",
        "joinDate": join_dt,
        "renewalDate": None,
        "trainerId": None,
    }

    doc_ref = db.collection("users").document(user_record.uid)
    doc_ref.set(
        {
            "profile": profile,
            "membership": membership,
            "goals": {}, "workout": {}, "diet": {},
            "measurements": {}, "progressPhotos": [], "notifications": [],
        }
    )

    return success_response(
        {"uid": user_record.uid, "memberId": member_id},
        message="Registration successful. An admin will approve your admission shortly.",
        status=201,
    )


# ---------------------------------------------------------------------------
# 6. Member Dashboard data
# ---------------------------------------------------------------------------
@app.get("/api/member/<uid>")
@verify_token
def get_member(uid):
    sync_expired_memberships()
    if g.user["uid"] != uid and g.user.get("role") not in ("admin", "owner", "manager"):
        return error_response("Forbidden", 403)
    doc = db.collection("users").document(uid).get()
    if not doc.exists:
        return error_response("Member not found", 404)
    return success_response(doc.to_dict())


@app.put("/api/member/<uid>/profile")
@verify_token
def update_member_profile(uid):
    """Members may edit only a limited whitelist of their own profile fields.
    Payment, attendance, and membership fields are never writable here (PRD 21)."""
    if g.user["uid"] != uid:
        return error_response("Forbidden", 403)
    body = request.get_json(force=True) or {}
    editable = {"mobile", "address", "emergencyContact", "fitnessGoal", "weight", "height"}
    updates = {f"profile.{k}": v for k, v in body.items() if k in editable}
    if not updates:
        return error_response("No editable fields supplied")
    db.collection("users").document(uid).update(updates)
    return success_response(message="Profile updated")


@app.post("/api/member/<uid>/support-tickets")
@verify_token
def raise_support_ticket(uid):
    if g.user["uid"] != uid:
        return error_response("Forbidden", 403)
    body = request.get_json(force=True) or {}
    ticket = {
        "type": body.get("type", "feedback"),  # complaint | feedback | suggestion
        "message": body.get("message", ""),
        "status": "open",
        "createdAt": datetime.datetime.utcnow(),
    }
    db.collection("users").document(uid).collection("supportTickets").add(ticket)
    return success_response(message="Ticket submitted", status=201)


# ---------------------------------------------------------------------------
# 12. Attendance
# ---------------------------------------------------------------------------
@app.post("/api/attendance/mark")
@verify_token
@require_admin
def mark_attendance():
    """Reception/admin marks attendance (manual or QR-scan driven)."""
    body = request.get_json(force=True) or {}
    uid = body.get("uid")
    if not uid:
        return error_response("uid is required")
    date_str = body.get("date") or datetime.date.today().isoformat()
    db.collection("users").document(uid).collection("attendance").document(date_str).set(
        {"present": True, "markedAt": datetime.datetime.utcnow(), "method": body.get("method", "manual")}
    )
    return success_response(message="Attendance marked")


@app.post("/api/member/<uid>/attendance/mark")
@verify_token
def mark_own_attendance(uid):
    try:
        if g.user["uid"] != uid:
            return error_response("Forbidden", 403)

        now_ist = datetime.datetime.now(ZoneInfo("Asia/Kolkata"))
        if now_ist.hour >= 23:
            return error_response("Attendance can only be marked before 11:00 PM", 400)

        today = now_ist.date().isoformat()
        # Get existing document to check edit count
        doc_ref = db.collection("users").document(uid).collection("attendance").document(today)
        doc = doc_ref.get()
        existing_data = doc.to_dict() or {}
        edit_count = existing_data.get("editCount", 0)
        
        doc_ref.set(
            {
                "present": True,
                "markedAt": existing_data.get("markedAt") or datetime.datetime.utcnow(),
                "method": "member",
                "updatedAt": datetime.datetime.utcnow(),
                "editCount": edit_count,
            },
            merge=True,
        )
        return success_response(message="Attendance marked for today")
    except Exception as e:
        print(f"Error in mark_own_attendance: {e}")
        return error_response(f"Failed to mark attendance: {str(e)}", 500)

@app.post("/api/member/<uid>/attendance/unmark")
@verify_token
def unmark_own_attendance(uid):
    try:
        if g.user["uid"] != uid:
            return error_response("Forbidden", 403)

        now_ist = datetime.datetime.now(ZoneInfo("Asia/Kolkata"))
        if now_ist.hour >= 23:
            return error_response("Attendance can only be modified before 11:00 PM", 400)

        today = now_ist.date().isoformat()
        doc_ref = db.collection("users").document(uid).collection("attendance").document(today)
        doc = doc_ref.get()
        if not doc.exists:
            return error_response("No attendance record found for today", 404)
        
        data = doc.to_dict() or {}
        edit_count = data.get("editCount", 0)
        if edit_count >= 2:
            return error_response("You've already used your 2 undo attempts", 400)
        
        # Unmark attendance
        doc_ref.set(
            {
                "present": False,
                "updatedAt": datetime.datetime.utcnow(),
                "editCount": edit_count + 1,
            },
            merge=True,
        )
        return success_response(message="Attendance unmarked for today")
    except Exception as e:
        print(f"Error in unmark_own_attendance: {e}")
        return error_response(f"Failed to unmark attendance: {str(e)}", 500)


@app.get("/api/member/<uid>/attendance")
@verify_token
def get_attendance(uid):
    try:
        if g.user["uid"] != uid and g.user.get("role") not in ("admin", "owner", "manager"):
            return error_response("Forbidden", 403)
        docs = db.collection("users").document(uid).collection("attendance").stream()
        records = {d.id: d.to_dict() for d in docs}
        return success_response(records)
    except Exception as e:
        print(f"Error in get_attendance: {e}")
        return error_response(f"Failed to load attendance: {str(e)}", 500)


# ---------------------------------------------------------------------------
# 7 + 8. Admin: Dashboard stats + Member management
# ---------------------------------------------------------------------------
@app.get("/api/admin/stats")
@verify_token
@require_admin
def admin_stats():
    try:
        sync_expired_memberships()
        users = list(db.collection("users").stream())
        total = len(users)
        active = sum(1 for u in users if u.to_dict().get("membership", {}).get("status") == "active")
        expired = sum(1 for u in users if u.to_dict().get("membership", {}).get("status") == "inactive")
        pending_admissions = sum(1 for u in users if u.to_dict().get("profile", {}).get("status") == "pending_approval")

        today = datetime.date.today().isoformat()
        today_attendance = 0
        for u in users:
            att = db.collection("users").document(u.id).collection("attendance").document(today).get()
            if att.exists and att.to_dict().get("present"):
                today_attendance += 1

        revenue_today = 0
        try:
            payments_today = db.collection("payments").where(
                "createdAt", ">=", datetime.datetime.combine(datetime.date.today(), datetime.time.min)
            ).stream()
            revenue_today = sum(p.to_dict().get("amount", 0) for p in payments_today)
        except Exception:
            pass

        return success_response(
            {
                "totalMembers": total,
                "activeMembers": active,
                "expiredMembers": expired,
                "todaysAttendance": today_attendance,
                "revenueToday": revenue_today,
                "pendingAdmissions": pending_admissions,
            }
        )
    except Exception as e:
        print(f"Error in admin_stats: {e}")
        return error_response(f"Error loading stats: {str(e)}", 500)


@app.get("/api/admin/members")
@verify_token
@require_admin
def list_members():
    sync_expired_memberships()
    search = request.args.get("search", "").lower()
    status_filter = request.args.get("status")
    docs = db.collection("users").stream()
    results = []
    for d in docs:
        data = d.to_dict()
        profile = data.get("profile", {})
        if status_filter and profile.get("status") != status_filter:
            continue
        if search and search not in profile.get("fullName", "").lower() and search not in profile.get("memberId", "").lower():
            continue
        results.append({"uid": d.id, **data})
    return success_response(results)


@app.put("/api/admin/members/<uid>")
@verify_token
@require_admin
def admin_update_member(uid):
    body = request.get_json(force=True) or {}
    action = body.get("action")  # suspend | renew | edit
    ref = db.collection("users").document(uid)

    if action == "suspend":
        ref.update({"membership.status": "suspended", "profile.status": "suspended"})
    elif action == "deactivate":
        ref.update({"membership.status": "inactive", "profile.status": "inactive"})
    elif action == "activate":
        ref.update({"membership.status": "active", "profile.status": "active"})
    elif action == "renew":
        plan_id = body.get("planId")
        if not plan_id:
            return error_response("planId required to renew")
        plan = db.collection("plans").document(plan_id).get()
        if not plan.exists:
            return error_response("Plan not found", 404)
        duration_days = plan.to_dict().get("durationDays", 30)
        new_renewal = datetime.datetime.utcnow() + datetime.timedelta(days=duration_days)
        ref.update({
            "membership.status": "active",
            "membership.plan": plan_id,
            "membership.renewalDate": new_renewal,
        })
    elif action == "assignTrainer":
        trainer_id = body.get("trainerId")
        if not trainer_id:
            return error_response("trainerId required")
        trainer = db.collection("trainers").document(trainer_id).get()
        if not trainer.exists:
            return error_response("Trainer not found", 404)
        ref.update({
            "membership.trainerId": trainer_id,
            "membership.trainerName": trainer.to_dict().get("name"),
        })
    elif action == "notification":
        message = body.get("message")
        if not message:
            return error_response("message is required")
        doc = ref.get()
        if not doc.exists:
            return error_response("Member not found", 404)
        data = doc.to_dict()
        notifications = data.get("notifications", [])
        notifications.append({"message": message, "createdAt": datetime.datetime.utcnow(), "by": g.user["uid"]})
        ref.update({"notifications": notifications})
    else:
        updates = {f"profile.{k}": v for k, v in body.get("profile", {}).items()}
        if updates:
            ref.update(updates)
    return success_response(message="Member updated")


@app.post("/api/admin/members/<uid>/reset-password")
@verify_token
@require_admin
def admin_reset_member_password(uid):
    body = request.get_json(force=True) or {}
    password = body.get("password")
    if not password:
        return error_response("password is required")
    try:
        auth.update_user(uid, password=password)
    except Exception as exc:
        return error_response(f"Could not reset password: {exc}", 400)
    return success_response(message="Password reset")


@app.delete("/api/admin/members/<uid>")
@verify_token
@require_admin
def admin_delete_member(uid):
    auth.delete_user(uid)
    db.collection("users").document(uid).delete()
    return success_response(message="Member deleted")


@app.post("/api/admin/members/create")
@verify_token
@require_admin
def admin_create_member():
    """Admin-created members skip the public signup flow entirely."""
    body = request.get_json(force=True) or {}
    required = ["fullName", "mobile", "email", "password", "dob", "gender", "address", "emergencyContact", "fitnessGoal", "height", "weight", "bloodGroup", "planId"]
    missing = [field for field in required if not body.get(field)]
    if missing:
        return error_response(f"Missing required fields: {', '.join(missing)}")

    # Validate Plan
    plan_id = body.get("planId")
    plan_doc = db.collection("plans").document(plan_id).get()
    if not plan_doc.exists:
        return error_response("Plan not found", 404)
    plan_data = plan_doc.to_dict()
    duration_days = plan_data.get("durationDays", 30)
    plan_price = plan_data.get("price", 0)

    try:
        user_record = auth.create_user(
            email=body["email"],
            password=body["password"],
            display_name=body["fullName"],
            phone_number=None,
        )
    except Exception as exc:
        return error_response(f"Could not create member account: {exc}", 400)

    auth.set_custom_user_claims(user_record.uid, {"role": "member"})
    member_id = generate_member_id()
    now = datetime.datetime.utcnow()
    join_dt = _parse_local_datetime(body.get("joinDate"), body.get("joinTime")) or now
    initial_status = body.get("status", "pending_approval")
    membership_status = "active" if initial_status == "active" else "inactive"
    renewal_date = now + datetime.timedelta(days=duration_days) if initial_status == "active" else None

    profile = {
        "fullName": body["fullName"],
        "mobile": body["mobile"],
        "email": body["email"],
        "dob": body["dob"],
        "gender": body["gender"],
        "address": body["address"],
        "emergencyContact": body["emergencyContact"],
        "fitnessGoal": body["fitnessGoal"],
        "height": body["height"],
        "weight": body["weight"],
        "bloodGroup": body["bloodGroup"],
        "medicalConditions": body.get("medicalConditions", ""),
        "memberId": member_id,
        "createdAt": now,
        "status": initial_status,
    }
    membership = {
        "plan": plan_id,
        "status": membership_status,
        "joinDate": join_dt,
        "renewalDate": renewal_date,
        "trainerId": body.get("trainerId"),
    }
    db.collection("users").document(user_record.uid).set(
        {
            "profile": profile,
            "membership": membership,
            "goals": {},
            "workout": {},
            "diet": {},
            "measurements": {},
            "progressPhotos": [],
            "notifications": [],
        }
    )

    # Record Payment Record Payment
    if initial_status == "active":
        db.collection("payments").add({
            "uid": user_record.uid,
            "memberId": member_id,
            "type": "new_membership",
            "amount": plan_price,
            "method": body.get("paymentMethod", "cash"),
            "status": "successful",
            "recordedBy": g.user["uid"],
            "createdAt": now,
        })
    return success_response({"uid": user_record.uid, "memberId": member_id}, status=201)


# ---------------------------------------------------------------------------
# 9. Admission Management
# ---------------------------------------------------------------------------
@app.get("/api/admin/admissions")
@verify_token
@require_admin
def list_pending_admissions():
    docs = db.collection("users").where("profile.status", "==", "pending_approval").stream()
    return success_response([{"uid": d.id, **d.to_dict()} for d in docs])


@app.post("/api/admin/admissions/<uid>/approve")
@verify_token
@require_admin
def approve_admission(uid):
    body = request.get_json(force=True) or {}
    plan_id = body.get("planId")
    trainer_id = body.get("trainerId")
    if not plan_id:
        return error_response("planId is required to approve")

    plan = db.collection("plans").document(plan_id).get()
    if not plan.exists:
        return error_response("Plan not found", 404)
    duration_days = plan.to_dict().get("durationDays", 30)
    renewal_date = datetime.datetime.utcnow() + datetime.timedelta(days=duration_days)

    db.collection("users").document(uid).update({
        "profile.status": "active",
        "membership.status": "active",
        "membership.plan": plan_id,
        "membership.joinDate": datetime.datetime.utcnow(),
        "membership.renewalDate": renewal_date,
        "membership.trainerId": trainer_id,
    })
    return success_response(message="Admission approved")


@app.post("/api/admin/admissions/<uid>/reject")
@verify_token
@require_admin
def reject_admission(uid):
    db.collection("users").document(uid).update({"profile.status": "rejected"})
    return success_response(message="Admission rejected")


# ---------------------------------------------------------------------------
# 10. Membership Plans
# ---------------------------------------------------------------------------
@app.get("/api/plans")
def list_plans():
    """Public — shown on the registration/renewal screen."""
    docs = db.collection("plans").stream()
    return success_response([{"id": d.id, **d.to_dict()} for d in docs])


@app.post("/api/admin/plans")
@verify_token
@require_admin
def create_plan():
    body = request.get_json(force=True) or {}
    required = ["name", "durationDays", "price"]
    if any(f not in body for f in required):
        return error_response(f"Required fields: {', '.join(required)}")
    ref = db.collection("plans").add({
        "name": body["name"],
        "durationDays": body["durationDays"],
        "price": body["price"],
        "features": body.get("features", []),
        "category": body.get("category", "monthly"),
    })
    return success_response({"id": ref[1].id}, status=201)


@app.put("/api/admin/plans/<plan_id>")
@verify_token
@require_admin
def update_plan(plan_id):
    body = request.get_json(force=True) or {}
    db.collection("plans").document(plan_id).update(body)
    return success_response(message="Plan updated")


@app.delete("/api/admin/plans/<plan_id>")
@verify_token
@require_admin
def delete_plan(plan_id):
    db.collection("plans").document(plan_id).delete()
    return success_response(message="Plan deleted")


# ---------------------------------------------------------------------------
# 11. Payment Management
# ---------------------------------------------------------------------------
@app.get("/api/admin/payments")
@verify_token
@require_admin
def list_payments():
    status_filter = request.args.get("status")
    query = db.collection("payments")
    if status_filter:
        query = query.where("status", "==", status_filter)
    docs = query.stream()
    return success_response([{"id": d.id, **d.to_dict()} for d in docs])


@app.post("/api/admin/payments/manual")
@verify_token
@require_admin
def record_manual_payment():
    """Cash / UPI / card payments taken at the counter, entered by staff."""
    body = request.get_json(force=True) or {}
    required = ["uid", "amount", "method"]
    if any(f not in body for f in required):
        return error_response(f"Required fields: {', '.join(required)}")
    member = db.collection("users").document(body["uid"]).get()
    if not member.exists:
        return error_response("Member not found", 404)
    db.collection("payments").add({
        "uid": body["uid"],
        "memberId": member.to_dict().get("profile", {}).get("memberId"),
        "type": body.get("type", "renewal"),
        "amount": body["amount"],
        "method": body["method"],  # cash | upi | card | online
        "status": "successful",
        "recordedBy": g.user["uid"],
        "createdAt": datetime.datetime.utcnow(),
    })
    return success_response(message="Payment recorded", status=201)


# ---------------------------------------------------------------------------
# 13. Trainer Management
# ---------------------------------------------------------------------------
@app.get("/api/trainers")
def list_trainers():
    docs = db.collection("trainers").stream()
    return success_response([{"id": d.id, **d.to_dict()} for d in docs])


@app.post("/api/admin/trainers")
@verify_token
@require_admin
def add_trainer():
    body = request.get_json(force=True) or {}
    required = ["name", "mobile", "specialty"]
    if any(f not in body for f in required):
        return error_response(f"Required fields: {', '.join(required)}")
    ref = db.collection("trainers").add({
        "name": body["name"],
        "mobile": body["mobile"],
        "specialty": body["specialty"],
        "schedule": body.get("schedule", {}),
        "assignedMembers": [],
    })
    return success_response({"id": ref[1].id}, status=201)


@app.delete("/api/admin/trainers/<trainer_id>")
@verify_token
@require_admin
def remove_trainer(trainer_id):
    db.collection("trainers").document(trainer_id).delete()
    return success_response(message="Trainer removed")


# ---------------------------------------------------------------------------
# 17. Announcements
# ---------------------------------------------------------------------------
@app.get("/api/announcements")
def list_announcements():
    docs = db.collection("announcements").order_by(
        "createdAt", direction="DESCENDING"
    ).limit(50).stream()
    return success_response([{"id": d.id, **d.to_dict()} for d in docs])


@app.post("/api/admin/announcements")
@verify_token
@require_admin
def create_announcement():
    body = request.get_json(force=True) or {}
    if not body.get("title") or not body.get("message"):
        return error_response("title and message are required")
    ref = db.collection("announcements").add({
        "title": body["title"],
        "message": body["message"],
        "category": body.get("category", "notice"),  # notice | offer | competition | holiday
        "priority": body.get("priority", "normal"),
        "pinned": bool(body.get("pinned", False)),
        "active": body.get("active", True),
        "dueDate": body.get("dueDate"),
        "dueTime": body.get("dueTime"),
        "createdAt": datetime.datetime.utcnow(),
        "createdBy": g.user["uid"],
    })
    return success_response({"id": ref[1].id}, status=201)


@app.put("/api/admin/announcements/<ann_id>")
@verify_token
@require_admin
def update_announcement(ann_id):
    body = request.get_json(force=True) or {}
    updates = {}
    for key in ["title", "message", "category", "priority", "dueDate", "dueTime"]:
        if key in body:
            updates[key] = body[key]
    for key in ["pinned", "active"]:
        if key in body:
            updates[key] = bool(body[key])
    if not updates:
        return error_response("No updates supplied")
    db.collection("announcements").document(ann_id).update(updates)
    return success_response(message="Announcement updated")


@app.delete("/api/admin/announcements/<ann_id>")
@verify_token
@require_admin
def delete_announcement(ann_id):
    db.collection("announcements").document(ann_id).delete()
    return success_response(message="Announcement deleted")


# ---------------------------------------------------------------------------
# Support / Helpdesk
# ---------------------------------------------------------------------------
@app.get("/api/admin/support-tickets")
@verify_token
@require_admin
def list_support_tickets():
    search = request.args.get("search", "").lower()
    status_filter = request.args.get("status")
    tickets = []
    for snap in db.collection_group("supportTickets").stream():
        ticket = snap.to_dict()
        user_ref = snap.reference.parent.parent
        member = user_ref.get().to_dict() if user_ref else {}
        profile = member.get("profile", {}) if member else {}
        if status_filter and ticket.get("status") != status_filter:
            continue
        haystack = f"{ticket.get('message', '')} {ticket.get('type', '')} {profile.get('fullName', '')}".lower()
        if search and search not in haystack:
            continue
        tickets.append({
            "uid": user_ref.id if user_ref else None,
            "ticketId": snap.id,
            "memberId": profile.get("memberId"),
            "memberName": profile.get("fullName"),
            **ticket,
        })
    tickets.sort(key=lambda x: x.get("createdAt") or datetime.datetime.min, reverse=True)
    return success_response(tickets)


@app.put("/api/admin/support-tickets/<uid>/<ticket_id>")
@verify_token
@require_admin
def update_support_ticket(uid, ticket_id):
    body = request.get_json(force=True) or {}
    ref = db.collection("users").document(uid).collection("supportTickets").document(ticket_id)
    doc = ref.get()
    if not doc.exists:
        return error_response("Ticket not found", 404)
    updates = {}
    if "status" in body:
        updates["status"] = body["status"]
    if body.get("reply"):
        replies = doc.to_dict().get("replies", [])
        replies.append({"message": body["reply"], "by": g.user["uid"], "createdAt": datetime.datetime.utcnow()})
        updates["replies"] = replies
    if updates:
        updates["updatedAt"] = datetime.datetime.utcnow()
        ref.update(updates)
    return success_response(message="Ticket updated")


@app.delete("/api/admin/support-tickets/<uid>/<ticket_id>")
@verify_token
@require_admin
def delete_support_ticket(uid, ticket_id):
    db.collection("users").document(uid).collection("supportTickets").document(ticket_id).delete()
    return success_response(message="Ticket deleted")


# ---------------------------------------------------------------------------
# 18. Reports
# ---------------------------------------------------------------------------
@app.get("/api/admin/reports/revenue")
@verify_token
@require_admin
def revenue_report():
    """Daily revenue for the last N days (default 30)."""
    days = int(request.args.get("days", 30))
    start = datetime.datetime.combine(
        datetime.date.today() - datetime.timedelta(days=days), datetime.time.min
    )
    docs = db.collection("payments").where("createdAt", ">=", start).stream()
    by_day = {}
    for d in docs:
        data = d.to_dict()
        day = data["createdAt"].date().isoformat() if hasattr(data["createdAt"], "date") else str(data["createdAt"])[:10]
        by_day[day] = by_day.get(day, 0) + data.get("amount", 0)
    return success_response(by_day)


@app.get("/api/admin/reports/membership-growth")
@verify_token
@require_admin
def membership_growth_report():
    docs = db.collection("users").stream()
    by_month = {}
    for d in docs:
        data = d.to_dict()
        join_date = data.get("membership", {}).get("joinDate")
        if join_date and hasattr(join_date, "strftime"):
            key = join_date.strftime("%Y-%m")
            by_month[key] = by_month.get(key, 0) + 1
    return success_response(by_month)


# ---------------------------------------------------------------------------
# One-time bootstrap: promote the very first admin account.
# Protect/remove this route after initial setup in production.
# ---------------------------------------------------------------------------
@app.post("/api/admin/bootstrap-first-admin")
def bootstrap_first_admin():
    body = request.get_json(force=True) or {}
    setup_key = body.get("setupKey")
    if setup_key != os.environ.get("FLASK_SECRET_KEY"):
        return error_response("Invalid setup key", 403)
    email = body.get("email")
    password = body.get("password")
    if not email:
        return error_response("email is required")
    if not password:
        return error_response("password is required")

    try:
        user = auth.get_user_by_email(email)
        auth.update_user(user.uid, password=password)
    except Exception:
        user = auth.create_user(email=email, password=password)

    auth.set_custom_user_claims(user.uid, {"role": "admin"})
    return success_response(message=f"{email} is now an admin. They must log out and back in.")


if __name__ == "__main__":
    app.run(debug=True, port=5000)
