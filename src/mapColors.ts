/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/** Distinct hues for map pins / live / visit markers (stable order by sorted salesman id). */
export const SALESMAN_PIN_PALETTE = [
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#9333ea',
  '#dc2626',
  '#0891b2',
  '#ca8a04',
  '#4f46e5',
  '#db2777',
  '#059669',
  '#ea580c',
  '#7c3aed',
]

export const UNASSIGNED_PIN_COLOR = '#64748b'

/** Stable color per salesman id (alphabetically sorted ids → palette index). */
export function salesmanColorMap(salesmen: { id: string }[]): Map<string, string> {
  const ids = [...new Set(salesmen.map((s) => s.id))].sort()
  const m = new Map<string, string>()
  ids.forEach((id, i) => m.set(id, SALESMAN_PIN_PALETTE[i % SALESMAN_PIN_PALETTE.length]))
  return m
}

export function colorForSalesmanId(map: Map<string, string>, salesmanId: string | undefined): string {
  if (!salesmanId) return UNASSIGNED_PIN_COLOR
  return map.get(salesmanId) ?? UNASSIGNED_PIN_COLOR
}

export const CUSTOMER_TYPE_COLORS = {
  pending: '#EAB308',
  new: '#3B82F6',
  existing: '#22C55E',
  inactive: '#EF4444',
  unknown: '#94A3B8',
}

export const CUSTOMER_TYPE_LEGEND: { label: string; color: string }[] = [
  { label: 'Pending Onboarding', color: CUSTOMER_TYPE_COLORS.pending },
  { label: 'New Customer', color: CUSTOMER_TYPE_COLORS.new },
  { label: 'Existing Customer', color: CUSTOMER_TYPE_COLORS.existing },
  { label: 'Inactive Customer', color: CUSTOMER_TYPE_COLORS.inactive },
  { label: 'Unknown', color: CUSTOMER_TYPE_COLORS.unknown },
]

export function colorByCustomerType(type: string | undefined): string {
  const t = (type ?? '').toLowerCase().trim()
  if (!t) return CUSTOMER_TYPE_COLORS.unknown
  if (t === 'new') return CUSTOMER_TYPE_COLORS.new
  if (t.includes('pending')) return CUSTOMER_TYPE_COLORS.pending
  if (t.includes('existing')) return CUSTOMER_TYPE_COLORS.existing
  if (t.includes('inactive')) return CUSTOMER_TYPE_COLORS.inactive
  return CUSTOMER_TYPE_COLORS.unknown
}
