# GopalSites — Setup Guide

The site works right now in "demo mode" with sample data built in — open
`index.html` and click around before doing any setup. Once you're ready to
go live, follow the steps below.

---

## Part 1 — Import the Sheet templates

You've got 7 CSV files in the `sheet-templates` folder, one per tab. In a new
Google Sheet:

1. Create the spreadsheet, name it **"GopalSites Data"**.
2. For the first tab: **File > Import > Upload**, choose `1-Website-Designs.csv`,
   import as **"Replace current sheet"**, then rename the tab to `Website Designs`.
3. For each remaining file, add a new tab (bottom-left `+`), then
   **File > Import > Upload**, choose the file, and import as **"Insert new sheet"**.
   Rename each tab to match the file (drop the number prefix):
   - `2-Categories.csv` → tab **Categories**
   - `3-Facilities.csv` → tab **Facilities**
   - `4-Pricing.csv` → tab **Pricing**
   - `5-Leads.csv` → tab **Leads**
   - `6-Payments.csv` → tab **Payments**
   - `7-Settings.csv` → tab **Settings**
4. Delete the sample rows in `Website Designs`, `Categories`, `Facilities`, and
   `Pricing` once you've added your own — or just edit them in place.
5. Copy your **Spreadsheet ID** from the URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

### What each tab controls
| Tab | Controls |
|---|---|
| **Website Designs** | Every design shown in the gallery. Add a row = new design appears. `Status = Inactive` hides it. |
| **Categories** | The "What kind of business are you?" grid — add or remove a row to add/remove a category (e.g. Doctor, Lawyer). |
| **Facilities** | The "Why businesses choose us" section — add/remove what you offer. |
| **Pricing** | The three (or more) pricing packages, their rates and feature lists. Edit `Price Note` and `Features (pipe separated)` any time. |
| **Settings** | Global site settings — business name, payment gateway, API keys, starting fee amount, contact details. See Part 3. |
| **Leads** | Every enquiry submitted through the form — your CRM. |
| **Payments** | Every payment attempt and its status (Created / Paid / Pending / Failed). |

---

## Part 2 — Deploy the Apps Script backend

1. In your Sheet, go to **Extensions > Apps Script**.
2. Delete any starter code and paste in the contents of **`apps-script.gs`**.
3. Near the top, set:
   ```js
   const SPREADSHEET_ID = "YOUR_GOOGLE_SHEET_ID_HERE"; // from Part 1, step 5
   ```
4. Click **Deploy > New deployment** → Type: **Web app** → Execute as: **Me** → Who has access: **Anyone**.
5. Click **Deploy**, authorize the permissions, and copy the **Web app URL**
   (looks like `https://script.google.com/macros/s/AKfycb.../exec`).
6. Open `index.html`, find `CONFIG.APPS_SCRIPT_URL` near the top of the
   `<script>` section, and paste your Web app URL in.

Once this is connected, categories, facilities, pricing, and designs on the
live site all come from your Sheet — editing a row updates the site with no
redeploy needed.

---

## Part 3 — Fill in the Settings tab

| Key | What to put |
|---|---|
| Business Name | `GopalSites` (or whatever you rename it to — it updates the site automatically) |
| Payment Gateway | `Razorpay` or `Instamojo` — whichever you're using right now |
| Razorpay Key ID / Key Secret | From your Razorpay dashboard (Settings > API Keys) |
| Instamojo API Key / Auth Token | From your Instamojo dashboard (Settings > API & Plugins) |
| Instamojo Mode | `test` while testing, `live` when ready for real payments |
| Starting Fee Amount | `500` — the amount charged to start a project. Change this any time. |
| WhatsApp Number | Your number with country code, no `+` or spaces (e.g. `919876543210`) |
| Contact Email | Your support email |
| Site Redirect URL | Your live site URL once deployed (Part 5) — the payment gateway sends customers back here after checkout |

**Switching gateways**: change the `Payment Gateway` value between `Razorpay`
and `Instamojo` — nothing else needs to change.

**Getting Razorpay keys**: sign up at [razorpay.com](https://razorpay.com),
go to Settings → API Keys → Generate Key. Use **Test Mode** keys first.

**Getting Instamojo keys**: sign up at [instamojo.com](https://www.instamojo.com),
go to Settings → API & Plugins to find your API Key and Auth Token.

### Webhooks (recommended, optional)
As a backup to the automatic redirect-based check, you can point your
gateway's webhook at the same Apps Script Web app URL:
- **Razorpay**: Dashboard → Settings → Webhooks → add your Apps Script URL, subscribe to `payment_link.paid`.
- **Instamojo**: Dashboard → Settings → Webhooks → add your Apps Script URL.

---

## Part 4 — How payments work on the site

**Starting a project**: after a customer submits the enquiry form, they see
a "Pay ₹[Starting Fee] & start my project" screen. Tapping it creates a
payment link through whichever gateway is set in the Settings tab, and sends
them to a secure checkout page. When they return, the site checks the
payment status and shows a confirmation. You also get a Telegram alert the
moment it's marked paid.

**Receiving any amount**: the "Make a payment" section (linked in the nav)
lets anyone pay a custom amount — useful for milestone payments, add-ons, or
anything not tied to a specific enquiry. Every payment, of either kind, is
logged in the `Payments` tab with its status.

---

## Part 5 — Deploy to Cloudflare Pages

1. Push the project (`index.html` at minimum) to a **GitHub repository**.
2. Go to [Cloudflare Pages](https://pages.cloudflare.com) → **Create a project > Connect to Git** → select your repo.
3. Leave the build command empty, set the output directory to `/`.
4. Click **Save and Deploy**. You'll get a `*.pages.dev` URL immediately — attach your own domain afterward under **Custom domains**.
5. Update `Site Redirect URL` in your Settings tab to this live URL, so payment redirects come back to the right place.

---

## Day-to-day use

- **Add/remove a business category**: add or delete a row in `Categories`.
- **Add/remove what you offer**: add or delete a row in `Facilities`.
- **Change your rates**: edit `Price` / `Price Note` / `Features` in `Pricing`.
- **Add a demo design**: add a row to `Website Designs`, set `Status = Active`.
- **Change the starting fee**: edit `Starting Fee Amount` in `Settings`.
- **Rename the business**: edit `Business Name` in `Settings` — updates the logo, title, and footer automatically.
- **Check leads**: `Leads` tab, or wait for the Telegram alert.
- **Check payments**: `Payments` tab, or wait for the Telegram alert.

## What's built to expand later (architecture supports it, not wired up yet)
- Telegram alerts for design selection, form errors, follow-up reminders
- Customer login, invoicing, booking system, maintenance subscriptions
