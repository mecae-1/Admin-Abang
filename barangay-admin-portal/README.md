# Barangay Abang Admin Portal

Separate admin application, styled to match the supplied admin login and dashboard references.

- `pages/login/` and `pages/signup/` — Supabase admin sign-in and first-time account setup
- `pages/dashboard/` — dashboard and records sections
- `css/`, `js/`, `assets/` — admin-only resources
- `supabase/` — SQL migrations and Edge Function code

The only approved admin email is `mecaellacorcotchia15@gmail.com`. Run `../barangay-admin-login/supabase/admin-email-migration.sql` in the Supabase SQL Editor to update the database allowlist. The new email must also have an account in Supabase Auth and may need to confirm its email. The browser uses only the Supabase publishable key; row access is controlled by Supabase Auth and RLS.

Complaints, document requests, resident profiles, and announcements load from the same Supabase project configured in the public user portal. To enable saved admin-managed residents and household grouping, run `supabase/residents-households-migration.sql` in the Supabase SQL Editor after the main user schema. This adds the `households` and `residents` tables plus an admin-only save function. In the signed-in admin portal, Add a Resident saves to Supabase; the `?preview=1` preview stores its sample entries in this browser only.

To enable deletion from the Residents list, run `supabase/admin-delete-resident.sql` in the Supabase SQL Editor. It adds an admin-only function that deletes only an existing row in `public.residents`; user signup profiles and their submitted requests are not deletable from this view.

To send email notifications, use the Edge Function and setup instructions in the `supabase/` folder in this project. Set the Gmail OAuth values and `PUBLIC_SITE_URL` as Supabase Edge Function secrets, run `supabase/notification-log.sql` once in the Supabase SQL Editor, and deploy `supabase/functions/notify-users` with the Supabase CLI. Never put Gmail or Supabase secret keys in browser code.

Start the local portal with `node serve-local.cjs` and open `http://127.0.0.1:4173/` (the server now opens `index.html` for folders, so `/` works).

Keep this folder outside the public user's deployment root. Folder separation organizes development files but is not, by itself, a deployment security boundary.

## Code layout

```
index.html                → redirects to the login page
serve-local.cjs           → local preview server
css/admin.css             → all admin styles (formatted; semantic + new pieces at the bottom)
js/supabase-client.js     → shared Supabase connection (publishable key only)
js/admin-auth-shared.js   → password eye buttons + helpers for login/sign-up
js/admin-login.js         → Admin Login page
js/admin-signup.js        → Set Up Admin Account page
js/admin.js               → dashboard app, sectioned: state → helpers → data → navigation →
                            templates → layout → modals → actions → events → boot
pages/login|signup|dashboard/index.html
supabase/                 → SQL migrations (unchanged)
```

Every dashboard button has `data-action="..."`, handled in one table (`clickActions`) by a
single delegated listener. Sidebar items are real links (`#residents`, `#documents`, …), so
refreshing keeps your page and Back/Forward work.

## What changed

* Semantic HTML: `aside`/`nav`/`header`/`main`/`section`/`article`, lists for the sidebar,
  stats, activity and announcements, `<dl>` for record details, table captions and `scope`,
  one `h1` per page, labelled dialogs, skip link. Inline styles moved into CSS.
* Fixed buttons / features that did nothing:
  * Search box (had no code at all) now filters Residents, Households, Documents,
    Complaints and Announcements as you type.
  * Notification bell list had no styling and its items did nothing: now a styled dropdown;
    clicking a pending request opens Documents filtered to For Processing.
  * Generate Report only showed a message: now prints / saves as PDF (sidebar and buttons
    are hidden in print).
  * Export: added Complaints CSV and Residents CSV next to Documents CSV; CSV opens
    correctly in Excel (UTF-8).
  * Profile picture is now remembered after reload, with a Remove button.
  * Username in Settings now loads from your profile.
  * Menus close on outside click and Escape; popups close on Escape; the mobile sidebar
    closes when you tap outside it or pick a page.
  * In Preview mode, adding announcements and updating statuses now work (saved in the
    browser) instead of failing.
  * Login page shows a message when a non-admin account is sent back from the dashboard.
  * Message boxes in pop-ups are taller (they were stuck at one line).
  * Primary buttons stay blue in dark mode.
* Editing an announcement no longer emails every resident again and keeps its original
  publish date. New announcements still send the email.
* Removed unused code paths (an "add complaint" and "add household" form no button opened).

## Email notifications (Gmail + Supabase Edge Function)

The `supabase/functions/notify-users/index.ts` Edge Function sends Gmail notifications for complaint status changes, document request status changes, and newly published announcements. It verifies the caller with Supabase Auth and `public.is_admin()` before using the server-side key to read records and send mail.

Before deploying:

1. In Supabase Dashboard → Edge Functions → Secrets, set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER_EMAIL`, and `PUBLIC_SITE_URL` (the user portal URL ending at `index.html`, without a hash). Do not put these values in frontend files or GitHub.
2. Run `supabase/notification-log.sql` in the Supabase SQL Editor once. It creates a server-only delivery log table.
3. Install the Supabase CLI and sign in with `supabase login`.
4. From this `barangay-admin-portal` folder, deploy only the notification function:

   ```sh
   supabase functions deploy notify-users --project-ref dwdiubwbjpyqvfvxdbat
   ```

The function uses the project's injected Supabase URL and keys. It supports the current plural key-map environment variables as well as legacy Supabase key variables. JWT verification remains enabled and the function independently checks `public.is_admin()`.

After deployment, test with a real user-submitted complaint or document request and a newly published announcement. The function sends status updates to the submitting profile email and new announcements to registered profile emails (excluding the admin who published it). Check Edge Functions → `notify-users` → Logs and the `notification_log` table if a delivery fails. Google OAuth apps left in External / Testing mode can have Gmail refresh tokens expire after seven days; publish/configure the OAuth app appropriately before relying on it long-term.
