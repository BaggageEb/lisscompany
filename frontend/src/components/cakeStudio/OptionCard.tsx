import type { IngredientOption } from '../../lib/cakeStudio/types';
import { formatKz } from '../../lib/money';
import { visualFor } from './ingredientVisual';
import './cake-studio.css';

interface OptionCardProps {
  option: IngredientOption;
  kind: 'CAKE_BASE' | 'FILLING' | 'EXTRA';
  /** Para extras: escolha múltipla (checkbox). Para massa/recheio: rádio. */
  mode: 'radio' | 'checkbox';
  name: string;
  checked: boolean;
  disabled?: boolean;
  /** Etiqueta extra, ex.: «já escolhido» no 2º recheio. */
  badge?: string;
  onSelect: (id: string) => void;
}

/**
 * Cartão seleccionável de um ingrediente. Usa controlos nativos
 * (radio/checkbox) escondidos com estilos próprios: teclado, leitor de ecrã
 * e «só com toque» continuam a funcionar sem JavaScript de acessibilidade.
 */
export function OptionCard({
  option,
  kind,
  mode,
  name,
  checked,
  disabled = false,
  badge,
  onSelect,
}: OptionCardProps) {
  const visual = visualFor(option, kind);
  const unavailable = !option.available;
  const delta = Number.parseFloat(option.priceDelta);

  return (
    <label
      className={[
        'lc-option',
        checked ? 'lc-option--selected' : '',
        unavailable || disabled ? 'lc-option--disabled' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <input
        type={mode === 'radio' ? 'radio' : 'checkbox'}
        name={name}
        value={option.id}
        checked={checked}
        disabled={unavailable || disabled}
        onChange={() => onSelect(option.id)}
        className="lc-visually-hidden"
      />

      <span
        className="lc-option__visual"
        style={{ background: `linear-gradient(145deg, ${visual.fill}, ${visual.accent})` }}
        aria-hidden="true"
      >
        <span className="lc-option__initial">{option.name.charAt(0)}</span>
        {option.imageUrl && <img src={option.imageUrl} alt="" loading="lazy" />}
      </span>

      <span className="lc-option__body">
        <span className="lc-option__head">
          <span className="lc-option__name">{option.name}</span>
          {badge && <span className="lc-option__badge">{badge}</span>}
          {!badge && !unavailable && (
            <span className="lc-option__price">
              {delta > 0 ? `+ ${formatKz(option.priceDelta)}` : 'incluso'}
            </span>
          )}
          {unavailable && <span className="lc-option__badge lc-option__badge--warn">Indisponível</span>}
        </span>
        <span className="lc-option__desc">{option.description}</span>
      </span>

      <span className="lc-option__check" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
    </label>
  );
}
