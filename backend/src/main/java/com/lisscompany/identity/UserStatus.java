package com.lisscompany.identity;

/**
 * Estado da conta. Espelha o CHECK da tabela {@code app_user} (V1):
 * {@code ACTIVE} pode entrar; {@code DISABLED} foi suspensa por administração;
 * {@code PENDING} aguarda qualquer formalização (não autentica).
 */
public enum UserStatus {
    ACTIVE,
    DISABLED,
    PENDING
}
