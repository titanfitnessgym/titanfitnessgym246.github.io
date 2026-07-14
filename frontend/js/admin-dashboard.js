import { authClient, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, collectionGroup, onSnapshot } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { toast, apiFetch, formatCurrency, formatDate } from "./common.js";

let currentSection = "overview";

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

function setupRealtimeSync() {
  onSnapshot(collection(db, "users"), () => {
    if (["overview", "members", "admissions"].includes(currentSection)) {
      loadSection(currentSection);
    }
  });
  onSnapshot(collection(db, "announcements"), () => {
    if (currentSection === "announcements") loadAnnouncements();
  });
  onSnapshot(collection(db, "trainers"), () => {
    if (currentSection === "trainers") loadTrainers();
  });
  onSnapshot(collection(db, "plans"), () => {
    if (["plans", "admissions"].includes(currentSection)) loadPlans(currentSection === "admissions");
  });
  onSnapshot(collectionGroup(db, "supportTickets"), () => {
    if (currentSection === "support") loadSupportTickets();
  });
}

// ---- Nav ----
document.querySelectorAll(".nav-link[data-section]").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
    link.classList.add("active");
    document.querySelectorAll("main > section").forEach((s) => (s.style.display = "none"));
    document.getElementById(`section-${link.dataset.section}`).style.display = "block";
    document.getElementById("section-title").textContent = link.textContent;
    currentSection = link.dataset.section;
    loadSection(link.dataset.section);
  });
});
document.getElementById("logout-link").addEventListener("click", async () => {
  await signOut(authClient);
  window.location.href = "../login.html";
});

// ---- Auth guard: require admin custom claim ----
onAuthStateChanged(authClient, async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }
  const token = await user.getIdTokenResult();
  const role = token.claims.role;
  if (!["admin", "owner", "manager", "receptionist"].includes(role)) {
    toast("This account doesn't have admin access", "error");
    window.location.href = "../pages/member-dashboard.html";
    return;
  }
  setClock("admin-clock");
  setupRealtimeSync();
  loadSection("overview");
});

let cachedPlans = [];

function currentLocalDateTimeParts() {
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const getPart = (parts, type) => parts.find((part) => part.type === type)?.value || "";
  const date = `${getPart(dateParts, "year")}-${getPart(dateParts, "month")}-${getPart(dateParts, "day")}`;
  const time = `${getPart(timeParts, "hour")}:${getPart(timeParts, "minute")}`;
  return { date, time };
}

function seedMemberCreateDefaults() {
  const form = document.getElementById("member-create-form");
  if (!form) return;
  const { date, time } = currentLocalDateTimeParts();
  if (form.joinDate && !form.joinDate.value) form.joinDate.value = date;
  if (form.joinTime && !form.joinTime.value) form.joinTime.value = time;
}

function loadSection(name) {
  const loaders = {
    overview: loadOverview,
    members: loadMembers,
    admissions: loadAdmissions,
    plans: loadPlans,
    trainers: loadTrainers,
    announcements: loadAnnouncements,
    support: loadSupportTickets,
    reports: loadReports,
  };
  loaders[name]?.();
}

// ---- Overview / stats (PRD 7) ----
async function loadOverview() {
  try {
    const stats = await apiFetch("/admin/stats");
    document.getElementById("stats-grid").innerHTML = `
      <div class="card stat-tile"><div class="label">Total Members</div><div class="value">${stats.totalMembers}</div></div>
      <div class="card stat-tile"><div class="label">Active Members</div><div class="value">${stats.activeMembers}</div></div>
      <div class="card stat-tile"><div class="label">Expired Members</div><div class="value">${stats.expiredMembers}</div></div>
      <div class="card stat-tile"><div class="label">Revenue Today</div><div class="value">${formatCurrency(stats.revenueToday)}</div></div>
    `;
    document.getElementById("stat-pending-admissions").textContent = stats.pendingAdmissions;
    document.getElementById("stat-today-attendance").textContent = stats.todaysAttendance;
  } catch (e) {
    toast(e.message, "error");
  }
}

// ---- Member management (PRD 8) ----
async function loadMembers() {
  const tbody = document.getElementById("members-table");
  tbody.innerHTML = `<tr><td colspan="6" class="muted">Loading…</td></tr>`;
  try {
    const search = document.getElementById("member-search").value;
    const status = document.getElementById("member-status-filter").value;
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    const members = await apiFetch(`/admin/members?${params.toString()}`);
    tbody.innerHTML = members.length
      ? members
          .map((m) => {
            const p = m.profile || {};
            const ms = m.membership || {};
            return `<tr>
              <td class="mono">${p.memberId || "—"}</td>
              <td>${p.fullName || "—"}</td>
              <td><span class="badge ${statusBadgeClass(p.status)}">${p.status || "—"}</span></td>
              <td>${ms.plan || "—"}</td>
              <td>${formatDate(ms.renewalDate)}</td>
              <td class="flex gap-8" style="flex-wrap:wrap;">
                <button class="btn btn-ghost btn-sm" data-action="view-profile" data-uid="${m.uid}">View Profile</button>
                <button class="btn btn-ghost btn-sm" data-action="activate" data-uid="${m.uid}">Activate</button>
                <button class="btn btn-ghost btn-sm" data-action="deactivate" data-uid="${m.uid}">Deactivate</button>
                <button class="btn btn-ghost btn-sm" data-action="suspend" data-uid="${m.uid}">Suspend</button>
                <button class="btn btn-ghost btn-sm" data-action="assign-trainer" data-uid="${m.uid}">Assign Trainer</button>
                <button class="btn btn-ghost btn-sm" data-action="view-attendance" data-uid="${m.uid}">View Attendance</button>
                <button class="btn btn-ghost btn-sm" data-action="view-progress" data-uid="${m.uid}">View Progress</button>
                <button class="btn btn-ghost btn-sm" data-action="reset-password" data-uid="${m.uid}">Reset Password</button>
                <button class="btn btn-ghost btn-sm" data-action="notify" data-uid="${m.uid}">Send Notification</button>
                <button class="btn btn-danger btn-sm" data-action="delete" data-uid="${m.uid}">Delete Member</button>
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="6" class="muted">No members match this filter.</td></tr>`;

    tbody.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => handleMemberAction(btn.dataset.action, btn.dataset.uid));
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted">Couldn't load members: ${e.message}</td></tr>`;
  }
}
document.getElementById("member-search").addEventListener("input", debounce(loadMembers, 350));
document.getElementById("member-status-filter").addEventListener("change", loadMembers);

document.getElementById("member-create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    await apiFetch("/admin/members/create", { method: "POST", body: JSON.stringify(data) });
    toast("Member account created", "success");
    e.target.reset();
    loadAdmissions(); // Now in admissions section
    loadOverview(); // Also update overview stats
  } catch (err) {
    toast(err.message, "error");
  }
});
seedMemberCreateDefaults();

async function handleMemberAction(action, uid) {
  if (action === "delete" && !confirm("Permanently delete this member? This cannot be undone.")) return;
  try {
    if (action === "view-profile" || action === "view-progress") {
      const member = await apiFetch(`/member/${uid}`);
      window.alert(JSON.stringify(member, null, 2));
      return;
    }
    if (action === "view-attendance") {
      const attendance = await apiFetch(`/member/${uid}/attendance`);
      window.alert(JSON.stringify(attendance, null, 2));
      return;
    }
    if (action === "reset-password") {
      const password = window.prompt("Enter a new password for this member:");
      if (!password) return;
      await apiFetch(`/admin/members/${uid}/reset-password`, { method: "POST", body: JSON.stringify({ password }) });
      toast("Password reset", "success");
      return;
    }
    if (action === "assign-trainer") {
      const trainerId = window.prompt("Enter trainer ID:");
      if (!trainerId) return;
      await apiFetch(`/admin/members/${uid}`, { method: "PUT", body: JSON.stringify({ action: "assignTrainer", trainerId }) });
      toast("Trainer assigned", "success");
      return;
    }
    if (action === "notify") {
      const message = window.prompt("Notification message:");
      if (!message) return;
      await apiFetch(`/admin/members/${uid}`, { method: "PUT", body: JSON.stringify({ action: "notification", message }) });
      toast("Notification sent", "success");
      return;
    }
    if (action === "delete") {
      await apiFetch(`/admin/members/${uid}`, { method: "DELETE" });
      toast("Member deleted", "success");
    } else {
      await apiFetch(`/admin/members/${uid}`, { method: "PUT", body: JSON.stringify({ action }) });
      toast(`Member ${action}ed`, "success");
    }
    loadMembers();
  } catch (e) {
    toast(e.message, "error");
  }
}

document.getElementById("export-csv-btn").addEventListener("click", async () => {
  try {
    const members = await apiFetch("/admin/members");
    const rows = [["Member ID", "Name", "Status", "Plan", "Renewal Date", "Mobile", "Email"]];
    members.forEach((m) => {
      const p = m.profile || {}, ms = m.membership || {};
      rows.push([p.memberId, p.fullName, p.status, ms.plan, formatDate(ms.renewalDate), p.mobile, p.email]);
    });
    const csv = rows.map((r) => r.map((c) => `"${c ?? ""}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "titan-fitness-members.csv";
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast(e.message, "error");
  }
});

function statusBadgeClass(status) {
  if (status === "active") return "badge-success";
  if (status === "pending_approval") return "badge-warning";
  if (status === "suspended" || status === "rejected") return "badge-danger";
  return "badge-muted";
}

// ---- Admissions (PRD 9) ----
async function loadAdmissions() {
  await loadPlans(true); // ensure cachedPlans is populated for the approve dropdown
  const container = document.getElementById("admissions-list");
  container.innerHTML = `<div class="muted">Loading…</div>`;
  try {
    const admissions = await apiFetch("/admin/admissions");
    container.innerHTML = admissions.length
      ? admissions
          .map((m) => {
            const p = m.profile || {};
            return `<div class="card">
              <div class="card-title">${p.fullName} <span class="badge badge-warning">Pending</span></div>
              <div class="muted mono" style="font-size:13px">${p.memberId}</div>
              <div class="mt-8 muted">${p.email} · ${p.mobile}</div>
              <div class="field mt-16">
                <label>Assign plan</label>
                <select data-plan-select data-uid="${m.uid}">
                  ${cachedPlans.map((pl) => `<option value="${pl.id}">${pl.name}</option>`).join("")}
                </select>
              </div>
              <div class="flex gap-8 mt-8">
                <button class="btn btn-primary btn-sm" data-approve="${m.uid}">Approve</button>
                <button class="btn btn-danger btn-sm" data-reject="${m.uid}">Reject</button>
              </div>
            </div>`;
          })
          .join("")
      : `<div class="muted">No pending admissions.</div>`;

    container.querySelectorAll("[data-approve]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.approve;
        const select = container.querySelector(`[data-plan-select][data-uid="${uid}"]`);
        try {
          await apiFetch(`/admin/admissions/${uid}/approve`, {
            method: "POST",
            body: JSON.stringify({ planId: select?.value }),
          });
          toast("Admission approved", "success");
          loadAdmissions();
        } catch (e) {
          toast(e.message, "error");
        }
      })
    );
    container.querySelectorAll("[data-reject]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await apiFetch(`/admin/admissions/${btn.dataset.reject}/reject`, { method: "POST" });
          toast("Admission rejected", "success");
          loadAdmissions();
        } catch (e) {
          toast(e.message, "error");
        }
      })
    );
  } catch (e) {
    container.innerHTML = `<div class="muted">Couldn't load admissions: ${e.message}</div>`;
  }
}

// ---- Plans (PRD 10) ----
async function loadPlans(silent = false) {
  try {
    cachedPlans = await apiFetch("/plans");
    if (!silent) {
      document.getElementById("plans-list").innerHTML = cachedPlans.length
        ? cachedPlans
            .map(
              (p) => `<div class="card">
                <div class="card-title">${p.name} <button class="btn btn-danger btn-sm" data-delete-plan="${p.id}">Delete</button></div>
                <div class="value" style="font-size:22px">${formatCurrency(p.price)}</div>
                <div class="muted">${p.durationDays} days · ${p.category}</div>
              </div>`
            )
            .join("")
        : `<div class="muted">No plans yet — add one above.</div>`;
      document.querySelectorAll("[data-delete-plan]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          await apiFetch(`/admin/plans/${btn.dataset.deletePlan}`, { method: "DELETE" });
          toast("Plan deleted", "success");
          loadPlans();
        })
      );
    }
    // Populate plan select for create member form
    const planSelect = document.getElementById("plan-select-create");
    if (planSelect) {
      planSelect.innerHTML = cachedPlans.map(pl => `<option value="${pl.id}">${pl.name} (₹${pl.price} / ${pl.durationDays} days)</option>`).join("");
    }
  } catch (e) {
    if (!silent) toast(e.message, "error");
  }
}
document.getElementById("plan-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    await apiFetch("/admin/plans", {
      method: "POST",
      body: JSON.stringify({
        name: data.name,
        category: data.category,
        durationDays: Number(data.durationDays),
        price: Number(data.price),
        features: data.features ? data.features.split(",").map((f) => f.trim()) : [],
      }),
    });
    toast("Plan created", "success");
    e.target.reset();
    loadPlans();
  } catch (err) {
    toast(err.message, "error");
  }
});

// ---- Trainers (PRD 13) ----
async function loadTrainers() {
  const container = document.getElementById("trainers-list");
  container.innerHTML = `<div class="muted">Loading…</div>`;
  try {
    const trainers = await apiFetch("/trainers");
    container.innerHTML = trainers.length
      ? trainers
          .map(
            (t) => `<div class="card">
              <div class="card-title">${t.name} <button class="btn btn-danger btn-sm" data-remove-trainer="${t.id}">Remove</button></div>
              <div class="muted">${t.specialty}</div>
              <div class="mt-8">${t.mobile}</div>
            </div>`
          )
          .join("")
      : `<div class="muted">No trainers added yet.</div>`;
    container.querySelectorAll("[data-remove-trainer]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await apiFetch(`/admin/trainers/${btn.dataset.removeTrainer}`, { method: "DELETE" });
        toast("Trainer removed", "success");
        loadTrainers();
      })
    );
  } catch (e) {
    container.innerHTML = `<div class="muted">Couldn't load trainers: ${e.message}</div>`;
  }
}
document.getElementById("trainer-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    await apiFetch("/admin/trainers", { method: "POST", body: JSON.stringify(data) });
    toast("Trainer added", "success");
    e.target.reset();
    loadTrainers();
  } catch (err) {
    toast(err.message, "error");
  }
});

// ---- Announcements (PRD 17) ----
async function loadAnnouncements() {
  const container = document.getElementById("announcements-admin-list");
  container.innerHTML = `<div class="muted">Loading…</div>`;
  try {
    const list = await apiFetch("/announcements");
    container.innerHTML = list.length
      ? list
          .map(
            (a) => `<div class="card">
              <div class="card-title">${a.title} <div class="flex gap-8"><button class="btn btn-ghost btn-sm" data-edit-ann="${a.id}">Edit</button><button class="btn btn-danger btn-sm" data-remove-ann="${a.id}">Delete</button></div></div>
              <div class="flex gap-8 mt-8"><span class="badge badge-muted">${a.category}</span><span class="badge ${a.pinned ? "badge-success" : "badge-muted"}">${a.pinned ? "Pinned" : "Normal"}</span><span class="badge ${a.active === false ? "badge-danger" : "badge-success"}">${a.active === false ? "Inactive" : "Active"}</span></div>
              <p class="muted mt-8">${a.message}</p>
            </div>`
          )
          .join("")
      : `<div class="muted">No announcements yet.</div>`;
    container.querySelectorAll("[data-remove-ann]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await apiFetch(`/admin/announcements/${btn.dataset.removeAnn}`, { method: "DELETE" });
        toast("Announcement deleted", "success");
        loadAnnouncements();
      })
    );
    container.querySelectorAll("[data-edit-ann]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const title = window.prompt("Title:");
        if (!title) return;
        const message = window.prompt("Message:");
        if (!message) return;
        await apiFetch(`/admin/announcements/${btn.dataset.editAnn}`, { method: "PUT", body: JSON.stringify({ title, message }) });
        toast("Announcement updated", "success");
        loadAnnouncements();
      })
    );
  } catch (e) {
    container.innerHTML = `<div class="muted">Couldn't load announcements: ${e.message}</div>`;
  }
}
document.getElementById("announcement-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    await apiFetch("/admin/announcements", { method: "POST", body: JSON.stringify(data) });
    toast("Announcement posted", "success");
    e.target.reset();
    loadAnnouncements();
  } catch (err) {
    toast(err.message, "error");
  }
});

// ---- Support / Helpdesk ----
async function loadSupportTickets() {
  const container = document.getElementById("support-tickets-list");
  container.innerHTML = `<div class="muted">Loading…</div>`;
  try {
    const search = document.getElementById("support-search")?.value || "";
    const status = document.getElementById("support-status-filter")?.value || "";
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    const tickets = await apiFetch(`/admin/support-tickets?${params.toString()}`);
    container.innerHTML = tickets.length
      ? tickets.map((t) => `<div class="card">
          <div class="card-title">${t.memberName || "Unknown"} <span class="badge badge-muted mono">${t.memberId || "—"}</span></div>
          <div class="flex gap-8 mt-8"><span class="badge badge-muted">${t.type || "query"}</span><span class="badge ${t.status === "resolved" ? "badge-success" : t.status === "pending" ? "badge-warning" : "badge-danger"}">${t.status || "open"}</span></div>
          <p class="mt-8">${t.message || ""}</p>
          <div class="muted mt-8" style="font-size:12px;">${formatDate(t.createdAt)}</div>
          <div class="flex gap-8 mt-16" style="flex-wrap:wrap;">
            <button class="btn btn-ghost btn-sm" data-ticket-reply="${t.uid}:${t.ticketId}">Reply</button>
            <button class="btn btn-ghost btn-sm" data-ticket-status="${t.uid}:${t.ticketId}:pending">Pending</button>
            <button class="btn btn-success btn-sm" data-ticket-status="${t.uid}:${t.ticketId}:resolved">Resolved</button>
            <button class="btn btn-danger btn-sm" data-ticket-delete="${t.uid}:${t.ticketId}">Delete</button>
          </div>
        </div>`).join("")
      : `<div class="muted">No tickets found.</div>`;

    container.querySelectorAll("[data-ticket-reply]").forEach((btn) => btn.addEventListener("click", async () => {
      const [uid, ticketId] = btn.dataset.ticketReply.split(":");
      const reply = window.prompt("Reply to this ticket:");
      if (!reply) return;
      await apiFetch(`/admin/support-tickets/${uid}/${ticketId}`, { method: "PUT", body: JSON.stringify({ reply, status: "pending" }) });
      toast("Reply sent", "success");
      loadSupportTickets();
    }));
    container.querySelectorAll("[data-ticket-status]").forEach((btn) => btn.addEventListener("click", async () => {
      const [uid, ticketId, statusValue] = btn.dataset.ticketStatus.split(":");
      await apiFetch(`/admin/support-tickets/${uid}/${ticketId}`, { method: "PUT", body: JSON.stringify({ status: statusValue }) });
      toast("Ticket updated", "success");
      loadSupportTickets();
    }));
    container.querySelectorAll("[data-ticket-delete]").forEach((btn) => btn.addEventListener("click", async () => {
      const [uid, ticketId] = btn.dataset.ticketDelete.split(":");
      await apiFetch(`/admin/support-tickets/${uid}/${ticketId}`, { method: "DELETE" });
      toast("Ticket deleted", "success");
      loadSupportTickets();
    }));
  } catch (e) {
    container.innerHTML = `<div class="muted">Couldn't load tickets: ${e.message}</div>`;
  }
}
document.getElementById("support-search")?.addEventListener("input", debounce(loadSupportTickets, 300));
document.getElementById("support-status-filter")?.addEventListener("change", loadSupportTickets);

// ---- Reports (PRD 18) ----
async function loadReports() {
  const chart = document.getElementById("revenue-chart");
  chart.innerHTML = `<div class="muted">Loading…</div>`;
  try {
    const revenue = await apiFetch("/admin/reports/revenue?days=30");
    const entries = Object.entries(revenue).sort(([a], [b]) => (a > b ? 1 : -1));
    const max = Math.max(...entries.map(([, v]) => v), 1);
    chart.innerHTML = entries.length
      ? entries
          .map(
            ([day, amt]) => `<div title="${day}: ${formatCurrency(amt)}" style="flex:1;background:linear-gradient(180deg,var(--amber),var(--orange));height:${Math.max(4, (amt / max) * 100)}%;border-radius:4px 4px 0 0;"></div>`
          )
          .join("")
      : `<div class="muted">No revenue recorded in this window.</div>`;
  } catch (e) {
    chart.innerHTML = `<div class="muted">Couldn't load report: ${e.message}</div>`;
  }
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
