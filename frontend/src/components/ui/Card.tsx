import type { HTMLAttributes, ReactNode } from 'react';
import './card.css';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Elevação: "flat" para grelhas, "raised" para destaque, "interactive" para elementos clicáveis. */
  elevation?: 'flat' | 'raised' | 'interactive';
  padding?: 'none' | 'md' | 'lg';
  as?: 'div' | 'article' | 'section' | 'li';
  children: ReactNode;
}

export function Card({
  elevation = 'flat',
  padding = 'md',
  as: Tag = 'div',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={['lc-card', `lc-card--${elevation}`, `lc-card--pad-${padding}`, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </Tag>
  );
}
