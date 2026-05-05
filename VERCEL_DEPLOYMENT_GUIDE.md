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

Click **"Environment Variables"** and add these three variables:

```
VITE_SUPABASE_URL = https://vkegcelyorjevpwoeigf.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY = sb_publishable_WRK0sMLc1huujljLPrS4Pg_UZ0Y2muk
VITE_ANTHROPIC_API_KEY = YOUR_REAL_ANTHROPIC_API_KEY_HERE
```

⚠️ **Important:**
- Replace `YOUR_REAL_ANTHROPIC_API_KEY_HERE` with your actual Claude API key from [console.anthropic.com](https://console.anthropic.com)
- If you don't have an Anthropic API key yet:
  1. Visit https://console.anthropic.com
  2. Sign up or log in
  3. Create an API key
  4. Come back and paste it here

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
**Fix:** Go to **"Settings"** → **"Environment Variables"** in Vercel and ensure all three `VITE_*` variables are set.

### Issue: "Styling looks broken"
**Fix:** This is usually a browser cache issue. Press `Ctrl+Shift+R` (hard refresh) or clear browser cache.

### Issue: "Can't connect to Supabase"
**Fix:** 
1. Verify your Supabase URL in the environment variables
2. Ensure your Supabase project is active (check [supabase.com/dashboard](https://supabase.com/dashboard))
3. Run the SQL from `schema.sql` in your Supabase project once if not already done

### Issue: "AI date ideas not working"
**Fix:** 
1. Verify `VITE_ANTHROPIC_API_KEY` is set in Vercel
2. Ensure your Anthropic account has credits/quota
3. Check the browser console (F12) for error messages

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
