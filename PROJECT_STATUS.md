# Build Status vs. PRD

## Fully built
- **4. Auth/Registration** — admin-created account flow → Firebase user +
  sequential Member ID (`TITAN-2026-0001`, atomic via Firestore transaction)
  → Firestore profile
- **5. Login** — email/password, remember me, forgot password, 20-min
  inactivity auto-logout, role-based redirect (admin vs member)
- **6. Member Dashboard** — welcome card, real-time membership status/days
  remaining, digital membership card with live QR, payment history, attendance
  calendar + streaks, fitness goals + BMI + progress bar, workout plan by day,
  diet plan, body measurements, progress photos (Drive URL, no Storage),
  announcements feed, notifications, support ticket form
- **7. Admin Dashboard stats** — total/active/expired members, today's
  attendance, revenue today, pending admissions
- **8. Member management** — search, filter by status, create member account,
  assign trainer, suspend, activate/deactivate, reset password, delete, CSV
  export
- **9. Admissions** — approve (assign plan → auto-computes renewal date) or
  reject pending registrations
- **10. Membership Plans** — full CRUD, shown publicly on the landing page
- **11. Payments** — removed from the free-tier flow; registration and access
  now run entirely on Firebase without a checkout step
- **12. Attendance** — admin/reception can mark it; members see a read-only
  calendar, percentage, and streaks
- **13. Trainers** — add/remove; assignment happens at admission approval
- **17. Announcements** — create/edit/delete, categorized, live on member
  dashboard
- **18. Reports** — 30-day revenue bar chart
- **21. Security rules** — `firestore.rules` enforces the exact read/write
  split from the PRD (members can never touch their own payments, attendance,
  or membership fields directly)

## Structured but intentionally minimal — needs a real workflow next
- **Workout/Diet assignment (14, 15)** — data model and member-facing display
  are done; there's no admin UI yet to *assign* a workout/diet to a specific
  member (currently would be done via a Firestore console edit or a follow-up
  admin form using the same `users/{uid}` update pattern already in `app.py`)
- **Progress tracking (16)** — measurements display is done; no admin form to
  push updates yet
- **Renew Membership button (member side)** — currently prompts the member to
  contact reception or use the plans section; a self-serve renewal workflow is
  the natural next step if you want to reintroduce paid memberships later
- **Receipt/Invoice PDF download** — history is there, PDF generation isn't
- **Trainer schedule / contact details on the member side** — data model
  exists (`trainers` collection), the "Contact Trainer" tab needs the fetch
  wired to `membership.trainerId`

## Not started (PRD section 24, explicitly "Future Features")
QR/RFID/face-recognition check-in, WhatsApp automation, AI workout/diet
recommendations, mobile app, referrals/coupons/leaderboards/badges, gym
store, event registration, multi-branch, backup/restore, audit logs, granular
role permissions beyond the single `admin` claim bucket used here.

## Why this scope
The PRD covers 26 sections including several multi-week features (AI
recommendations, multi-branch, RFID). Building all of it as working code in
one pass isn't realistic — this delivers a real, running system for the core
loop (register → pay → admin approves → member dashboard → renew → track),
matching the "ship a working version first, then layer in improvements" plan.
