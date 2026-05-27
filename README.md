# LDR Companion — VS Code Setup Guide

[![Build Status](https://github.com/EvaChiTech/ldr-companion/actions/workflows/webpack.yml/badge.svg)](https://github.com/EvaChiTech/ldr-companion/actions)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-yellow.svg)](package.json)
[![Vite](https://img.shields.io/badge/Vite-8.0-646CFF.svg)](https://vitejs.dev)

A real-time long-distance relationship web app.
Built for people far away from each other to keep each other connected in real time.

**Stack:** Vite · Vanilla JS (ES modules) · Supabase · Claude AI

---

## Project Structure

```
ldr-companion/
├── index.html          ← App shell (HTML only, no logic)
├── src/
│   ├── main.js         ← App logic & UI controllers
│   ├── styles.css      ← All styles
│   ├── supabase.js     ← Supabase client
│   ├── db.js           ← All database operations
│   ├── realtime.js     ← Supabase Realtime subscriptions
│   ├── ai.js           ← Claude API (date idea generator)
│   ├── clocks.js       ← Timezone utilities
│   └── state.js        ← App state & session
├── schema.sql          ← Run once in Supabase SQL Editor
├── .env                ← YOUR API KEYS (never commit this)
├── .env.example        ← Template (safe to commit)
├── package.json
├── vite.config.js
└── .gitignore
```

---

## Step 1 — Open in VS Code

```bash
# Move into the project folder
cd ldr-companion

# Open in VS Code
code .
```

Install the recommended extensions when prompted, or manually install:
- **ESLint** — `dbaeumer.vscode-eslint`
- **Prettier** — `esbenp.prettier-vscode`
- **Supabase** — `supabase.vscode-supabase-extension` *(optional but nice)*

---

## Step 2 — Install dependencies

Open the **integrated terminal** in VS Code with `` Ctrl+` `` (backtick):

```bash
npm install
```

This installs Vite and the Supabase JS client.

---

## Step 3 — Create your Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up for free
2. Click **New project**
3. Name it `ldr-companion`, set a strong password, pick a region close to you
4. Wait ~90 seconds while it provisions

---

## Step 4 — Run the database schema

1. In your Supabase dashboard, click **SQL Editor** in the left sidebar
2. Click **+ New query**
3. Open `schema.sql` from this project in VS Code
4. Select all (`Ctrl+A`), copy it, paste into the Supabase SQL editor
5. Click **Run** (or `Ctrl+Enter`)
6. You should see: *"Success. No rows returned"*

---

## Step 5 — Enable Realtime

If the schema didn't auto-enable it:

1. In Supabase → **Database → Replication**
2. Under `supabase_realtime`, toggle ON for:
   - `messages`
   - `moods`
   - `notes`
   - `bucket_items`
   - `milestones`

---

## Step 6 — Get your API keys

### Supabase keys
1. In Supabase → **Project Settings → API**
2. Copy:
   - **Project URL** → `https://xxxxxxxxxx.supabase.co`
   - **anon / public** key → `eyJhbGci...`

### Anthropic API key
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Click **Settings → API Keys → Create Key**
4. Copy the key starting with `sk-ant-...`

> 🔒 **The Anthropic key never goes in `.env` or any `VITE_` variable.**
> Anything prefixed `VITE_` is compiled into the public client bundle and is
> readable by every visitor. The AI calls run through Supabase Edge Functions —
> set the key as an Edge Function secret instead:
>
> ```
> supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
> ```

---

## Step 7 — Add keys to .env

In VS Code, open `.env` and fill in your values:

```env
VITE_SUPABASE_URL=https://xxxxxxxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxx
```

The Anthropic key is **not** here — see the note above; it lives only as a
Supabase Edge Function secret. Save the file. The `.gitignore` already
excludes `.env` from git.

---

## Step 8 — Run the dev server

In the VS Code terminal:

```bash
npm run dev
```

You'll see:

```
  VITE v5.x.x  ready in 300ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
```

Open `http://localhost:5173` in your browser. The app is running!

---

## Step 9 — Test with two browser windows

To simulate both partners on the same machine:

1. Open `http://localhost:5173` in **Chrome**
2. Open the same URL in **Firefox** (or a Chrome incognito window)
3. On Chrome: click **Create**, fill in details (Emeka + Aino works great), click Create
4. Copy the 8-character room code from the top bar
5. On Firefox: click **Join**, paste the code, select partner 2

You now have two live windows. Send a chat message in one — watch it appear instantly in the other. Change a mood — it syncs. Write a note — it updates in real time.

---

## Step 10 — Deploy (Free)

### Option A: Netlify (drag & drop, fastest)
```bash
npm run build   # creates dist/ folder
```
Then drag the `dist/` folder to [app.netlify.com/drop](https://app.netlify.com/drop)
You get a live URL in seconds.

### Option B: Netlify CLI
```bash
npm install -g netlify-cli
netlify deploy --prod --dir=dist
```

### Option C: Vercel
```bash
npm install -g vercel
vercel --prod
```
Vercel auto-detects Vite. Your `.env` variables need to be added in the Vercel dashboard under **Project Settings → Environment Variables**.

### Option D: GitHub Pages
```bash
# In vite.config.js, add: base: '/your-repo-name/'
npm run build
# Then push dist/ to the gh-pages branch, or use the gh-pages npm package
```

> **Important:** When deploying, add your environment variables to the hosting platform's dashboard — don't commit `.env`.

---

## How the couple connects

1. **Emeka** (creator) goes to the deployed URL, clicks **Create**
2. Fills in: Emeka / Seoul · Aino / Helsinki · their start date
3. Gets room code, e.g. `HK7XM2NQ` — sends it to Aino via WhatsApp
4. **Aino** opens the same URL, clicks **Join**, types `HK7XM2NQ`
5. Picks her name — she's in
6. From this moment: chat is instant WebSocket, moods/notes sync live

---

## Environment Variable Reference

| Variable | Where it goes | Where to get it | Required |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `.env` / Vercel env | Supabase → Project Settings → API → Project URL | ✅ Yes |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env` / Vercel env | Supabase → Project Settings → API → publishable | ✅ Yes |
| `ANTHROPIC_API_KEY` | Supabase Edge Function **secret** (never a `VITE_` var) | console.anthropic.com → API Keys | For AI ideas |
| `ALLOWED_ORIGINS` | Supabase Edge Function secret | your deployed origin(s), comma-separated | Recommended |

---

## Common Issues

**"Room not found"**
→ Make sure you ran `schema.sql` in Supabase and the project URL in `.env` is correct.

**Messages send but don't appear in real time**
→ Go to Supabase → Database → Replication and make sure `messages` table has Realtime enabled.

**AI ideas button does nothing**
→ Confirm the `ANTHROPIC_API_KEY` secret is set on your Supabase Edge Functions (`supabase secrets list`). Open DevTools → Network tab and check the call to `/functions/v1/generate-date-ideas`; inspect the Supabase Edge Function logs for the real error.

**Vite says "cannot find module"**
→ Run `npm install` again. Make sure you're in the project root directory.

---

*Built for the couples keeping love alive across oceans.*
