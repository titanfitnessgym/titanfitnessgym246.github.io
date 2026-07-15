// Firebase client SDK config — get these values from
// Firebase Console > Project Settings > General > Your apps > SDK setup and config
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCMs19CSD24DC6txy5ovr717AiOUOo75JQ",
  authDomain: "gym-management-system-c63f7.firebaseapp.com",
  projectId: "gym-management-system-c63f7",
  storageBucket: "gym-management-system-c63f7.firebasestorage.app",
  messagingSenderId: "857464716429",
  appId: "1:857464716429:web:93ca3270ba42e5a410b6c4",
  measurementId: "G-QN3DQBZSJ0",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const authClient = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

// Same-origin API base so the frontend can be served by Flask in production.
export const API_BASE = "/api";
