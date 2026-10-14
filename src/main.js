import "./styles.css";
import { supabase } from "./supabase.js";
import { startApp } from "./app.js";

const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Sign in once per device with email + password (Supabase keeps the session).
// After that, a 4-digit passcode kept only on this device unlocks the app every time it opens or comes back to the front.
const PASS_KEY = "dc-passcode"; // { salt, hash }: PBKDF2 of the code, never the code itself
const TRIES_KEY = "dc-passcode-tries";
const MAX_TRIES = 5; // then this device is signed out and needs email + password again

async function hashCode(code, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 200000 }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
function savedPass() {
  try { return JSON.parse(localStorage.getItem(PASS_KEY)); } catch { return null; }
}

async function boot() {
  if (!supabase) return startApp({ supabase: null, userId: null }); // demo mode

  const { data } = await supabase.auth.getSession();
  let userId = data.session?.user.id;
  // Offline and the saved sign-in couldn't be refreshed: open with the data cached on this device (still behind the passcode).
  if (!userId && !navigator.onLine && savedPass()) userId = localStorage.getItem("dc-last-user");
  if (userId) {
    await (savedPass() ? unlock() : choosePasscode());
    return begin(userId);
  }

  showLogin();
  const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
    if (event === "SIGNED_IN" && s) {
      sub.subscription.unsubscribe();
      choosePasscode().then(() => begin(s.user.id));
    }
  });
}

function begin(userId) {
  localStorage.setItem("dc-last-user", userId);
  startApp({ supabase, userId });
  // Lock as soon as the app goes to the background, so it also stays hidden in the app switcher.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && savedPass()) unlock();
  });
}

function showLogin(email = localStorage.getItem("dc-email") || "", error = "") {
  app.innerHTML =
    '<header class="head"><div><div class="eyebrow">Daily Compass</div><h1>Sign in</h1></div></header>' +
    '<form class="card" id="login">' +
    '<div class="field"><label for="l-email">Email</label><input type="email" id="l-email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required value="' + esc(email) + '"></div>' +
    '<div class="field"><label for="l-pass">Password</label><input type="password" id="l-pass" autocomplete="current-password" required></div>' +
    '<button class="btn" id="l-go">Sign in</button>' +
    '<p class="muted" style="margin:0;font-size:13px">You only need this the first time on each device. After that the app opens with your 4-digit passcode.</p>' +
    (error ? '<div class="notice" role="alert">' + esc(error) + "</div>" : "") +
    "</form>";

  const go = document.getElementById("l-go");
  document.getElementById(email ? "l-pass" : "l-email").focus();

  document.getElementById("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    email = document.getElementById("l-email").value.trim().toLowerCase();
    const password = document.getElementById("l-pass").value;
    go.disabled = true;
    go.textContent = "Checking…";
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return showLogin(email, /invalid login/i.test(error.message) ? "Wrong email or password." : error.message);
    localStorage.setItem("dc-email", email);
    // On success, onAuthStateChange (above) asks for a passcode and opens the app.
  });
}

// ---- Passcode screens: a full-screen overlay with a number pad ----

let locked = null; // the open lock screen's promise, so hiding the app twice doesn't stack screens

function padScreen({ title, sub, forgot, onCode }) {
  const el = document.createElement("div");
  el.className = "lock";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.innerHTML =
    '<div class="lock-in"><div class="eyebrow">Daily Compass</div><h1></h1><div class="muted sub"></div>' +
    '<div class="dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="lock-err" role="alert"></div>' +
    '<div class="keypad">' +
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => '<button type="button" data-k="' + n + '">' + n + "</button>").join("") +
    (forgot ? '<button type="button" class="txt" data-k="forgot">Forgot?</button>' : "<span></span>") +
    '<button type="button" data-k="0">0</button><button type="button" class="txt" data-k="del" aria-label="Delete">Delete</button>' +
    "</div></div>";
  document.body.appendChild(el);
  const behind = [app, document.querySelector(".tabs")];
  behind.forEach((n) => n && (n.inert = true));

  let code = "", busy = false;
  const dots = el.querySelector(".dots"), err = el.querySelector(".lock-err");
  const set = (t, s) => { el.querySelector("h1").textContent = t; el.querySelector(".sub").textContent = s || ""; };
  const draw = () => dots.querySelectorAll("i").forEach((d, i) => d.classList.toggle("on", i < code.length));
  set(title, sub);

  return new Promise((resolve) => {
    const close = () => {
      document.removeEventListener("keydown", onKey);
      el.remove();
      behind.forEach((n) => n && (n.inert = false));
      resolve();
    };
    const press = async (k) => {
      if (busy) return;
      if (k === "forgot") return forgot();
      if (k === "del") { code = code.slice(0, -1); return draw(); }
      if (code.length >= 4) return;
      code += k;
      err.textContent = "";
      draw();
      if (code.length < 4) return;
      busy = true;
      const res = await onCode(code, set);
      busy = false;
      code = "";
      if (res === true) return close();
      if (res) {
        err.textContent = res;
        dots.classList.remove("shake");
        void dots.offsetWidth; // restart the shake animation
        dots.classList.add("shake");
      }
      draw();
    };
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("del");
    };
    el.addEventListener("click", (e) => { const k = e.target.closest("[data-k]")?.dataset.k; if (k) press(k); });
    document.addEventListener("keydown", onKey);
  });
}

function unlock() {
  if (locked) return locked;
  locked = padScreen({
    title: "Enter passcode",
    forgot: () => {
      if (confirm("Sign out on this device? You'll sign in again with your email and password, then choose a new passcode.")) forgetDevice();
    },
    onCode: async (code) => {
      const p = savedPass();
      if (p && (await hashCode(code, p.salt)) === p.hash) {
        localStorage.removeItem(TRIES_KEY);
        return true;
      }
      const tries = Number(localStorage.getItem(TRIES_KEY) || 0) + 1;
      localStorage.setItem(TRIES_KEY, String(tries));
      if (tries >= MAX_TRIES) return forgetDevice(), "Too many tries. Signing out…";
      const left = MAX_TRIES - tries;
      return "Wrong passcode. " + left + (left === 1 ? " try" : " tries") + " left.";
    },
  }).then(() => { locked = null; });
  return locked;
}

function choosePasscode() {
  let first = "";
  return padScreen({
    title: "Choose a passcode",
    sub: "4 digits. You'll enter it every time you open the app on this device.",
    onCode: async (code, set) => {
      if (!first) {
        first = code;
        set("Enter it again", "To make sure it's right.");
        return null;
      }
      if (code !== first) {
        first = "";
        set("Choose a passcode", "4 digits. You'll enter it every time you open the app on this device.");
        return "Those didn't match. Try again.";
      }
      const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(PASS_KEY, JSON.stringify({ salt, hash: await hashCode(code, salt) }));
      localStorage.removeItem(TRIES_KEY);
      return true;
    },
  });
}

// Signs this device out and drops its passcode. Cached data and unsynced changes stay, so nothing is lost on sign-in again.
async function forgetDevice() {
  localStorage.removeItem(PASS_KEY);
  localStorage.removeItem(TRIES_KEY);
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  location.reload();
}

boot();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js");
}
