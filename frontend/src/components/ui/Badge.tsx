import type { ReactNode } from 'react';
import './badge.css';

export type BadgeTone = 'neutral' | 'blue' | 'gold' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  tone?: BadgeTone;
  /**
   * Opcionalmente acrescenta um ícone textual (ex.: "●") para não depender
   * apenas da cor na comunicação do estado.
   */
  children: ReactNode;
}

const TONE_MARK: Record<BadgeTone, string | null> = {
  neutral: null,
  blue: '●',
  gold: '★',
  success: '✓',
  warning: '!',
  danger: '✕',
};

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  const mark = TONE_MARK[tone];
  return (
    <span className={`lc-badge lc-badge--${tone}`}>
      {mark && (
        <span aria-hidden="true" className="lc-badge__mark">
          {mark}
        </span>
      )}
      {children}
    </span>
  );
}
