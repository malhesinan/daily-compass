import "./styles.css";
import { supabase } from "./supabase.js";
import { startApp } from "./app.js";

const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function boot() {
  if (!supabase) return startApp({ supabase: null, userId: null }); // demo mode

  const { data } = await supabase.auth.getSession();
  let session = data.session;
  // Offline and the saved sign-in couldn't be refreshed: open with the data cached on this device.
  if (!session && !navigator.onLine && localStorage.getItem("dc-last-user")) {
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
  localStorage.setItem("dc-last-user", session.user.id);
  startApp({ supabase, userId: session.user.id });
}

// Sign in with a code sent by email. (A code, because on iPhone an email link opens in Safari,
// not in the Home Screen app, which keeps its own separate sign-in.)
function showLogin(step = "email", email = localStorage.getItem("dc-email") || "", error = "") {
  app.innerHTML =
    '<header class="head"><div><div class="eyebrow">Daily Compass</div><h1>Sign in</h1></div></header>' +
    '<form class="card" id="login">' +
    (step === "email"
      ? '<div class="field"><label for="l-email">Your email</label><input type="email" id="l-email" autocomplete="email" required value="' + esc(email) + '"></div>' +
        '<button class="btn" id="l-go">Email me a code</button>'
      : '<p class="hint">We sent a code to <b>' + esc(email) + "</b>. Type it here.</p>" +
        '<div class="field"><label for="l-code">Code from the email</label><input type="text" id="l-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" required></div>' +
        '<button class="btn" id="l-go">Sign in</button><button type="button" class="linkbtn" id="l-back">Use a different email or resend</button>') +
    (error ? '<div class="notice" role="alert">' + esc(error) + "</div>" : "") +
    "</form>";

  const go = document.getElementById("l-go");
  document.getElementById("l-back")?.addEventListener("click", () => showLogin("email", email));
  if (step === "code") document.getElementById("l-code").focus();

  document.getElementById("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    go.disabled = true;
    if (step === "email") {
      email = document.getElementById("l-email").value.trim();
      go.textContent = "Sending…";
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: location.href.split("#")[0] },
      });
      if (error) return showLogin("email", email, /signups? not allowed/i.test(error.message) ? "This email isn't allowed to sign in." : error.message);
      localStorage.setItem("dc-email", email);
      showLogin("code", email);
    } else {
      go.textContent = "Checking…";
      const token = document.getElementById("l-code").value.replace(/\D/g, "");
      const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
      if (error) showLogin("code", email, "That code didn't work. Check the latest email, or send a new code.");
      // On success, onAuthStateChange (above) opens the app.
    }
  });
}

boot();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js");
}
