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

/** Always HTTP 200 + JSON so supabase.functions.invoke returns `data` (non-2xx becomes a generic client error). */
function json(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Permission matrix: which roles can the resetter reset? */
function resettableTargetRoles(resetterRole: string): string[] | null {
  if (resetterRole === 'owner') return ['salesman', 'super_salesman', 'sub_admin']
  if (resetterRole === 'sub_admin') return ['salesman', 'super_salesman']
  return null
}

function validPassword(p: string): boolean {
  return p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p)
}

async function findUserIdByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  const target = email.trim().toLowerCase()
  let page = 1
  const perPage = 200
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const list = data?.users ?? []
    const u = list.find((x: any) => x.email?.toLowerCase() === target)
    if (u) return u.id
    if (list.length < perPage) return null
    page += 1
  }
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
      return json({ ok: false, error: 'Server misconfigured (missing Supabase env in Edge Function)' })
    }

    // --- Authenticate the caller ---
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ ok: false, error: 'Missing authorization' })
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser()
    if (userErr || !user) {
      return json({ ok: false, error: userErr?.message ?? 'Unauthorized' })
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // --- Resolve caller's role ---
    const { data: callerProfile, error: profileErr } = await admin
      .from('profiles')
      .select('role, full_name')
      .eq('id', user.id)
      .maybeSingle()

    if (profileErr) {
      return json({ ok: false, error: `profiles: ${profileErr.message}` })
    }

    let callerRole = callerProfile?.role as string | undefined
    if (!callerRole && user.email) {
      const { data: inv } = await admin
        .from('app_invites')
        .select('role')
        .eq('email', user.email.trim().toLowerCase())
        .maybeSingle()
      callerRole = inv?.role as string | undefined
    }

    const allowedTargets = callerRole ? resettableTargetRoles(callerRole) : null
    if (!allowedTargets) {
      return json({
        ok: false,
        error: 'Forbidden: your role cannot reset passwords.',
      })
    }

    // --- Parse request body ---
    const body = (await req.json()) as {
      targetEmail?: string
      newPassword?: string
    }
    const targetEmail = String(body.targetEmail ?? '').trim().toLowerCase()
    const newPassword = String(body.newPassword ?? '')

    if (!targetEmail.includes('@')) {
      return json({ ok: false, error: 'Invalid target email' })
    }

    if (!newPassword) {
      return json({ ok: false, error: 'Password cannot be blank.' })
    }

    if (!validPassword(newPassword)) {
      return json({
        ok: false,
        error: 'Password must contain at least 8 characters with uppercase, lowercase, and a number.',
      })
    }

    // --- Resolve target user role ---
    // Check app_invites first for the role
    const { data: targetInvite } = await admin
      .from('app_invites')
      .select('role')
      .eq('email', targetEmail)
      .maybeSingle()

    const targetRole = targetInvite?.role as string | undefined
    if (!targetRole) {
      return json({ ok: false, error: 'Target user not found in invite list.' })
    }

    // --- Enforce permission matrix ---
    if (!allowedTargets.includes(targetRole)) {
      return json({
        ok: false,
        error: `You cannot reset passwords for users with role "${targetRole.replace(/_/g, ' ')}".`,
      })
    }

    // --- Find target user's auth id ---
    const targetAuthId = await findUserIdByEmail(admin, targetEmail)
    if (!targetAuthId) {
      return json({ ok: false, error: 'Target user has no auth account. They may not have signed in yet.' })
    }

    // --- Update password ---
    const { error: updateErr } = await admin.auth.admin.updateUserById(targetAuthId, {
      password: newPassword,
    })
    if (updateErr) {
      return json({ ok: false, error: `Unable to update password. Please try again. (${updateErr.message})` })
    }

    // --- Insert audit log ---
    const callerName = callerProfile?.full_name ?? user.email ?? 'Unknown'
    const { error: logErr } = await admin.from('password_reset_log').insert({
      target_user_id: targetAuthId,
      target_email: targetEmail,
      changed_by_id: user.id,
      changed_by_name: callerName,
      action: 'Password Reset',
    })
    if (logErr) {
      console.warn('password_reset_log insert failed:', logErr.message)
      // Non-blocking: the password was already changed successfully
    }

    return json({ ok: true, message: 'Password has been changed successfully.' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return json({ ok: false, error: msg })
  }
})
