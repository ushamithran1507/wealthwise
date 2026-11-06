# WealthWise Register

The income & expense register from the Claude Design handoff (`project/WealthWise Register.dc.html`), built as a Vite + React + TypeScript app on the Broadsheet design system.

- One table with **Particulars · Income · Expense · Balance**, a running balance on every row, and an opening balance carried over from earlier months.
- Investments go in the Expense column but are counted at the top as **Saved & invested**.
- Summary by category, a by-person table, CSV download, and JSON backup and restore (compatible with the prototype's backup files).
- Installs to the home screen and works offline.
- **Shared register (optional):** with Supabase configured, family members sign in with a user ID and password and see one shared register that updates live on every phone. Each phone keeps a copy, so it also works offline and catches up on reconnect.

Without Supabase settings the app runs in local-only mode, exactly like the prototype.

## Run locally

```bash
cd app
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
```

## Set up the shared register (Supabase)

1. Create a free project at supabase.com (the Mumbai region is closest).
2. **SQL Editor → New query:** paste `supabase/schema.sql` and click Run. Then add the family's emails, in lower case:
   ```sql
   insert into public.members (email) values ('usha@example.com'), ('venkat@example.com'), ('mithu@example.com')
     on conflict do nothing;
   ```
   Only emails on this list can read or write the register. Others can sign in but see a "not on the family list" message.
3. **Accounts:** people sign in with a user ID and password. Each user ID is stored in Supabase as `<id>@wealthwise.invalid` (no email is ever sent). Create an account in Supabase → Authentication → Users → Add user (email `<id>@wealthwise.invalid`, a password, "Auto confirm"), then add that email to `members`.
4. **Authentication → URL Configuration:** set the Site URL to your live address (for example, `https://wealthwise.vercel.app`) and add it to Redirect URLs.
5. **Project Settings → API:** copy the Project URL and the anon / publishable key into `.env.local` (see `.env.example`), or into Vercel as described below.

## Make it live (Vercel)

1. Push this repository to GitHub and import it at vercel.com → **Add New → Project**.
2. Set **Root Directory** to `app`. Vercel detects Vite on its own: the build command is `npm run build` and the output is `dist`.
3. Under **Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then deploy.
4. On each phone, open the link and install the app:
   - **Android (Chrome):** ⋮ → Add to Home screen
   - **iPhone (Safari):** Share → Add to Home Screen

## How sync works

- Every change is saved on the phone first, then sent to Supabase from a queue. If the phone is offline, the queue waits and sends when it reconnects (and retries every 30 seconds).
- Other phones get the change straight away through Supabase Realtime. They also reload everything when the app is reopened or comes back online.
- Deleted rows are only marked as deleted, so a deletion reaches every phone. If two phones edit the same row, the later edit wins. This uses each phone's clock.
- Each entry records who added it (`created_by_email`). Tap a row to see it.
- The first time someone signs in on a phone that already has local entries, the app asks whether to add those entries to the shared register.
- Signing out removes the register from that phone.

## Files

- `src/Register.tsx`: the register screen (a port of the design)
- `src/store.ts`: storage on the phone, the change queue and merging
- `src/sync.ts`: Supabase sign-in, membership check, pushing changes and live updates
- `src/App.tsx`: picks local mode, the sign-in screen or the shared register
- `supabase/schema.sql`: tables, row-level security and the realtime setup
- `public/`: manifest, service worker and icons
