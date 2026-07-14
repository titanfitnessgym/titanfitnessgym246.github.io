import { authClient, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, onSnapshot, collection, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { toast, apiFetch, formatCurrency, formatDate, daysRemaining } from "./common.js";

let currentUid = null;

function setClock(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const update = () => {
    const now = new Date();
    el.textContent = now.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "short", day: "2-digit" }) + " · " + now.toLocaleTimeString("en-IN", { hour12: false });
  };
  update();
  setInterval(update, 1000);
}

function attendanceWindowState() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const getPart = (type) => parts.find((part) => part.type === type)?.value || "";
  const currentHour = Number(getPart("hour"));
  return {
    now,
    beforeCutoff: currentHour < 23,
    today: `${getPart("year")}-${getPart("month")}-${getPart("day")}`,
  };
}

// ---- Sidebar nav ----
document.querySelectorAll(".nav-link[data-section]").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
    link.classList.add("active");
    document.querySelectorAll("main > section").forEach((s) => (s.style.display = "none"));
    document.getElementById(`section-${link.dataset.section}`).style.display = "block";
  });
});

document.getElementById("logout-link").addEventListener("click", async () => {
  await signOut(authClient);
  window.location.href = "../login.html";
});

// ---- Auth guard ----
onAuthStateChanged(authClient, (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }
  currentUid = user.uid;
  setClock("member-clock");
  bootstrap(user.uid);
});

function bootstrap(uid) {
  // Real-time listener on the member's own document — updates every section live.
  onSnapshot(doc(db, "users", uid), (snap) => {
    if (!snap.exists()) return;
    renderMember(snap.data());
  });
  onSnapshot(collection(db, "users", uid, "attendance"), (snap) => {
    const records = {};
    snap.forEach((d) => (records[d.id] = d.data()));
    renderAttendance(records);
  });
  onSnapshot(collection(db, "announcements"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    renderAnnouncements(list);
  });
  onSnapshot(collection(db, "users", uid, "supportTickets"), (snap) => {
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    renderSupportTickets(list);
  });
  loadTrainer();
}

function renderMember(data) {
  const profile = data.profile || {};
  const membership = data.membership || {};
  const goals = data.goals || {};
  const workout = data.workout || {};
  const diet = data.diet || {};
  const measurements = data.measurements || {};
  const photos = data.progressPhotos || [];
  const notifications = data.notifications || [];

  document.getElementById("welcome-heading").textContent = `Welcome back, ${profile.fullName || "Member"} 👋`;
  document.getElementById("member-id-badge").textContent = profile.memberId || "—";

  // Home stats
  document.getElementById("stat-status").textContent = (membership.status || "inactive").toUpperCase();
  const remaining = daysRemaining(membership.renewalDate);
  document.getElementById("stat-days").textContent = remaining !== null ? `${remaining}d` : "—";
  document.getElementById("stat-trainer").textContent = membership.trainerName || "Unassigned";

  // Membership Reminder Banner
  const reminderBanner = document.getElementById("membership-reminder-banner");
  const reminderText = document.getElementById("reminder-text");
  if (membership.status === "active" && remaining !== null && remaining <= 3) {
    reminderBanner.style.display = "block";
    reminderText.textContent = `Your membership expires in ${remaining} day${remaining !== 1 ? "s" : ""} (${formatDate(membership.renewalDate)}). Please renew soon!`;
  } else {
    reminderBanner.style.display = "none";
  }

  document.getElementById("home-notifications").innerHTML = notifications.length
    ? notifications.map((n) => `<div class="mt-8">• ${n.message}</div>`).join("")
    : "No notifications yet.";

  // Membership plate
  document.getElementById("plate-name").textContent = profile.fullName || "—";
  document.getElementById("plate-id").textContent = profile.memberId || "—";
  document.getElementById("plate-valid-till").textContent = formatDate(membership.renewalDate);
  const statusBadge = document.getElementById("plate-status-badge");
  statusBadge.textContent = membership.status || "inactive";
  statusBadge.className = `badge ${membership.status === "active" ? "badge-success" : "badge-warning"}`;
  const qrTarget = document.getElementById("plate-qr");
  qrTarget.innerHTML = "";
  if (window.QRCode && profile.memberId) {
    new QRCode(qrTarget, { text: profile.memberId, width: 64, height: 64 });
  }

  // Goals
  document.getElementById("goal-current-weight").textContent = `${profile.weight || "—"} kg`;
  document.getElementById("goal-target-weight").textContent = goals.targetWeight ? `${goals.targetWeight} kg` : "Not set";
  const heightM = (profile.height || 0) / 100;
  const bmi = heightM ? (profile.weight / (heightM * heightM)).toFixed(1) : "—";
  document.getElementById("goal-bmi").textContent = bmi;
  document.getElementById("goal-calories").textContent = goals.calorieGoal || "Not set";
  document.getElementById("goal-workout").textContent = goals.workoutGoal || "Not set";
  const pct = goals.targetWeight && profile.weight
    ? Math.min(100, Math.round((1 - Math.abs(profile.weight - goals.targetWeight) / profile.weight) * 100))
    : 0;
  document.getElementById("goal-progress-fill").style.width = `${pct}%`;
  document.getElementById("goal-progress-label").textContent = `${pct}% toward target`;

  const goalForm = document.getElementById("goal-form");
  if (goalForm) {
    goalForm.targetWeight.value = goals.targetWeight || "";
    goalForm.calorieGoal.value = goals.calorieGoal || "";
    goalForm.workoutGoal.value = goals.workoutGoal || "";
  }

  const measurementsForm = document.getElementById("measurements-form");
  if (measurementsForm) {
    measurementsForm.weight.value = measurements.weight || "";
    measurementsForm.chest.value = measurements.chest || "";
    measurementsForm.waist.value = measurements.waist || "";
    measurementsForm.arms.value = measurements.arms || "";
    measurementsForm.legs.value = measurements.legs || "";
    measurementsForm.bodyFatPercent.value = measurements.bodyFatPercent || "";
  }

  const workoutForm = document.getElementById("workout-form");
  if (workoutForm) {
    workoutForm.monday.value = workout.monday || "";
    workoutForm.tuesday.value = workout.tuesday || "";
    workoutForm.wednesday.value = workout.wednesday || "";
    workoutForm.thursday.value = workout.thursday || "";
    workoutForm.friday.value = workout.friday || "";
    workoutForm.saturday.value = workout.saturday || "";
    workoutForm.sunday.value = workout.sunday || "";
  }

  const dietForm = document.getElementById("diet-form");
  if (dietForm) {
    dietForm.breakfast.value = diet.breakfast || "";
    dietForm.lunch.value = diet.lunch || "";
    dietForm.snacks.value = diet.snacks || "";
    dietForm.dinner.value = diet.dinner || "";
  }

  // Workout
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  document.getElementById("workout-days").innerHTML = days
    .map(
      (d) => `<div class="card"><div class="card-title">${d}</div><div class="muted" style="font-size:13px;">${workout[d.toLowerCase()] || "Rest day / not assigned"}</div></div>`
    )
    .join("");

  // Diet
  const meals = ["breakfast", "lunch", "snacks", "dinner"];
  document.getElementById("diet-meals").innerHTML = meals
    .map(
      (m) => `<div class="flex justify-between mt-8"><span class="muted" style="text-transform:capitalize">${m}</span><span>${diet[m] || "Not assigned"}</span></div>`
    )
    .join("");
  document.getElementById("diet-water").textContent = diet.waterIntake || "Not set";
  document.getElementById("diet-supplements").innerHTML = (diet.supplements || [])
    .map((s) => `<li>${s}</li>`)
    .join("") || "<li class='muted'>None assigned</li>";

  // Measurements
  const measureKeys = ["chest", "shoulder", "waist", "arms", "legs", "bodyFatPercent"];
  document.getElementById("measurements-grid").innerHTML = measureKeys
    .map(
      (k) => `<div class="card stat-tile"><div class="label">${k.replace(/([A-Z])/g, " $1")}</div><div class="value" style="font-size:22px">${measurements[k] || "—"}</div></div>`
    )
    .join("");

  // Photos
  document.getElementById("photos-grid").innerHTML = photos.length
    ? photos
        .map(
          (url, i) => `<a href="${url}" target="_blank" class="card" style="text-decoration:none;text-align:center;">
            <div class="muted">Photo ${i + 1}</div><div class="mt-8" style="color:var(--amber)">Open in new tab ↗</div></a>`
        )
        .join("")
    : `<div class="muted">No progress photos yet.</div>`;
}

function renderAttendance(records) {
  const days = Object.keys(records);
  const presentDays = days.filter((d) => records[d].present);
  const total = days.length || 1;
  document.getElementById("att-present").textContent = presentDays.length;
  document.getElementById("att-missed").textContent = total - presentDays.length;
  document.getElementById("stat-attendance").textContent = `${Math.round((presentDays.length / total) * 100)}%`;

  const { beforeCutoff, today } = attendanceWindowState();
  const todayRecord = records[today];
  const markBtn = document.getElementById("mark-attendance-btn");
  const unmarkBtn = document.getElementById("unmark-attendance-btn");
  const note = document.getElementById("attendance-status-note");
  const undoCountNote = document.getElementById("undo-count-note");
  const remainingUndoSpan = document.getElementById("remaining-undo-count");
  
  const editCount = todayRecord?.editCount || 0;
  const remainingUndos = 2 - editCount;

  if (markBtn) {
    markBtn.disabled = !beforeCutoff || !!todayRecord?.present;
    markBtn.textContent = todayRecord?.present ? "Marked Present" : beforeCutoff ? "Mark Present" : "Cutoff Passed";
  }
  if (unmarkBtn) {
    const canUnmark = beforeCutoff && todayRecord?.present && remainingUndos > 0;
    unmarkBtn.style.display = canUnmark ? "inline-block" : "none";
    unmarkBtn.disabled = !canUnmark;
  }
  if (undoCountNote) {
    undoCountNote.style.display = beforeCutoff ? "block" : "none";
    if (remainingUndoSpan) {
      remainingUndoSpan.textContent = remainingUndos;
    }
  }
  if (note) {
    let noteText = "";
    if (todayRecord?.present) {
      noteText = `Attendance marked for today. You have ${remainingUndos} undo attempts remaining.`;
    } else if (beforeCutoff) {
      noteText = "You can mark your present status for today before 11:00 PM.";
    } else {
      noteText = "Attendance updates are closed after 11:00 PM.";
    }
    note.textContent = noteText;
  }

  // Streaks
  const sortedDates = presentDays.map((d) => new Date(d)).sort((a, b) => a - b);
  let longest = 0, current = 0, streak = 0;
  for (let i = 0; i < sortedDates.length; i++) {
    if (i === 0 || (sortedDates[i] - sortedDates[i - 1]) / 86400000 === 1) {
      streak++;
    } else {
      streak = 1;
    }
    longest = Math.max(longest, streak);
  }
  current = streak;
  document.getElementById("att-streak").textContent = current;
  document.getElementById("att-longest").textContent = longest;

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const cal = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const localDate = new Date(now.getFullYear(), now.getMonth(), d);
    const iso = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}`;
    const present = records[iso]?.present;
    const isToday = iso === today;
    const borderColor = present ? "var(--success)" : isToday ? "var(--amber)" : "rgba(255,77,77,0.55)";
    const background = present
      ? "linear-gradient(180deg, rgba(55,200,113,0.18), rgba(55,200,113,0.06))"
      : isToday
        ? "linear-gradient(180deg, rgba(255,179,71,0.20), rgba(255,179,71,0.06))"
        : "linear-gradient(180deg, rgba(255,77,77,0.10), rgba(255,77,77,0.03))";
    cal.push(`<div class="card" style="padding:8px;text-align:center;border-color:${borderColor};background:${background};box-shadow:none;${isToday ? "transform:translateY(-1px);" : ""}">
      <div style="font-size:11px" class="muted">${d}</div>
      <div style="font-size:11px;color:${present ? "var(--success)" : isToday ? "var(--amber)" : "var(--danger)"}">${present ? "● Present" : isToday ? "● Today" : "● Absent"}</div>
    </div>`);
  }
  document.getElementById("att-calendar").innerHTML = cal.join("");
}

function renderSupportTickets(list) {
  const container = document.getElementById("my-tickets");
  if (!container) return;
  const tickets = list
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .slice(0, 12);
  container.innerHTML = tickets.length
    ? tickets.map((t) => `<div class="card">
        <div class="flex justify-between items-center"><strong>${t.type || "query"}</strong><span class="badge ${t.status === "resolved" ? "badge-success" : t.status === "pending" ? "badge-warning" : "badge-danger"}">${t.status || "open"}</span></div>
        <p class="mt-8">${t.message || ""}</p>
        <div class="muted mt-8" style="font-size:12px;">${formatDate(t.createdAt)}</div>
        ${(t.replies || []).map((r) => `<div class="mt-8" style="padding-left:10px;border-left:2px solid var(--line);"><strong>Reply:</strong> ${r.message}</div>`).join("")}
      </div>`).join("")
    : `<div class="muted">No support tickets yet.</div>`;
}

function renderAnnouncements(list) {
  const feed = list
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .slice(0, 10);
  const html = feed.length
    ? feed
        .map(
          (a) => `<div class="card">
            <div class="flex justify-between items-center"><strong>${a.title}</strong><span class="badge badge-muted">${a.category}</span></div>
            <p class="muted mt-8">${a.message}</p>
          </div>`
        )
        .join("")
    : `<div class="muted">No announcements yet.</div>`;
  document.getElementById("announcements-list").innerHTML = html;
  document.getElementById("home-announcements").innerHTML = feed.length
    ? feed.slice(0, 3).map((a) => `<div class="mt-8"><strong>${a.title}</strong><div class="muted" style="font-size:13px">${a.message}</div></div>`).join("")
    : "No announcements yet.";
}

async function loadTrainer() {
  // Placeholder — wired once membership.trainerId resolves against /api/trainers.
}

const renewBtn = document.getElementById("renew-btn");
if (renewBtn) {
  renewBtn.addEventListener("click", () => {
    toast("Ask reception to process your renewal.", "info");
  });
}

document.getElementById("add-photo-btn").addEventListener("click", async () => {
  const input = document.getElementById("photo-url-input");
  const url = input.value.trim();
  if (!url.startsWith("http")) {
    toast("Paste a valid Google Drive link", "error");
    return;
  }
  await updateDoc(doc(db, "users", currentUid), { progressPhotos: arrayUnion(url) });
  input.value = "";
  toast("Photo link added", "success");
});

document.getElementById("support-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    await apiFetch(`/member/${currentUid}/support-tickets`, { method: "POST", body: JSON.stringify(data) });
    toast("Ticket submitted", "success");
    e.target.reset();
  } catch (err) {
    toast(err.message, "error");
  }
});

document.getElementById("mark-attendance-btn").addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    await apiFetch(`/member/${currentUid}/attendance/mark`, { method: "POST" });
    toast("Attendance marked", "success");
  } catch (err) {
    toast(err.message, "error");
  }
});

document.getElementById("unmark-attendance-btn").addEventListener("click", async (e) => {
  e.preventDefault();
  try {
    await apiFetch(`/member/${currentUid}/attendance/unmark`, { method: "POST" });
    toast("Attendance unmarked", "success");
  } catch (err) {
    toast(err.message, "error");
  }
});

document.getElementById("goal-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  const updates = {
    goals: {
      targetWeight: data.targetWeight ? Number(data.targetWeight) : null,
      calorieGoal: data.calorieGoal || "",
      workoutGoal: data.workoutGoal || "",
    },
  };
  await updateDoc(doc(db, "users", currentUid), updates);
  toast("Goals saved", "success");
});

document.getElementById("clear-goals-btn").addEventListener("click", async () => {
  await updateDoc(doc(db, "users", currentUid), { goals: {} });
  toast("Goals deleted", "success");
});

document.getElementById("measurements-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  const measurementUpdates = {};
  Object.entries(data).forEach(([key, value]) => {
    if (value !== "") measurementUpdates[key] = Number(value);
  });
  await updateDoc(doc(db, "users", currentUid), { measurements: measurementUpdates });
  toast("Measurements saved", "success");
});

document.getElementById("workout-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  await updateDoc(doc(db, "users", currentUid), { workout: data });
  toast("Workout plan saved", "success");
});

document.getElementById("diet-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  await updateDoc(doc(db, "users", currentUid), { diet: data });
  toast("Diet plan saved", "success");
});
