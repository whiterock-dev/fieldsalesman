/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/** App password rules for sign-up / password change (align with Supabase Dashboard minimum, often 8). */
const MIN_LEN = 8

export function isValidPassword(password: string): boolean {
  if (password.length < MIN_LEN) return false
  if (!/[a-z]/.test(password)) return false
  if (!/[A-Z]/.test(password)) return false
  if (!/[0-9]/.test(password)) return false
  return true
}

export const PASSWORD_POLICY_HINT =
  'At least 8 characters with uppercase, lowercase, and a number.'
