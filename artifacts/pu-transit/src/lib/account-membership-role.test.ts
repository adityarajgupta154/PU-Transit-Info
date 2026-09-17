import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMembershipRole,
  readMembershipRole,
  saveMembershipRole,
} from './account-membership-role';

describe('account membership role storage', () => {
  beforeEach(() => localStorage.clear());

  it('keeps role choices scoped to the Firebase account', () => {
    expect(saveMembershipRole('uid-a', 'driver')).toBe(true);
    expect(readMembershipRole('uid-a')).toBe('driver');
    expect(readMembershipRole('uid-b')).toBeNull();

    clearMembershipRole('uid-a');
    expect(readMembershipRole('uid-a')).toBeNull();
  });
});