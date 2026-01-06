# Wordle League (Free App for iPhone + Android)

This is a tiny “installable website” (PWA). It works on iPhone and Android and looks/behaves like an app when added to your home screen.

## The ONLY thing you must do
1) Upload these files to GitHub Pages
2) Paste your Google Sheets CSV link into `config.js`

---

## A) Get your Google Sheets CSV link (2 minutes)
In Google Sheets:
1. Open your sheet
2. File → Share → Publish to web
3. Choose sheet: **Raw Data**
4. Format: **CSV**
5. Copy the link that looks like:
   https://docs.google.com/spreadsheets/d/e/XXXXX/pub?gid=0&single=true&output=csv

---

## B) Put the link into the app (10 seconds)
Open `config.js` and replace:
PASTE_YOUR_CSV_LINK_HERE

---

## C) Upload to GitHub Pages (5 minutes)
1. Create a GitHub repo called `wordle-league`
2. Upload ALL files from this folder into the repo
3. Repo Settings → Pages → Source: main branch / root
4. Your app will be at:
   https://YOURNAME.github.io/wordle-league/

---

## Install it like an app
iPhone:
- Open the link in Safari
- Share → Add to Home Screen

Android:
- Open in Chrome
- Add to Home Screen

---

## Troubleshooting
- If it says “Set your CSV link…” you haven’t edited `config.js`
- If it says “Error loading data…” your sheet is not published as CSV or the link is wrong
