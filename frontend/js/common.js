import { authClient, API_BASE } from "./firebase-config.js";

export function toast(message, type = "info") {
  let root = document.getElementById("toast-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "toast-root";
    document.body.appendChild(root);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/** Authenticated fetch — attaches the current user's Firebase ID token. */
export async function apiFetch(path, options = {}) {
  const user = authClient.currentUser;
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (user) {
    const token = await user.getIdToken();
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body.data !== undefined ? body.data : body;
}

export function requireAuthRedirect(onUser) {
  authClient.onAuthStateChanged((user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    onUser(user);
  });
}

export function formatCurrency(n) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
}

export function formatDate(d) {
  if (!d) return "—";
  const date = d.seconds ? new Date(d.seconds * 1000) : new Date(d);
  if (isNaN(date)) return "—";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function daysRemaining(renewalDate) {
  if (!renewalDate) return null;
  const date = renewalDate.seconds ? new Date(renewalDate.seconds * 1000) : new Date(renewalDate);
  const diff = Math.ceil((date - new Date()) / (1000 * 60 * 60 * 24));
  return diff;
}

export function skeletonRows(count, height = "18px") {
  return Array.from({ length: count })
    .map(() => `<div class="skeleton" style="height:${height};margin-bottom:10px;"></div>`)
    .join("");
}
