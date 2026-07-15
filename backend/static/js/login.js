import { authClient } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { toast } from "./common.js";

// If already logged in, skip straight to the right dashboard.
onAuthStateChanged(authClient, async (user) => {
  if (user) {
    const token = await user.getIdTokenResult();
    redirectByRole(token.claims.role);
  }
});

function redirectByRole(role) {
  if (["admin", "owner", "manager", "receptionist"].includes(role)) {
    window.location.href = "/admin";
  } else {
    window.location.href = "/member";
  }
}

const form = document.getElementById("login-form");
const submitBtn = document.getElementById("login-submit");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  submitBtn.disabled = true;
  submitBtn.textContent = "Signing in…";
  try {
    await setPersistence(
      authClient,
      data.remember ? browserLocalPersistence : browserSessionPersistence
    );
    const cred = await signInWithEmailAndPassword(authClient, data.email, data.password);
    const token = await cred.user.getIdTokenResult();
    toast("Welcome back!", "success");
    redirectByRole(token.claims.role);
  } catch (err) {
    toast("Login failed — check your email and password", "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "Log in";
  }
});

document.getElementById("forgot-link").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = form.email.value;
  if (!email) {
    toast("Enter your email above first", "error");
    return;
  }
  try {
    await sendPasswordResetEmail(authClient, email);
    toast("Password reset email sent", "success");
  } catch (err) {
    toast("Couldn't send reset email — check the address", "error");
  }
});

// Auto-logout after 20 minutes of inactivity (PRD: Session Management)
let inactivityTimer;
function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(async () => {
    if (authClient.currentUser) {
      await authClient.signOut();
      toast("Signed out due to inactivity", "info");
      window.location.href = "/login";
    }
  }, 20 * 60 * 1000);
}
["mousemove", "keydown", "click", "scroll"].forEach((evt) =>
  window.addEventListener(evt, resetInactivityTimer)
);
resetInactivityTimer();
