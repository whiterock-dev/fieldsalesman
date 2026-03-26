/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/** Opens Google Maps at a lat/lng (search pin). */
export function googleMapsSearchUrl(lat: number, lng: number): string {
  const q = encodeURIComponent(`${lat},${lng}`)
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}
