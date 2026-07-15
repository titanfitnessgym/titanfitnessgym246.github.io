# Titan Fitness Management System

A gym management platform: member registration, admin approval, membership
plans, attendance, payments, trainers, and announcements — served as a single
Flask application, ready to deploy on Render's free tier as one Web Service.

---

## Project Overview

- **Backend:** Python (Flask), Firebase Admin SDK, Gunicorn for production
- **Frontend:** Plain HTML/CSS/JS (Firebase JS SDK, ES modules) — no build step,
  no separate frontend service. Flask serves it directly via `templates/` and
  `static/`
- **Database/Auth:** Firebase Firestore + Firebase Authentication

## Features

- Member registration → admin approval → active membership
- Role-based access: member vs. admin/owner/manager/receptionist (Firebase
  custom claims)
- Admin dashboard: live stats, member management, admissions, plans,
  payments, trainers, announcements, revenue reports
- Member dashboard: digital membership card with QR, attendance calendar with
  streaks, fitness goals, workout/diet plan, body measurements, progress
  photos (Google Drive links), announcements, support tickets
- Firestore security rules enforcing that members can never write their own
  payment, attendance, or membership fields

## Folder Structure

```
.
├── backend/
│   ├── app.py                  All Flask routes: pages + API
│   ├── firebase_config.py      Firebase Admin SDK bootstrap
│   ├── utils.py                Auth decorators, Member ID generator, helpers
│   ├── requirements.txt
│   ├── Procfile                 Render/Heroku start command
│   ├── .env.example
│   ├── templates/
│   │   ├── index.html          Landing page + plans
│   │   ├── login.html
│   │   ├── 404.html / 500.html  Error pages
│   │   └── pages/
│   │       ├── member-dashboard.html
│   │       └── admin-dashboard.html
│   └── static/
│       ├── css/style.css
│       └── js/                 firebase-config.js, common.js, home.js,
│                                login.js, member-dashboard.js, admin-dashboard.js
├── firestore.rules
├── .gitignore
├── README.md
└── PROJECT_STATUS.md            What's built vs. what's next
```

Everything lives under `backend/` on purpose — that's the Render Root Directory.

## Installation

```bash
git clone <your-repo-url>
cd <repo>/backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in:

| Variable | Required | Notes |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | one of these two | Paste the **entire** contents of your Firebase service account key JSON as a single-line env var. Simplest option on Render. |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | one of these two | Path to the key file on disk instead (e.g. a Render Secret File at `/etc/secrets/...`). |
| `FLASK_SECRET_KEY` | yes | Any long random string. Also used as the one-time admin bootstrap key (see below). |
| `FLASK_ENV` | no | `development` enables Flask debug mode locally. Leave unset/`production` on Render. |
| `CORS_ALLOWED_ORIGINS` | no | Only needed if a *different* origin calls this API. Same-origin Render deploys don't need it. |
| `PORT` | no | Set automatically by Render. Defaults to 5000 locally. |

**Never commit your `.env` file or a real service account JSON file** — both
are covered by `.gitignore`.

## Firebase Configuration

1. Create a project at https://console.firebase.google.com
2. **Authentication > Sign-in method** → enable Email/Password
3. **Firestore Database** → create in production mode
4. **Project Settings > Service Accounts > Generate new private key** → use
   its contents for `FIREBASE_SERVICE_ACCOUNT_JSON` (or save the file and
   point `FIREBASE_SERVICE_ACCOUNT_PATH` at it)
5. **Project Settings > General > Your apps > Add app (Web)** → copy the
   config object into `backend/static/js/firebase-config.js`
6. Deploy the security rules:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init firestore   # point it at firestore.rules in this repo
   firebase deploy --only firestore:rules
   ```

> ⚠️ If you ever paste or upload a real service account key into a chat, repo,
> or ticket, treat it as compromised: go to **Firebase Console > Project
> Settings > Service Accounts**, delete that key, and generate a new one
> immediately.

## Running Locally

```bash
cd backend
python app.py
```

Visit `http://localhost:5000`. Flask now serves both the API (`/api/...`)
and every page (`/`, `/login`, `/member`, `/admin`) from this one process —
no separate static server needed.

### Create your first admin

Registrations always come in as `role: member`. Promote the first admin:

```bash
curl -X POST http://localhost:5000/api/admin/bootstrap-first-admin \
  -H "Content-Type: application/json" \
  -d '{"setupKey": "<your FLASK_SECRET_KEY>", "email": "you@example.com", "password": "a-strong-password"}'
```

That account must log out and back in for the new role to apply. Remove or
lock down this route once your first admin exists — it's a one-time
bootstrap, not something to leave open in production.

### Add at least one membership plan

Admission approval requires a plan to assign. Log in as admin → Membership
Plans → create one (e.g. "Monthly", 30 days, ₹999) before testing the full
registration → approval flow.

## Deployment on Render

**Render Web Service settings:**

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `gunicorn app:app` |
| Instance Type | Free |

**Steps:**

1. Push this repo to GitHub (see below)
2. In Render: **New > Web Service** → connect the repo
3. Set Root Directory to `backend`
4. Add the environment variables from the table above (at minimum
   `FIREBASE_SERVICE_ACCOUNT_JSON` and `FLASK_SECRET_KEY`)
5. Deploy — Render builds with pip, then runs `gunicorn app:app`
6. Once live, run the admin bootstrap curl command against your Render URL
   instead of localhost

Render's free plan spins the service down after inactivity; the first
request after idling will be slow while it wakes back up. That's expected.

## GitHub Setup

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

`.gitignore` already excludes `.env`, any `*firebase-adminsdk*.json` /
`*serviceAccountKey*.json` files, virtual envs, and Python caches — double
check `git status` before your first push if you ever had a key file sitting
in this folder.

## Production Deployment Checklist

- [ ] `FLASK_ENV` is not set to `development` (or is unset) in production
- [ ] `FLASK_SECRET_KEY` is a real random value, not the example placeholder
- [ ] Firebase credentials come from an env var/secret file, never a
      committed JSON file
- [ ] Firestore rules are deployed (`firebase deploy --only firestore:rules`)
- [ ] At least one membership plan exists
- [ ] First admin account is bootstrapped, then the bootstrap route is
      removed or protected
- [ ] `backend/static/js/firebase-config.js` has your real Firebase web config

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `FileNotFoundError: No Firebase credentials configured` | Neither `FIREBASE_SERVICE_ACCOUNT_JSON` nor `FIREBASE_SERVICE_ACCOUNT_PATH` is set |
| `FIREBASE_SERVICE_ACCOUNT_JSON is set but isn't valid JSON` | You pasted a truncated/edited copy — re-copy the full file contents on one line |
| Login succeeds but dashboard redirects back to login | Custom claim `role` isn't set yet, or the browser session is stale — sign out/in again after running the admin bootstrap |
| 404 on every page except `/` | You're running an old checkout without the page routes in `app.py` — pull latest |
| CSS/JS not loading | Confirm you're hitting Flask (`/`), not opening `templates/index.html` directly from disk |
| Registration approves but member never sees an active plan | No membership plan existed at approval time — create one first |

## Commands Reference

```bash
# Local dev
python app.py

# Production (what Render runs)
gunicorn app:app

# Install deps
pip install -r requirements.txt

# Deploy Firestore rules
firebase deploy --only firestore:rules
```

## Dependencies

See `backend/requirements.txt`:

- `Flask` — web framework, serves pages + API
- `flask-cors` — CORS handling (mostly inert in same-origin deploys)
- `firebase-admin` — Firestore + Firebase Auth from the backend
- `python-dotenv` — loads `.env` locally
- `gunicorn` — production WSGI server
- `tzdata` — IANA timezone data (used for IST-based attendance cutoffs)
