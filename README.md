# Titan Fitness Management System (TFMS)

Gym management system per the PRD: Admin panel + Member panel, real-time via
Firestore, Flask backend.

See `PROJECT_STATUS.md` for exactly what's built vs. what's next-phase.

## Stack
- Frontend: HTML5 / CSS3 / vanilla JS (Firebase JS SDK, ES modules, no build step)
- Backend: Python (Flask) + firebase-admin
- Database/Auth: Firebase Firestore + Firebase Authentication

## 1. Firebase project setup

1. Create a project at https://console.firebase.google.com
2. Enable **Authentication > Sign-in method > Email/Password**
3. Enable **Firestore Database** (start in production mode)
4. Go to **Project Settings > Service Accounts > Generate new private key** —
   save the JSON as `backend/titan-gym-10f7b-firebase-adminsdk-fbsvc-afb3c9a8d2.json`
5. Go to **Project Settings > General > Your apps > Add app (Web)** — copy the
   config object into `frontend/js/firebase-config.js`
6. Deploy the security rules:
   ```
   npm install -g firebase-tools
   firebase login
   firebase init firestore   # point it at firestore.rules in this repo
   firebase deploy --only firestore:rules
   ```

## 2. Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # service account defaults to the JSON already in backend/
python app.py                # runs on http://localhost:5000
```

## 3. Frontend

No build step — it's plain HTML/JS with ES modules. Serve it with any static
server (opening `index.html` directly via `file://` will break Firebase auth
redirects, so use a server):

```bash
cd frontend
python -m http.server 5500    # or: npx serve .
```

Visit `http://localhost:5500`.

## 4. Create your first admin

Registrations always come in as `role: member`. To promote the first admin:

```bash
curl -X POST http://localhost:5000/api/admin/bootstrap-first-admin \
  -H "Content-Type: application/json" \
  -d '{"setupKey": "<your FLASK_SECRET_KEY from .env>", "email": "you@example.com"}'
```

That account must log out and back in for the new role to take effect. **Delete
or protect this route once your first admin is set up** — it's a bootstrap
convenience, not something to leave open in production.

## 5. Add at least one membership plan before testing admin-created members

Member accounts are now created by the admin panel only. Log in as admin →
Membership Plans → create one (e.g. "Monthly", 30 days, ₹999) → then use
the admin "Create Member Account" form.

## Project structure

```
titan-fitness/
├── backend/
│   ├── app.py                  Flask routes (all API endpoints)
│   ├── firebase_config.py      Firebase Admin SDK bootstrap
│   ├── utils.py                Auth decorators, Member ID generator
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── index.html              Landing + login only
│   ├── login.html
│   ├── css/style.css           Design tokens + all component styles
│   ├── js/
│   │   ├── firebase-config.js  Firebase web config
│   │   ├── common.js           Shared fetch/toast/format helpers
│   │   ├── login.js
│   │   ├── member-dashboard.js
│   │   └── admin-dashboard.js
│   └── pages/
│       ├── member-dashboard.html
│       └── admin-dashboard.html
├── firestore.rules
├── README.md
└── PROJECT_STATUS.md
```
