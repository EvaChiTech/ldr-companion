# Vercel Deployment Guide — LDR Companion

## ✅ Pre-Deployment Checklist

- ✅ Vite build configured (`npm run build` produces `dist/` folder)
- ✅ `vercel.json` configured with correct build settings
- ✅ `.env` and `.vercelignore` updated
- ✅ Repository pushed to GitHub
- ✅ Unnecessary Next.js files removed

## 🚀 Deploy to Vercel

### Step 1: Go to Vercel

1. Open https://vercel.com
2. Sign in with your GitHub account (or create one if needed)

### Step 2: Import Project

1. Click **"Add New..."** button
2. Select **"Project"**
3. Find and select **"ldr-companion"** repository
4. Click **"Import"**

### Step 3: Configure Project Settings

**In the "Configure Project" step:**

- **Framework Preset:** Vite *(it should auto-detect)*
- **Build Command:** `npm run build` *(auto-filled)*
- **Output Directory:** `dist` *(auto-filled)*
- **Install Command:** `npm install` *(default)*

### Step 4: Add Environment Variables

**CRITICAL:** This step must be done before deployment!

Click **"Environment Variables"** and add these two variables (use your own
project's values — never commit real values into this file):

```
VITE_SUPABASE_URL = https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY = sb_publishable_YOUR_KEY
```

⚠️ **The Anthropic API key is NOT a Vercel variable.**
A `VITE_`-prefixed key is bundled into the public client JS and would be
readable by anyone who visits the site. The key lives only as a Supabase
Edge Function secret:

```
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Get a key at [console.anthropic.com](https://console.anthropic.com) if you
don't have one. Also set, on the same Supabase secrets, an `ALLOWED_ORIGINS`
value (comma-separated list of your deployed origins) to lock down CORS.

### Step 5: Deploy

1. Click **"Deploy"**
2. Wait for the build to complete (usually 30-60 seconds)
3. You'll get a unique URL like `https://ldr-companion-xxx.vercel.app`

## ✨ After Deployment

1. **Test the app** at your new Vercel URL
2. **Share the URL** with your partner
3. Create a room together in the app

### If something doesn't work:

1. Check the **"Deployments"** tab for error logs
2. Click the failed deployment
3. Scroll to **"Build Logs"** to see what went wrong

## 🔧 Common Issues & Fixes

### Issue: "Missing environment variables"
**Fix:** Go to **"Settings"** → **"Environment Variables"** in Vercel and ensure both `VITE_*` variables are set.

### Issue: "Styling looks broken"
**Fix:** This is usually a browser cache issue. Press `Ctrl+Shift+R` (hard refresh) or clear browser cache.

### Issue: "Can't connect to Supabase"
**Fix:** 
1. Verify your Supabase URL in the environment variables
2. Ensure your Supabase project is active (check [supabase.com/dashboard](https://supabase.com/dashboard))
3. Run the SQL from `schema.sql` in your Supabase project once if not already done

### Issue: "AI date ideas not working"
**Fix:** 
1. Verify the `ANTHROPIC_API_KEY` secret is set on your Supabase Edge Functions (`supabase secrets list`)
2. Ensure your Anthropic account has credits/quota
3. Check the browser console (F12) and the Supabase Edge Function logs for errors

## 📝 Next Steps

After deployment:

1. **Custom Domain** (optional): 
   - In Vercel, go to **"Settings"** → **"Domains"**
   - Add your own domain (e.g., `myldrc.com`)

2. **Analytics** (optional):
   - Enable in Vercel **"Settings"** → **"Analytics"** to monitor usage

3. **Database Setup** (if not done):
   - Go to your Supabase project
   - Open SQL Editor
   - Paste and run the contents of `schema.sql`
   - This creates the tables needed for the app

---

**Questions?** Check `README.md` for more details about the project stack.
