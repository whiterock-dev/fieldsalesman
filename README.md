# Field Salesman Web App

This is a standalone web app inside `fieldsalesman` (separate from `b2bsales` and other folders).

## Implemented MVP

- Role-aware UI for `owner`, `sub_admin`, `super_salesman`, and `salesman`
- Admin options:
  - Salesmen wise overdue follow-ups
  - Meeting responses
  - Map view links for customers + live points count
  - KPI table with date + salesman filters
- Salesman options:
  - Pending follow-ups
  - Record meeting / visit capture form
  - Live location tracking
- Left sidebar navigation (one screen per section)
- Map view: OpenStreetMap + Leaflet with dealer pins, live pings, and recent visit markers
  - Customer list view with map links
- Visit capture (G-Form replacement behavior):
  - **Mark visit location**: `getCurrentPosition` (high accuracy) + safety timeout so the UI never hangs forever
  - Existing customer must be within `30m` radius (geo-fence); GPS uncertainty must be ≤ `30m`
  - **New lead** (quick create): GPS uncertainty allowed up to **`80m`** (no prior pin)
  - Auto timestamp
  - **Camera-only** visit photo via `getUserMedia` (no gallery / file picker)
  - On **Take photo**, timestamp + GPS (lat/lng, accuracy) + visit fix time are **burned into the JPEG**
  - Existing customer selection or quick lead creation
  - Visit type, notes, next action, follow-up date
  - Offline queue support with later sync preserving captured time
- CRM + follow-up data model:
  - Customer/lead data with contact, location, and tags
  - Follow-up tasks with due date, priority, status, remarks

## Sign-in & invites

- **No email/password form** — sign-in is **Google only** (Supabase Auth).
- Admins add users under **Settings → Add user (invite)**: enter **email** + **role**. The person must sign in with **Google using that same email**.
- Invited emails are stored locally (`fs_invited_users`). If the list is **empty** on first Google sign-in, that account is bootstrapped as **owner**.
- **Continue offline (demo)** skips Google and uses browser-stored demo data (no Supabase session).

## Supabase Integration

The app now includes Supabase client integration. If env values are present, it reads/writes:

- `profiles`
- `customers`
- `followups`
- `visits` (via RPC `create_visit_enforced`)
- `live_locations`
- Storage bucket `visit-photos`

When env values are missing, the app still runs in local demo mode using browser storage.

### Setup

1. Copy `.env.example` to `.env.local`
2. Add your project values:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

3. Run SQL from `supabase/schema.sql` in Supabase SQL editor (or `supabase/migrations/20260319120000_create_visit_enforced_max_gps.sql` if you already deployed an older `create_visit_enforced`)
4. Create storage bucket named `visit-photos`
5. In **Authentication → Providers**, enable **Google** and add your OAuth client ID/secret.
6. Add **Redirect URL** in Supabase Auth settings: your app origin (e.g. `http://localhost:5173` for dev).
7. Add RLS policies for your auth model (owner/sub admin/super salesman/salesman). The app upserts the signed-in user into `profiles` on login (invite role).

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
