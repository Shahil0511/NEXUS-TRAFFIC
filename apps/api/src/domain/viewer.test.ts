import { describe, expect, it } from 'vitest';

import { forAdmins } from './viewer';

const ADMIN = { email: 'boss@libas.in', isAdmin: true };
const VIEWER = { email: 'viewer@libas.in', isAdmin: false };

describe('forAdmins', () => {
  it('gives an admin the value', () => {
    expect(forAdmins(ADMIN, () => ['a@libas.in'])).toEqual(['a@libas.in']);
  });

  it('gives everyone else null (not an empty list) and never builds the value', () => {
    let built = false;
    const value = forAdmins(VIEWER, () => {
      built = true;
      return ['a@libas.in'];
    });
    expect(value).toBeNull();
    expect(built).toBe(false);
  });

  it('keeps an empty list for an admin (none, not hidden)', () => {
    expect(forAdmins(ADMIN, () => [])).toEqual([]);
  });
});
