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

  if (context === 'sign_in') {
    if (
      lower.includes('invalid login') ||
      lower.includes('invalid credentials') ||
      lower.includes('wrong password') ||
      (lower.includes('email') && lower.includes('password') && lower.includes('invalid'))
    ) {
      return 'Sign-in failed. Check your email and password, or ask an admin to reset your account in Supabase → Authentication.'
    }
  }

  return raw
}
