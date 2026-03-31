/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Normalize to a 10-digit mobile. Accepts optional country code 91 or a single leading 0.
 * Returns null if the value cannot be interpreted as exactly 10 digits.
 */
export function parseTenDigitMobile(raw: string): string | null {
  const clamped = clampTenDigitMobileInput(raw)
  if (clamped.length !== 10) return null
  return clamped
}

/**
 * Strips non-digits, normalizes optional +91 / leading 0, then keeps at most 10 digits.
 * Use in controlled inputs so users cannot type or paste more than one mobile number.
 */
export function clampTenDigitMobileInput(raw: string): string {
  let d = raw.replace(/\D/g, '')
  while (d.startsWith('91') && d.length > 10) {
    d = d.slice(2)
  }
  if (d.length >= 11 && d.startsWith('0')) {
    d = d.slice(1)
  }
  return d.slice(0, 10)
}
