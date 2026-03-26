#!/usr/bin/env node
/**
 * Creates Supabase Auth users with a shared password (for initial rollout).
 * Run once against your project (local or hosted):
 *
 *   export VITE_SUPABASE_URL="https://xxx.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="eyJ..."   # Dashboard → Project Settings → API → service_role (secret)
 *   export SEED_PASSWORD="YourTemp1Pass"       # min 6 chars, upper, lower, digit
 *   node scripts/seed-auth-users.mjs
 *
 * Or: node --env-file=.env.local scripts/seed-auth-users.mjs
 *
 * If a user already exists, their password is updated to SEED_PASSWORD.
 * Disable Google OAuth in Dashboard → Authentication → Providers if you only want email/password.
 */

import { createClient } from '@supabase/supabase-js'

const EMAILS = [
  'axit@nerdshouse.com',
  'ea.royalenterprise1818@gmail.com',
  'fieldsaleswr04@gmail.com',
  'hello@axitmehta.com',
  'retailoperationheadwr@gmail.com',
  'whiterock.devx@gmail.com',
]

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = process.env.SEED_PASSWORD

function okPassword(p) {
  return (
    p &&
    p.length >= 6 &&
    /[a-z]/.test(p) &&
    /[A-Z]/.test(p) &&
    /[0-9]/.test(p)
  )
}

if (!url || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
if (!okPassword(password)) {
  console.error(
    'SEED_PASSWORD must be at least 6 characters and include lowercase, uppercase, and a digit.',
  )
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function findUserIdByEmail(email) {
  let page = 1
  const perPage = 200
  const target = email.trim().toLowerCase()
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const list = data?.users ?? []
    const u = list.find((x) => x.email?.toLowerCase() === target)
    if (u) return u.id
    if (list.length < perPage) return null
    page += 1
  }
}

async function main() {
  for (const email of EMAILS) {
    const existingId = await findUserIdByEmail(email)
    if (existingId) {
      const { error } = await supabase.auth.admin.updateUserById(existingId, {
        password,
        email_confirm: true,
      })
      if (error) {
        console.error(`[update] ${email}:`, error.message)
      } else {
        console.log(`[update] ${email}: password set`)
      }
    } else {
      const { error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (error) {
        console.error(`[create] ${email}:`, error.message)
      } else {
        console.log(`[create] ${email}: ok`)
      }
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
