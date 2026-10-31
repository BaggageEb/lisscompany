package com.lisscompany.shared.security;

import java.util.List;

/** Códigos de permissão do painel (iguais aos da tabela {@code permission}, V7). */
public final class Permissions {

    public static final String DASHBOARD_VIEW = "DASHBOARD_VIEW";
    public static final String ORDERS_VIEW = "ORDERS_VIEW";
    public static final String ORDERS_MANAGE = "ORDERS_MANAGE";
    public static final String PAYMENTS_REVIEW = "PAYMENTS_REVIEW";
    public static final String PAYMENTS_REFUND = "PAYMENTS_REFUND";
    public static final String CATALOG_MANAGE = "CATALOG_MANAGE";
    public static final String INVENTORY_MANAGE = "INVENTORY_MANAGE";
    public static final String LOYALTY_MANAGE = "LOYALTY_MANAGE";
    public static final String CUSTOMERS_VIEW = "CUSTOMERS_VIEW";
    public static final String SETTINGS_MANAGE = "SETTINGS_MANAGE";
    public static final String STAFF_MANAGE = "STAFF_MANAGE";
    public static final String AUDIT_VIEW = "AUDIT_VIEW";

    public static final List<String> ALL = List.of(
            DASHBOARD_VIEW, ORDERS_VIEW, ORDERS_MANAGE, PAYMENTS_REVIEW, PAYMENTS_REFUND, CATALOG_MANAGE,
            INVENTORY_MANAGE, LOYALTY_MANAGE, CUSTOMERS_VIEW, SETTINGS_MANAGE, STAFF_MANAGE, AUDIT_VIEW);

    private Permissions() {}
}
