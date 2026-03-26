/** App password rules for email/password auth (client-side check before Supabase). */
const MIN_LEN = 6

export function isValidPassword(password: string): boolean {
  if (password.length < MIN_LEN) return false
  if (!/[a-z]/.test(password)) return false
  if (!/[A-Z]/.test(password)) return false
  if (!/[0-9]/.test(password)) return false
  return true
}

export const PASSWORD_POLICY_HINT =
  'At least 6 characters with uppercase, lowercase, and a number.'
