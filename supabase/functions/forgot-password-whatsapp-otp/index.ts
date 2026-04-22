/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

type ForgotIntent = 'sendOtp' | 'verifyOtp' | 'resetPassword'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const API_URL = Deno.env.get('ZA11_API_URL') || 'https://app.11za.in/apis/template/sendTemplate'
const ORIGIN_WEBSITE = Deno.env.get('ZA11_ORIGIN_WEBSITE') || 'https://whiterock.co.in/'
const OTP_TEMPLATE = Deno.env.get('ZA11_OTP_TEMPLATE') || 'otp_verification'

function json(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function parseTenDigitMobile(raw: string): string | null {
  let d = raw.replace(/\D/g, '')
  while (d.startsWith('91') && d.length > 10) d = d.slice(2)
  if (d.length >= 11 && d.startsWith('0')) d = d.slice(1)
  d = d.slice(0, 10)
  return d.length === 10 ? d : null
}

function normalizeFor11za(mobile: string): string {
  return mobile.startsWith('91') ? mobile : `91${mobile}`
}

async function sendOtpVia11za(mobile: string, otp: string): Promise<void> {
  const authToken = Deno.env.get('ZA11_AUTH_TOKEN') || ''
  if (!authToken) throw new Error('ZA11_AUTH_TOKEN is not configured in Edge Function secrets.')

  const payload = {
    sendto: normalizeFor11za(mobile),
    authToken,
    originWebsite: ORIGIN_WEBSITE.replace(/[`"' ]/g, '').trim(),
    language: 'en',
    templateName: OTP_TEMPLATE,
    data: [otp],
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`11za error ${response.status}: ${text}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: 'Server misconfigured for forgot password.' })

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const body = (await req.json()) as {
      intent?: ForgotIntent
      mobile?: string
      otp?: string
      newPassword?: string
    }
    const intent = body.intent
    const parsedMobile = parseTenDigitMobile(String(body.mobile ?? ''))
    if (!intent || !parsedMobile) return json({ ok: false, error: 'Enter a valid mobile number.' })

    const phoneVariants = [parsedMobile, `91${parsedMobile}`, `+91${parsedMobile}`]
    const { data: profileRows, error: profileErr } = await admin
      .from('profiles')
      .select('id, phone')
      .in('phone', phoneVariants)
      .limit(1)

    if (profileErr) return json({ ok: false, error: `Profile lookup failed: ${profileErr.message}` })
    const profile = profileRows?.[0]
    if (!profile?.id) return json({ ok: false, error: 'No account found with this mobile number.' })

    if (intent === 'sendOtp') {
      const otp = String(Math.floor(100000 + Math.random() * 900000))
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
      await admin.from('password_reset_otps').delete().eq('user_id', profile.id)
      const { error: otpInsertErr } = await admin.from('password_reset_otps').insert({
        user_id: profile.id,
        mobile: parsedMobile,
        otp,
        expires_at: expiresAt,
      })
      if (otpInsertErr) return json({ ok: false, error: `OTP storage failed: ${otpInsertErr.message}` })
      await sendOtpVia11za(parsedMobile, otp)
      return json({ ok: true, message: 'OTP sent to your WhatsApp number.' })
    }

    if (intent === 'verifyOtp') {
      const submittedOtp = String(body.otp ?? '').trim()
      if (!/^\d{6}$/.test(submittedOtp)) return json({ ok: false, error: 'Enter a valid 6-digit OTP.' })
      const { data: row, error } = await admin
        .from('password_reset_otps')
        .select('id, otp, expires_at')
        .eq('user_id', profile.id)
        .eq('mobile', parsedMobile)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) return json({ ok: false, error: `OTP verification failed: ${error.message}` })
      if (!row) return json({ ok: false, error: 'OTP not found. Please request a new code.' })
      if (new Date(row.expires_at).getTime() < Date.now()) {
        await admin.from('password_reset_otps').delete().eq('id', row.id)
        return json({ ok: false, error: 'OTP expired. Please request a new code.' })
      }
      if (row.otp !== submittedOtp) return json({ ok: false, error: 'Invalid OTP.' })
      return json({ ok: true, message: 'OTP verified. Set your new password.' })
    }

    if (intent === 'resetPassword') {
      const submittedOtp = String(body.otp ?? '').trim()
      const newPassword = String(body.newPassword ?? '')
      if (newPassword.length < 6) return json({ ok: false, error: 'Password must be at least 6 characters.' })

      const { data: row, error } = await admin
        .from('password_reset_otps')
        .select('id, otp, expires_at')
        .eq('user_id', profile.id)
        .eq('mobile', parsedMobile)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) return json({ ok: false, error: `OTP validation failed: ${error.message}` })
      if (!row || row.otp !== submittedOtp) return json({ ok: false, error: 'Invalid OTP.' })
      if (new Date(row.expires_at).getTime() < Date.now()) {
        await admin.from('password_reset_otps').delete().eq('id', row.id)
        return json({ ok: false, error: 'OTP expired. Please request a new code.' })
      }

      const { error: updateErr } = await admin.auth.admin.updateUserById(profile.id, {
        password: newPassword,
      })
      if (updateErr) return json({ ok: false, error: `Password update failed: ${updateErr.message}` })

      await admin.from('password_reset_otps').delete().eq('id', row.id)
      return json({ ok: true, message: 'Password reset successful.' })
    }

    return json({ ok: false, error: 'Unknown forgot password action.' })
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})
