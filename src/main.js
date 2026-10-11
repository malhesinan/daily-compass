import "./styles.css";
import { supabase } from "./supabase.js";
import { startApp } from "./app.js";

const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Each deploy gets its own build id (set in deploy.yml). A device stays signed in until the next deploy.
const BUILD = import.meta.env.VITE_BUILD_ID || "dev";
const BUILD_KEY = "dc-build";

// Username + 4-digit PIN, backed by a normal Supabase email/password user:
// the email is "<username>@" + LOGIN_DOMAIN and the password is "dc:<username>:<pin>" (Supabase needs 6+ characters).
const LOGIN_DOMAIN = "users.daily-compass.app";
const toEmail = (user) => user + "@" + LOGIN_DOMAIN;
const toPassword = (user, pin) => "dc:" + user + ":" + pin;

async function boot() {
  if (!supabase) return startApp({ supabase: null, userId: null }); // demo mode

  const sameBuild = localStorage.getItem(BUILD_KEY) === BUILD;
  if (!sameBuild) await supabase.auth.signOut({ scope: "local" }).catch(() => {});

  const { data } = await supabase.auth.getSession();
  const session = sameBuild ? data.session : null;
  // Offline and the saved sign-in couldn't be refreshed: open with the data cached on this device.
  if (!session && sameBuild && !navigator.onLine && localStorage.getItem("dc-last-user")) {
    return startApp({ supabase, userId: localStorage.getItem("dc-last-user") });
  }
  if (session) return begin(session);

  showLogin();
  const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
    if (s) {
      sub.subscription.unsubscribe();
      begin(s);
    }
  });
}

function begin(session) {
  localStorage.setItem(BUILD_KEY, BUILD);
  localStorage.setItem("dc-last-user", session.user.id);
  startApp({ supabase, userId: session.user.id });
}

function showLogin(user = localStorage.getItem("dc-username") || "", error = "") {
  app.innerHTML =
    '<header class="head"><div><div class="eyebrow">Daily Compass</div><h1>Sign in</h1></div></header>' +
    '<form class="card" id="login">' +
    '<div class="field"><label for="l-user">Username</label><input type="text" id="l-user" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required value="' + esc(user) + '"></div>' +
    '<div class="field"><label for="l-pin">4-digit code</label><input type="password" id="l-pin" inputmode="numeric" autocomplete="current-password" pattern="[0-9]{4}" maxlength="4" required></div>' +
    '<button class="btn" id="l-go">Sign in</button>' +
    (error ? '<div class="notice" role="alert">' + esc(error) + "</div>" : "") +
    "</form>";

  const go = document.getElementById("l-go");
  document.getElementById(user ? "l-pin" : "l-user").focus();

  document.getElementById("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    user = document.getElementById("l-user").value.trim().toLowerCase();
    const pin = document.getElementById("l-pin").value.replace(/\D/g, "");
    go.disabled = true;
    go.textContent = "Checking…";
    const { error } = await supabase.auth.signInWithPassword({ email: toEmail(user), password: toPassword(user, pin) });
    if (error) return showLogin(user, /invalid login/i.test(error.message) ? "Wrong username or code." : error.message);
    localStorage.setItem("dc-username", user);
    // On success, onAuthStateChange (above) opens the app.
  });
}

boot();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js");
}
