/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

export type Role = 'owner' | 'sub_admin' | 'super_salesman' | 'salesman'

export const ROLES: Role[] = ['owner', 'sub_admin', 'super_salesman', 'salesman']

/** Who the signed-in role may invite (email + role in Settings). */
export function addableRolesFor(inviter: Role): Role[] {
  if (inviter === 'owner') return ['owner', 'salesman', 'sub_admin', 'super_salesman']
  if (inviter === 'sub_admin') return ['salesman', 'super_salesman']
  if (inviter === 'super_salesman') return ['salesman']
  return []
}
