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
  let d = raw.replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  if (d.length === 10) return d
  return null
}
