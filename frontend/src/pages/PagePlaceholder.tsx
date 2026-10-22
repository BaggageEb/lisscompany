import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import './placeholder.css';

export interface PagePlaceholderProps {
  title: string;
  /** Fase do plano de implementação em que esta página será entregue. */
  phase?: number;
  /** Estado alternativo quando a página não depende de uma fase (ex.: dados por fornecer). */
  status?: string;
  description: string;
  /** Próximos passos concretos — torna o estado transparente, nunca fingimos funcionalidade. */
  details?: ReactNode;
  children?: ReactNode;
}

/**
 * Base honesta para páginas ainda não implementadas: identifica a fase, o que
 * falta e não apresenta controlos que pareçam funcionais sem o serem.
 */
export function PagePlaceholder({ title, phase, status, description, details, children }: PagePlaceholderProps) {
  const badge = status ?? (phase !== undefined ? `Fase ${phase} · em construção` : 'Em construção');
  return (
    <div className="lc-container lc-page placeholder">
      <div className="placeholder__head">
        <Badge tone="gold">{badge}</Badge>
        <h1>{title}</h1>
        <p className="placeholder__lead">{description}</p>
      </div>

      {details && <div className="placeholder__details">{details}</div>}

      {children}

      <p className="placeholder__back">
        <Link to="/">← Voltar à página inicial</Link>
      </p>
    </div>
  );
}
