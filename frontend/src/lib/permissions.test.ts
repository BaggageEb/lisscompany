import { describe, expect, it } from 'vitest';
import { can, hasAdminAccess } from './permissions';

const base = { id: 'u', email: 'a@b.pt', displayName: 'A' };

describe('permissions', () => {
  it('a proprietária tem todas as permissões', () => {
    expect(can({ ...base, owner: true }, 'STAFF_MANAGE')).toBe(true);
    expect(hasAdminAccess({ ...base, owner: true })).toBe(true);
  });

  it('uma conta secundária só tem o que o servidor lhe concedeu', () => {
    const staff = { ...base, owner: false, permissions: ['ORDERS_VIEW'] };
    expect(can(staff, 'ORDERS_VIEW')).toBe(true);
    expect(can(staff, 'SETTINGS_MANAGE')).toBe(false);
    expect(hasAdminAccess(staff)).toBe(true);
  });

  it('um cliente comum não tem acesso ao painel', () => {
    expect(hasAdminAccess({ ...base })).toBe(false);
    expect(hasAdminAccess(null)).toBe(false);
    expect(can(null, 'ORDERS_VIEW')).toBe(false);
  });
});
