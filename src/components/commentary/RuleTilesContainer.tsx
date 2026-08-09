// RuleTilesContainer — grid of AtomicRuleTileCards rendered alongside the
// narrative text.  Mirrors spec §2.1.

'use client';

import { useGameStore } from '@/store/useGameStore';
import { AtomicRuleTileCard } from './AtomicRuleTileCard';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Puzzle } from 'lucide-react';
import type { AtomicRuleTile } from '@/types/chess';

interface Props {
  tiles?: AtomicRuleTile[];
}

export function RuleTilesContainer({ tiles }: Props) {
  const currentPly = useGameStore((s) => s.currentPly);
  const moveHistory = useGameStore((s) => s.moveHistory);

  // If no tiles prop, derive from current move
  const resolvedTiles = tiles ?? (currentPly >= 0 ? moveHistory[currentPly]?.atomicRuleTiles : undefined) ?? [];

  if (resolvedTiles.length === 0) {
    return (
      <div className="text-center text-slate-500 text-xs py-3">
        No atomic rules fired for this move.
      </div>
    );
  }

  // Sort by absolute points desc — most impactful first
  const sorted = [...resolvedTiles].sort((a, b) => Math.abs(b.weightedPointsCp) - Math.abs(a.weightedPointsCp));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-slate-400 uppercase tracking-wider">
        <Puzzle className="h-3.5 w-3.5" />
        Underlying Atomic Rules ({sorted.length})
        <span className="text-slate-500 normal-case tracking-normal italic">
          — hover to highlight on board
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {sorted.map((tile, i) => (
          <AtomicRuleTileCard key={`${tile.ruleId}-${i}`} tile={tile} />
        ))}
      </div>
    </div>
  );
}
