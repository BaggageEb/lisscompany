/**
 * Rótulos em português dos estados de encomenda e de pagamento (fases 4/5).
 *
 * Os estados vêm sempre do servidor — aqui só se traduzem para apresentação.
 * Cada rótulo combina com o tom do `Badge` e uma descrição curta para o
 * detalhe, para nunca depender só da cor (acessibilidade).
 */
import type { BadgeTone } from '../components/ui/Badge';

export interface StatusPresentation {
  label: string;
  tone: BadgeTone;
  /** Explicação ao cliente do que este estado significa. */
  description: string;
}

export const ORDER_STATUS: Record<string, StatusPresentation> = {
  RECEIVED: {
    label: 'Recebida',
    tone: 'blue',
    description: 'Registámos a sua encomenda. A loja vai confirmar os detalhes consigo.',
  },
  CONFIRMED: {
    label: 'Confirmada',
    tone: 'gold',
    description: 'Pagamento confirmado e encomenda aceite — já vamos preparar.',
  },
  PREPARING: {
    label: 'Em preparação',
    tone: 'gold',
    description: 'A sua encomenda está a ser preparada.',
  },
  READY: {
    label: 'Pronta',
    tone: 'warning',
    description: 'Pronta para levantamento ou sair para entrega — entramos em contacto.',
  },
  COMPLETED: {
    label: 'Concluída',
    tone: 'success',
    description: 'Encomenda entregue. Obrigado!',
  },
  CANCELLED: {
    label: 'Cancelada',
    tone: 'danger',
    description: 'A encomenda foi cancelada. Qualquer pagamento é tratado manualmente pela loja.',
  },
};

export const PAYMENT_STATUS: Record<string, StatusPresentation> = {
  PENDING: {
    label: 'Por confirmar',
    tone: 'warning',
    description: 'À espera da confirmação do pagamento pela loja.',
  },
  UNDER_REVIEW: {
    label: 'Em revisão',
    tone: 'blue',
    description: 'Recebemos o comprovativo e o pagamento está a ser verificado.',
  },
  PAID: {
    label: 'Pago',
    tone: 'success',
    description: 'Pagamento confirmado pela loja.',
  },
  FAILED: {
    label: 'Não confirmado',
    tone: 'danger',
    description: 'O pagamento não foi confirmado — a loja contacta consigo.',
  },
  PARTIALLY_REFUNDED: {
    label: 'Reembolso parcial',
    tone: 'warning',
    description: 'Parte do valor foi devolvida.',
  },
  REFUNDED: {
    label: 'Reembolsado',
    tone: 'neutral',
    description: 'O valor foi devolvido.',
  },
};

/** Apresentação de um estado de encomenda (fallback honesto se desconhecido). */
export function orderStatusOf(status: string): StatusPresentation {
  return (
    ORDER_STATUS[status] ?? {
      label: status,
      tone: 'neutral',
      description: 'Estado comunicado pela loja.',
    }
  );
}

/** Apresentação de um estado de pagamento (fallback honesto se desconhecido). */
export function paymentStatusOf(status: string | null): StatusPresentation | null {
  if (status == null) return null;
  return (
    PAYMENT_STATUS[status] ?? {
      label: status,
      tone: 'neutral',
      description: 'Estado comunicado pela loja.',
    }
  );
}

/** Data ISO → «20 out 2026, 14:30» (fuso do navegador, hora de Luanda no cliente). */
export function formatInstant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-PT', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
