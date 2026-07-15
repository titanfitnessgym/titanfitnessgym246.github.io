import { authClient, API_BASE } from "./firebase-config.js";

/**
 * Shared mobile navigation behavior. The dashboard markup keeps the same
 * sidebar/nav elements and this only adds the responsive presentation layer.
 */
export function setupResponsiveSidebar() {
  const sidebar = document.getElementById("sidebar");
  const toggle = document.getElementById("mobile-menu-toggle");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (!sidebar || !toggle) return;

  const setOpen = (open) => {
    sidebar.classList.toggle("open", open);
    backdrop?.classList.toggle("visible", open);
    document.body.classList.toggle("sidebar-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
  };

  toggle.addEventListener("click", () => setOpen(!sidebar.classList.contains("open")));
  backdrop?.addEventListener("click", () => setOpen(false));
  sidebar.querySelectorAll(".nav-link[data-section]").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) setOpen(false);
  });
}

setupResponsiveSidebar();

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
      window.location.href = "/login";
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
