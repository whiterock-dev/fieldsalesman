import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser()
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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
      return new Response(JSON.stringify({ error: profileErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const inviterRole = profile?.role as string | undefined
    const allowed = inviterRole ? allowedTargetRoles(inviterRole) : null
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = (await req.json()) as { email?: string; role?: string; password?: string }
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()
    const role = String(body.role ?? '').trim()
    const password = String(body.password ?? '')

    if (!email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Invalid email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!allowed.includes(role)) {
      return new Response(JSON.stringify({ error: 'You cannot invite that role' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!validPassword(password)) {
      return new Response(
        JSON.stringify({
          error: 'Password must be at least 8 characters with uppercase, lowercase, and a number',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const existingId = await findUserIdByEmail(admin, email)
    let userId: string

    if (existingId) {
      const { error: updErr } = await admin.auth.admin.updateUserById(existingId, {
        password,
        email_confirm: true,
      })
      if (updErr) {
        return new Response(JSON.stringify({ error: updErr.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      userId = existingId
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (createErr || !created.user?.id) {
        return new Response(JSON.stringify({ error: createErr?.message ?? 'Could not create user' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      userId = created.user.id
    }

    const addedAt = new Date().toISOString()
    const { error: invErr } = await admin.from('app_invites').upsert(
      { email, role, added_at: addedAt },
      { onConflict: 'email' },
    )
    if (invErr) {
      return new Response(JSON.stringify({ error: `Invite row: ${invErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const displayName = email.split('@')[0] || 'User'
    const { error: profErr } = await admin.from('profiles').upsert(
      { id: userId, full_name: displayName, role },
      { onConflict: 'id' },
    )
    if (profErr) {
      return new Response(JSON.stringify({ error: `Profile: ${profErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true, email, role }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
