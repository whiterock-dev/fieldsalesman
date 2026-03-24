import type { Role } from './roles'

export type InvitedUser = {
  email: string
  role: Role
  addedAt: string
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function findInviteForEmail(invitedUsers: InvitedUser[], email: string | undefined | null) {
  if (!email) return undefined
  const n = normalizeEmail(email)
  return invitedUsers.find((u) => normalizeEmail(u.email) === n)
}
