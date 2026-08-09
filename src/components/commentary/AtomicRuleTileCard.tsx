// AtomicRuleTile — single visual card showing one fired chess rule.
//
// Hovering or clicking the tile triggers `setTileHover()` in the game store,
// which paints the tile's highlightSquares + arrowVectors on the board.

'use client';

import { useGameStore } from '@/store/useGameStore';
import { RULE_CATEGORY_META, TIER_META, type AtomicRuleTile } from '@/types/chess';
import { cn } from '@/lib/utils';

interface Props {
  tile: AtomicRuleTile;
}

export function AtomicRuleTileCard({ tile }: Props) {
  const setTileHover = useGameStore((s) => s.setTileHover);
  const clearTileHover = useGameStore((s) => s.clearTileHover);
  const hoveredTileId = useGameStore((s) => s.hoveredTileId);

  const catMeta = RULE_CATEGORY_META[tile.category];
  const tierMeta = TIER_META[tile.importanceTier];
  const isPositive = tile.weightedPointsCp > 0;
  const isNegative = tile.weightedPointsCp < 0;
  const isHovered = hoveredTileId === tile.ruleId + tile.ruleName;

  const pointsColor = isPositive ? '#22C55E' : isNegative ? '#EF4444' : '#94A3B8';
  const pointsBg = isPositive ? 'rgba(34,197,94,0.15)' : isNegative ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.15)';

  return (
    <div
      className={cn(
        'relative rounded-lg border p-3 cursor-pointer transition-all duration-150',
        'hover:scale-[1.02] hover:shadow-lg',
        isHovered ? 'ring-2 ring-amber-400 shadow-lg' : '',
      )}
      style={{
        background: catMeta.bg,
        borderColor: catMeta.color + '60',
        boxShadow: tile.importanceTier === 'PRIMARY'
          ? `0 0 0 1px ${tierMeta.glow}, 0 4px 12px ${tierMeta.glow}`
          : `0 1px 3px rgba(0,0,0,0.2)`,
      }}
      onMouseEnter={() => setTileHover(tile.ruleId + tile.ruleName, tile.arrowVectors, tile.highlightSquares)}
      onMouseLeave={clearTileHover}
      onClick={() => setTileHover(tile.ruleId + tile.ruleName, tile.arrowVectors, tile.highlightSquares)}
    >
      {/* Header: category icon + rule name + points badge */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">{catMeta.icon}</span>
          <div className="min-w-0">
            <div
              className="text-xs font-semibold text-slate-100 truncate"
              style={{ fontWeight: tile.importanceTier === 'PRIMARY' ? 700 : 600 }}
              title={tile.ruleName}
            >
              {tile.ruleName}
            </div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">
              {catMeta.label}
            </div>
          </div>
        </div>
        <div
          className="shrink-0 px-2 py-0.5 rounded-full text-xs font-mono font-bold"
          style={{
            background: pointsBg,
            color: pointsColor,
            border: `1px solid ${pointsColor}40`,
          }}
        >
          {tile.weightedPointsCp > 0 ? '+' : ''}{tile.weightedPointsCp}cp
        </div>
      </div>

      {/* Body: principle summary */}
      <p className="text-[11px] text-slate-300 leading-snug line-clamp-3">
        {tile.principleSummary}
      </p>

      {/* Footer: tier indicator + squares */}
      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
        <span
          className="px-1.5 py-0.5 rounded uppercase tracking-wider font-medium"
          style={{
            background: tierMeta.glow,
            color: tile.importanceTier === 'PRIMARY' ? '#FEF3C7' : '#CBD5E1',
          }}
        >
          {tierMeta.label}
        </span>
        {tile.highlightSquares.length > 0 && (
          <span className="font-mono">
            ⊙ {tile.highlightSquares.slice(0, 3).join(', ')}
            {tile.highlightSquares.length > 3 && '…'}
          </span>
        )}
      </div>
    </div>
  );
}
