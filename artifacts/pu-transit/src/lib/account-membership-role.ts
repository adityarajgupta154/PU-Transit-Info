import type { MembershipInputRole } from '@workspace/api-client-react';

export const MEMBERSHIP_ROLES: readonly MembershipInputRole[] = [
  'student',
  'staff',
  'driver',
  'admin',
];

const STORAGE_PREFIX = 'pu-transit:membership-role:';

export function isMembershipInputRole(value: string): value is MembershipInputRole {
  return MEMBERSHIP_ROLES.includes(value as MembershipInputRole);
}

export function saveMembershipRole(uid: string, role: MembershipInputRole): boolean {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${uid}`, role);
    return true;
  } catch {
    return false;
  }
}

export function readMembershipRole(uid: string): MembershipInputRole | null {
  try {
    const role = localStorage.getItem(`${STORAGE_PREFIX}${uid}`);
    return role && isMembershipInputRole(role) ? role : null;
  } catch {
    return null;
  }
}

export function clearMembershipRole(uid: string): void {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${uid}`);
  } catch {
    // Private browsing can deny storage; the account flow still has its inline picker.
  }
}