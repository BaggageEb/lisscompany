import type { IngredientKind, IngredientOption } from '../../lib/cakeStudio/types';
import { visualFor } from './ingredientVisual';
import './cake-studio.css';

/**
 * O copo em corte lateral: quatro slots de camada (massa → recheio → massa →
 * recheio) dentro de um copo transparente, com entradas animadas.
 *
 * É uma pré-visualização vectorial honesta (SVG ilustrativo, não fotorreal):
 * cada camada mostra o ingrediente escolhido com a sua cor/textura, e os
 * slots por preencher indicam o que falta. A animação de entrada é rápida e
 * interrompível; com `prefers-reduced-motion` as durações colapsam (tokens).
 */
export interface CakeGlassLayers {
  cakeBase: IngredientOption | null;
  firstFilling: IngredientOption | null;
  secondCake: boolean;
  secondFilling: IngredientOption | null;
  extras: IngredientOption[];
  moist: boolean;
}

interface CakeGlassProps extends CakeGlassLayers {
  className?: string;
}

const VIEW_W = 320;
const VIEW_H = 460;

/** Geometria interior do copo (clip). */
const CUP_CLIP = 'M68 64 L84 392 Q86 406 100 406 L220 406 Q234 406 236 392 L252 64 Z';
const SLOT_BOTTOM = 400;
const SLOT_H = 76;
const SLOT_LEFT = 72;
const SLOT_RIGHT = 248;

interface SlotProps {
  index: number;
  label: string;
  layer: IngredientOption | null;
  kind: IngredientKind;
  fallbackVisible?: boolean;
}

/** Uma camada do interior: preenchida ou marcador do que falta. */
function LayerSlot({ index, label, layer, kind, fallbackVisible = false }: SlotProps) {
  const y = SLOT_BOTTOM - (index + 1) * SLOT_H;
  const visual = visualFor(layer, kind);

  if (!layer && !fallbackVisible) {
    return (
      <g className="cg-slot">
        <rect
          x={SLOT_LEFT}
          y={y + 3}
          width={SLOT_RIGHT - SLOT_LEFT}
          height={SLOT_H - 6}
          rx={8}
          className="cg-slot__empty"
        />
        <text x={VIEW_W / 2} y={y + SLOT_H / 2 + 4} className="cg-slot__label" textAnchor="middle">
          {label}
        </text>
      </g>
    );
  }

  if (!layer) {
    // Camada de massa nº2: a variedade já está escolhida — mostra a mesma cor.
    return null;
  }

  const key = `${index}-${layer.id}`;
  return (
    <g key={key} className="cg-layer">
      <rect
        x={SLOT_LEFT}
        y={y + 3}
        width={SLOT_RIGHT - SLOT_LEFT}
        height={SLOT_H - 6}
        rx={8}
        fill={visual.fill}
      />
      <rect
        x={SLOT_LEFT}
        y={y + 3}
        width={SLOT_RIGHT - SLOT_LEFT}
        height={SLOT_H - 6}
        rx={8}
        fill="url(#cg-texture)"
        opacity={visual.texture === 'crumb' ? 0.5 : 0.18}
      />
      <rect
        x={SLOT_LEFT}
        y={y + 3}
        width={SLOT_RIGHT - SLOT_LEFT}
        height={14}
        rx={7}
        fill={visual.accent}
        opacity={0.55}
      />
      <text x={VIEW_W / 2} y={y + SLOT_H / 2 + 4} className="cg-layer__label" textAnchor="middle">
        {layer.name}
      </text>
    </g>
  );
}

export function CakeGlass({ cakeBase, firstFilling, secondCake, secondFilling, extras, moist, className }: CakeGlassProps) {
  // Slots visíveis: 0 massa (base), 1 recheio 1, 2 massa 2, 3 recheio 2.
  const secondCakeLayer = secondCake && cakeBase ? cakeBase : null;
  const topFilled = Boolean(secondFilling ?? secondCakeLayer ?? firstFilling ?? cakeBase);

  return (
    <figure className={['lc-glass', className].filter(Boolean).join(' ')}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={
          topFilled
            ? 'Pré-visualização do bolo no pote com as camadas escolhidas'
            : 'Pré-visualização do copo vazio à espera da primeira camada'
        }
        className="lc-glass__svg"
      >
        <defs>
          <clipPath id="cg-clip">
            <path d={CUP_CLIP} />
          </clipPath>
          <pattern id="cg-texture" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="3" r="1.6" fill="#000" opacity="0.16" />
            <circle cx="10" cy="8" r="1.2" fill="#fff" opacity="0.22" />
            <circle cx="6" cy="12" r="0.9" fill="#000" opacity="0.12" />
          </pattern>
          <linearGradient id="cg-glass-shine" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="40%" stopColor="#ffffff" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="cg-moist-sheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <ellipse id="cg-shadow" cx="160" cy="434" rx="96" ry="12" fill="rgb(18 61 141 / 16%)" />
        </defs>

        <use href="#cg-shadow" />

        {/* Interior + camadas (recortados ao copo) */}
        <g clipPath="url(#cg-clip)">
          <rect x="60" y="60" width="200" height="350" fill="#f7f1e8" opacity="0.65" />
          <LayerSlot index={0} label="1ª camada de massa" layer={cakeBase} kind="CAKE_BASE" />
          <LayerSlot index={1} label="1º recheio" layer={firstFilling} kind="FILLING" />
          <LayerSlot
            index={2}
            label="2ª camada de massa"
            layer={secondCakeLayer}
            kind="CAKE_BASE"
          />
          <LayerSlot index={3} label="2º recheio" layer={secondFilling} kind="FILLING" />

          {/* Brilho de «molhado» na camada de topo (só visual) */}
          {moist && topFilled && (
            <rect
              x={SLOT_LEFT}
              y={SLOT_BOTTOM - 4 * SLOT_H + 3}
              width={SLOT_RIGHT - SLOT_LEFT}
              height={SLOT_H}
              fill="url(#cg-moist-sheen)"
              className="cg-moist"
            />
          )}

          {/* Extras: decoração acima da última camada */}
          {extras.length > 0 && (
            <g className="cg-extras">
              {extras.slice(0, 3).map((extra, i) => {
                const visual = visualFor(extra, 'EXTRA');
                const cx = 118 + i * 42;
                const cy = SLOT_BOTTOM - 4 * SLOT_H - 6 + (i % 2) * 8;
                return (
                  <g key={extra.id}>
                    <circle cx={cx} cy={cy} r={9} fill={visual.fill} stroke={visual.accent} strokeWidth="1.5" />
                    <circle cx={cx - 3} cy={cy - 3} r={2.5} fill="#ffffff" opacity="0.6" />
                  </g>
                );
              })}
            </g>
          )}
        </g>

        {/* Vidro do copo */}
        <path
          d="M56 56 L74 392 Q77 414 100 414 L220 414 Q243 414 246 392 L264 56"
          fill="none"
          stroke="#123d8d"
          strokeOpacity="0.55"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <ellipse cx="160" cy="56" rx="104" ry="13" fill="#f7f1e8" stroke="#123d8d" strokeOpacity="0.55" strokeWidth="3" />
        <ellipse cx="160" cy="56" rx="92" ry="8" fill="#ffffff" opacity="0.7" />
        <path
          d="M78 84 L96 380"
          stroke="url(#cg-glass-shine)"
          strokeWidth="14"
          strokeLinecap="round"
          opacity="0.7"
        />
        <path d="M244 96 L232 350" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" opacity="0.45" />
        {/* Linha de topo do líquido/altura útil */}
        <line x1="76" y1="72" x2="244" y2="72" stroke="#d2c5b2" strokeWidth="1.5" strokeDasharray="4 6" />
      </svg>

      <figcaption className="lc-glass__caption">
        Pré-visualização ilustrativa das camadas — não é fotografia do produto final.
      </figcaption>
    </figure>
  );
}
