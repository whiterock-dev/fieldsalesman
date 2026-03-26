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

function allowedTargetRoles(inviterRole: string): string[] | null {
  if (inviterRole === 'owner') return ['owner', 'salesman', 'sub_admin', 'super_salesman']
  if (inviterRole === 'sub_admin') return ['salesman', 'super_salesman']
  if (inviterRole === 'super_salesman') return ['salesman']
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
    const u = list.find((x) => x.email?.toLowerCase() === target)
    if (u) return u.id
    if (list.length < perPage) return null
    page += 1
  }
}

Deno.serve(async (req) => {
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

    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    if (profileErr) {
      return json({ ok: false, error: `profiles: ${profileErr.message}` })
    }

    let inviterRole = profile?.role as string | undefined
    if (!inviterRole && user.email) {
      const { data: inv } = await admin
        .from('app_invites')
        .select('role')
        .eq('email', user.email.trim().toLowerCase())
        .maybeSingle()
      inviterRole = inv?.role as string | undefined
    }

    const allowed = inviterRole ? allowedTargetRoles(inviterRole) : null
    if (!allowed) {
      return json({
        ok: false,
        error:
          'Forbidden: your role cannot invite users, or your profile is missing. Ensure a row exists in public.profiles for your user id, or that your email is listed in app_invites with an owner/sub_admin/super_salesman role.',
      })
    }

    const body = (await req.json()) as {
      fullName?: string
      email?: string
      phone?: string
      role?: string
      password?: string
    }
    const fullName = String(body.fullName ?? '').trim()
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()
    const phone = String(body.phone ?? '').trim()
    const role = String(body.role ?? '').trim()
    const password = String(body.password ?? '')

    if (!fullName) {
      return json({ ok: false, error: 'Full name is required' })
    }

    if (!email.includes('@')) {
      return json({ ok: false, error: 'Invalid email' })
    }

    if (!allowed.includes(role)) {
      return json({ ok: false, error: 'You cannot invite that role' })
    }

    if (!validPassword(password)) {
      return json({
        ok: false,
        error: 'Password must be at least 8 characters with uppercase, lowercase, and a number',
      })
    }
    if (phone && !/^[0-9+\-\s]{7,20}$/.test(phone)) {
      return json({ ok: false, error: 'Invalid phone number format' })
    }

    const existingId = await findUserIdByEmail(admin, email)
    let userId: string

    if (existingId) {
      const { error: updErr } = await admin.auth.admin.updateUserById(existingId, {
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          phone: phone || null,
        },
      })
      if (updErr) {
        return json({ ok: false, error: updErr.message })
      }
      userId = existingId
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          phone: phone || null,
        },
      })
      if (createErr || !created.user?.id) {
        return json({ ok: false, error: createErr?.message ?? 'Could not create user' })
      }
      userId = created.user.id
    }

    const addedAt = new Date().toISOString()
    const { error: invErr } = await admin.from('app_invites').upsert(
      { email, role, added_at: addedAt },
      { onConflict: 'email' },
    )
    if (invErr) {
      return json({ ok: false, error: `Invite row: ${invErr.message}` })
    }

    const { error: profErr } = await admin.from('profiles').upsert(
      { id: userId, full_name: fullName, role, email, phone: phone || null },
      { onConflict: 'id' },
    )
    if (profErr) {
      return json({ ok: false, error: `Profile: ${profErr.message}` })
    }

    return json({ ok: true, email, role })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return json({ ok: false, error: msg })
  }
})
