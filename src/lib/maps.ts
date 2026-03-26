/** Opens Google Maps at a lat/lng (search pin). */
export function googleMapsSearchUrl(lat: number, lng: number): string {
  const q = encodeURIComponent(`${lat},${lng}`)
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}
