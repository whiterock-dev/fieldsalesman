/** Map Supabase Auth errors to clearer copy for the login screen. */
export function friendlyAuthMessage(raw: string, context: 'sign_in' | 'sign_up'): string {
  const lower = raw.toLowerCase()

  if (context === 'sign_up') {
    if (
      lower.includes('already') &&
      (lower.includes('registered') || lower.includes('exists') || lower.includes('signed up'))
    ) {
      return 'This email is already registered. Use Sign in with the same email and password—not Create account.'
    }
    if (lower.includes('database error') && lower.includes('unique')) {
      return 'This email is already registered. Sign in instead.'
    }
    if (lower.includes('duplicate') || lower.includes('user already')) {
      return 'This email is already registered. Switch to Sign in—not Create account.'
    }
  }

  return raw
}

/** Sign-in: show Supabase’s real message (do not replace “Invalid credentials” with a generic line). Add hints only for specific cases. */
export function formatSignInError(error: { message: string; code?: string }): string {
  const msg = error.message?.trim() || 'Sign-in failed.'
  const lower = msg.toLowerCase()
  const code = (error.code ?? '').toLowerCase()

  if (code === 'email_not_confirmed' || lower.includes('email not confirmed')) {
    return `${msg} — Confirm the address in Supabase (Authentication → Users) or adjust “Confirm email” under Auth settings.`
  }

  return msg
}
