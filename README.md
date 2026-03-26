# WhiteRock Field Sales App

> Developed and delivered by **Nerdshouse Technologies LLP**

---

## About

WhiteRock Field Sales App is a role-based field operations platform for sales owners, sub-admins, and field sales teams to manage customers, follow-ups, visit capture, meeting responses, map visibility, and live location tracking. The app uses Supabase for authentication, data, storage, and edge-function-powered invite flows, while keeping an offline-friendly browser mode for continuity during unstable connectivity.

## Tech Stack

| Layer        | Technology                                |
|--------------|-------------------------------------------|
| Frontend     | React 19, TypeScript, Vite               |
| Backend      | Supabase Edge Functions (Deno/TypeScript) |
| Database     | Supabase Postgres                         |
| Hosting      | Static frontend hosting + Supabase Cloud  |
| Other        | Leaflet/OpenStreetMap, Supabase Storage   |

## Getting Started

### Prerequisites

- Node.js 20+ and npm 10+
- Supabase project access (URL + anon key) and Supabase CLI (for function deploy/migrations)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd <project-folder>

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Fill in required values in .env
```

### Running Locally

```bash
npm run dev
```

### Building for Production

```bash
npm run build
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_SUPABASE_URL` | Supabase project URL used by the web app client | Yes |
| `VITE_SUPABASE_ANON_KEY` | Public/anon Supabase API key used by frontend auth/data requests | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for privileged server-only scripts/functions | No |
| `SEED_PASSWORD` | Temporary seed password for one-time user bootstrap workflows | No |

## Project Structure

```text
.
├── index.html                  # Vite HTML entry
├── src/
│   ├── App.tsx                 # Main app shell and feature views
│   ├── main.tsx                # React bootstrap
│   ├── index.css               # Global design system/styles
│   ├── components/             # Reusable UI components
│   └── lib/                    # Shared domain utilities
├── supabase/
│   ├── functions/              # Edge functions (invite flow)
│   ├── migrations/             # SQL schema changes
│   └── schema.sql              # Baseline schema snapshot
├── public/                     # Static public assets
└── package.json                # Scripts and dependencies
```

## Deployment

- Build frontend with `npm run build`.
- Deploy frontend `dist/` output to your static host.
- Deploy invite function with `npm run deploy:function:invite`.
- Apply database migrations in `supabase/migrations/` to target Supabase project.

## Third-Party Services

| Service | Purpose | Setup Required |
|---------|---------|----------------|
| Supabase Auth | User authentication and sessions | Yes |
| Supabase Postgres | Operational data storage | Yes |
| Supabase Storage | Visit photo storage | Yes |
| Supabase Edge Functions | Secure invite + password provisioning | Yes |
| OpenStreetMap / Leaflet | Map rendering and geospatial display | No |

---

## Developed By

**Nerdshouse Technologies LLP**
🌐 [nerdshouse.com](https://nerdshouse.com)  
📧 axit@nerdshouse.com

---

*© 2026 WhiteRock (Royal Enterprise). All rights reserved. Developed by Nerdshouse Technologies LLP.*
