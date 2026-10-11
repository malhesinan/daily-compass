# Daily Compass

Your daily board (Today check-in, Timeline, To-do with a ★ Next 5 queue, Mind, Plans, Wish list, Portfolio, Notes)
as a Home Screen app for iPhone and a website for your laptop. Everything syncs between devices through Supabase,
keeps working offline, and updates live.

**Stack:** Vite + plain JavaScript (static site on GitHub Pages) · Supabase free tier (Postgres, Auth, Row Level Security, Realtime).
Everything here is free. Nothing requires a paid plan.

---

## 1. Create the Supabase project (one time, ~10 min)

1. Go to <https://supabase.com>, sign in, and click **New project** (Free plan). Pick a region close to you
   (e.g. *Middle East (Bahrain)* or *Central EU (Frankfurt)*). Save the database password somewhere safe; the app doesn't need it.
2. **Create the table:** open **SQL Editor → New query**, paste all of [`supabase/migrations/001_docs.sql`](supabase/migrations/001_docs.sql), click **Run**.
   It should say "Success. No rows returned".
3. **Create your user:** you sign in with a **username** and a **4-digit code**. Behind the scenes that is a normal
   Supabase user with email `<username>@users.daily-compass.app` and password `dc:<username>:<code>`.
   **Authentication → Users → Add user → Create new user** with email `yourname@users.daily-compass.app`,
   password `dc:yourname:1234`, and tick **Auto Confirm User**. (Username in lowercase.)

   **Already have a user from the old email-code login?** Keep your data by renaming it instead:
   ```sql
   update auth.users
   set email = 'yourname@users.daily-compass.app',
       encrypted_password = extensions.crypt('dc:yourname:1234', extensions.gen_salt('bf'))
   where email = 'your-old-email@example.com';
   ```
   To change your code later, run the same `update` with the new code (and `where email = 'yourname@users.daily-compass.app'`).
4. **Turn off public sign-ups:** **Authentication → Sign In / Providers**, switch off **Allow new users to sign up**, then Save.
   From now on nobody else can create an account. Row Level Security also stops any other account from reading your rows.
5. **Check that email sign-in is on:** **Authentication → Sign In / Providers → Email** should be enabled (it is by default).
6. **Set the site address:** **Authentication → URL Configuration**
   - **Site URL:** `https://<your-github-username>.github.io/daily-compass/`
   - **Redirect URLs:** add `http://localhost:5173/**` (for local development)
7. **Copy your keys:** **Project Settings → API Keys** (or *Data API*). You need the **Project URL** and the
   **anon / publishable** key. (This key is meant to be public; your data is protected by login + RLS. Never use the `service_role`/secret key in the app.)

8. **Automatic stock prices:** **Edge Functions → Deploy a new function → Via Editor**. Name it exactly `quotes`,
   replace the example code with everything in [`supabase/functions/quotes/index.ts`](supabase/functions/quotes/index.ts), and click **Deploy**.
   Leave "Verify JWT" switched on, so only you (signed in) can use it. The app then fills in each holding's last price from
   Yahoo Finance (free, about 15 minutes delayed) when it opens, when you open the Portfolio tab, or when you tap **Refresh prices**.
   Kuwait tickers are looked up as `<TICKER>.KW` and converted from fils to KWD.

> **Free tier notes:** Supabase pauses a free project after about 7 days without any use. Your data is kept, and you
> click **Restore** in the dashboard to wake it. Daily use keeps it awake.

## 2. Run it on your computer

Install [Node.js](https://nodejs.org) (LTS), then in this folder:

```bash
npm install
```

```bash
cp .env.example .env.local
```

Put your Project URL and anon key into `.env.local`, then:

```bash
npm run dev
```

Open <http://localhost:5173>. If `.env.local` is missing or empty, the app runs in **demo mode** (no login, saved only in that browser).
This is handy for trying the UI.

## 3. Deploy to GitHub Pages (one time)

1. Create a new GitHub repository named `daily-compass` and push this folder to it (branch `main`).
   GitHub Pages is free for public repositories. The code has no secrets in it.
2. **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables tab → New repository variable**, add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon / publishable key
4. Go to **Actions → Deploy to GitHub Pages → Run workflow** (or just push to `main`). After about a minute the app is live at
   `https://<your-github-username>.github.io/daily-compass/`.

If you use a different repo name, the address changes to match, and you should update the Site URL in step 1.6.
For a custom domain, also add a variable `BASE_PATH` = `/`.

## 4. Install on iPhone

Open the site in **Safari** → **Share** → **Add to Home Screen**. Open it from the Home Screen icon and enter your username and 4-digit code.
That device stays signed in until the next deploy; after each deploy every device asks for the code once.

## Moving your data in

At the bottom of any page, tap **Import** and paste either of these:
- **A Daily Compass backup**: the file from **Export backup**, or the `daily-compass-export.json` made from the Claude artifact.
  Everything comes across: tasks, check-ins and streak, Mind, plans, wishes, notes, portfolio and chart history.
- **The old task-list prototype** (a JSON array). Mapping: `now → High`, `soon → Normal`, `later → Low`.
  Categories: Investments/Finance → Investment, Wish list → the Wish list tab, anything else → Personal.
  Pinned tasks go into Next 5 while there is room.

Importing adds to what's there. Running the same backup twice doesn't create duplicates, because items keep their ids.

## How it works (short version)

| File | What it does |
|---|---|
| `src/app.js` | The whole app: screens, actions, and the sync engine (search for "store") |
| `src/main.js` | Start-up and the sign-in screen |
| `src/importData.js` | Import (backup or old task list) and Export backup |
| `src/styles.css` | All styling, including dark mode |
| `public/sw.js` | Service worker: lets the app open offline |
| `public/manifest.webmanifest` | Makes it installable ("Add to Home Screen") |
| `supabase/migrations/001_docs.sql` | Database table and security rules |
| `.github/workflows/deploy.yml` | Builds and publishes to GitHub Pages on every push to `main` |

If two devices edit the same task while offline, the last one to sync wins.
