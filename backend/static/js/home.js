import { API_BASE } from "./firebase-config.js";
import { formatCurrency } from "./common.js";

async function loadPlans() {
  const grid = document.getElementById("plans-grid");
  try {
    const res = await fetch(`${API_BASE}/plans`);
    const body = await res.json();
    const plans = body.data || [];
    if (!plans.length) {
      grid.innerHTML = `<div class="card muted">No plans published yet — check back soon.</div>`;
      return;
    }
    grid.innerHTML = plans
      .map(
        (p) => `
      <div class="card">
        <div class="card-title">${p.name} <span class="badge badge-muted">${p.category || "plan"}</span></div>
        <div class="stat-tile">
          <div class="value">${formatCurrency(p.price)}</div>
          <div class="label">${p.durationDays} days</div>
        </div>
        <ul class="muted mt-16" style="padding-left:18px;font-size:13px;line-height:1.8;">
          ${(p.features || []).map((f) => `<li>${f}</li>`).join("")}
        </ul>
      </div>`
      )
      .join("");
  } catch (e) {
    grid.innerHTML = `<div class="card muted">Couldn't load plans right now.</div>`;
  }
}
loadPlans();
