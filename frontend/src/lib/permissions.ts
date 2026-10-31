import type { AuthUser } from './api';

/** Códigos de permissão do painel (espelham o backend; a autoridade é SEMPRE o servidor). */
export type Permission =
  | 'DASHBOARD_VIEW'
  | 'ORDERS_VIEW'
  | 'ORDERS_MANAGE'
  | 'PAYMENTS_REVIEW'
  | 'PAYMENTS_REFUND'
  | 'CATALOG_MANAGE'
  | 'INVENTORY_MANAGE'
  | 'LOYALTY_MANAGE'
  | 'CUSTOMERS_VIEW'
  | 'SETTINGS_MANAGE'
  | 'STAFF_MANAGE'
  | 'AUDIT_VIEW';

/** A conta tem acesso ao painel? (proprietária ou conta com pelo menos uma permissão). */
export function hasAdminAccess(user: AuthUser | null | undefined): boolean {
  return Boolean(user && (user.owner || (user.permissions?.length ?? 0) > 0));
}

/** Só para mostrar/ocultar menus e botões; o servidor volta a validar cada pedido. */
export function can(user: AuthUser | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  if (user.owner) return true;
  return user.permissions?.includes(permission) ?? false;
}

export const PERMISSION_LABELS: Record<string, string> = {
  DASHBOARD_VIEW: 'Ver o resumo',
  ORDERS_VIEW: 'Consultar encomendas',
  ORDERS_MANAGE: 'Gerir encomendas',
  PAYMENTS_REVIEW: 'Validar pagamentos',
  PAYMENTS_REFUND: 'Registar reembolsos',
  CATALOG_MANAGE: 'Gerir catálogo',
  INVENTORY_MANAGE: 'Gerir stock',
  LOYALTY_MANAGE: 'Gerir fidelização',
  CUSTOMERS_VIEW: 'Ver clientes',
  SETTINGS_MANAGE: 'Gerir definições',
  STAFF_MANAGE: 'Gerir contas e papéis',
  AUDIT_VIEW: 'Ver auditoria',
};
