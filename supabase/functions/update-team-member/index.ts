/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function editableRolesFor(callerRole: string): string[] | null {
  if (callerRole === 'owner') return ['salesman', 'sub_admin', 'super_salesman']
  if (callerRole === 'sub_admin') return ['salesman', 'super_salesman']
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ ok: false, error: 'Server misconfigured' })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ ok: false, error: 'Missing authorization' })
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) {
      return json({ ok: false, error: userErr?.message ?? 'Unauthorized' })
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Resolve caller's role
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    let callerRole = callerProfile?.role as string | undefined
    if (!callerRole && user.email) {
      const { data: inv } = await admin
        .from('app_invites')
        .select('role')
        .eq('email', user.email.trim().toLowerCase())
        .maybeSingle()
      callerRole = inv?.role as string | undefined
    }

    const allowed = callerRole ? editableRolesFor(callerRole) : null
    if (!allowed) {
      return json({ ok: false, error: 'Forbidden: your role cannot edit team members.' })
    }

    const body = (await req.json()) as {
      profileId?: string
      fullName?: string
      phone?: string
      role?: string
      email?: string
    }
    const profileId = String(body.profileId ?? '').trim()
    const fullName = String(body.fullName ?? '').trim()
    const phone = String(body.phone ?? '').trim()
    const newRole = String(body.role ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()

    if (!profileId) return json({ ok: false, error: 'profileId is required' })

    // Verify target role is within caller's allowed range
    if (newRole && !allowed.includes(newRole)) {
      return json({ ok: false, error: `You cannot set role "${newRole}"` })
    }

    // Update auth.users user_metadata so the target's profile-sync effect reads fresh values
    if (fullName) {
      const { error: authErr } = await admin.auth.admin.updateUserById(profileId, {
        user_metadata: { full_name: fullName, phone: phone || null },
      })
      if (authErr) {
        return json({ ok: false, error: `Auth metadata update failed: ${authErr.message}` })
      }
    }

    // Update profiles table
    const profilePayload: Record<string, string | null> = {}
    if (fullName) profilePayload.full_name = fullName
    profilePayload.phone = phone || null
    if (newRole) profilePayload.role = newRole

    const { error: profErr } = await admin
      .from('profiles')
      .update(profilePayload)
      .eq('id', profileId)
    if (profErr) return json({ ok: false, error: `Profile update failed: ${profErr.message}` })

    // Update app_invites role
    if (newRole && email) {
      const { error: invErr } = await admin
        .from('app_invites')
        .update({ role: newRole })
        .eq('email', email)
      if (invErr) console.warn('invite role update:', invErr.message)
    }

    return json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return json({ ok: false, error: msg })
  }
})
