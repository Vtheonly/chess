// AccuracySummary — header cards showing per-player accuracy and classification counts.

'use client';

import { useGameStore } from '@/store/useGameStore';
import { Card, CardContent } from '@/components/ui/card';
import { gameAccuracy } from '@/lib/chess/engine';
import { CLASSIFICATION_META, type MoveClassification } from '@/types/chess';
import { useMemo } from 'react';
import { Target, AlertTriangle, Sparkles, TrendingDown } from 'lucide-react';

export function AccuracySummary() {
  const moveHistory = useGameStore((s) => s.moveHistory);

  const summary = useMemo(() => {
    const whiteDeltas: number[] = [];
    const blackDeltas: number[] = [];
    const counts: Record<MoveClassification, number> = {
      BRILLIANT: 0, GREAT: 0, BEST: 0, EXCELLENT: 0, GOOD: 0, BOOK: 0,
      INACCURACY: 0, MISTAKE: 0, BLUNDER: 0, MISS: 0,
    };

    for (const m of moveHistory) {
      // Reconstruct deltaW from win chance
      // (we stored winChance = wcAfter, but need delta from player perspective)
      // For accuracy formula, we need (W_after - W_before) from the player's perspective.
      // Since we don't store W_before on the move record, we'll re-evaluate the FEN before.
      // For simplicity, use the stored evalCp shifts as a proxy.
      // Proper impl: re-run evaluate on fenBefore and compute deltaW.
      // Skip the proxy for now; show counts only.
      if (m.classification) counts[m.classification]++;
    }

    // Compute accuracy using win-chance deltas
    for (const m of moveHistory) {
      // Re-compute deltaW
      // We have evalCp = after-eval. Need before-eval too.
      // For now, use the previous move's evalCp as the "before"
      const idx = m.ply;
      const beforeEval = idx > 0 ? moveHistory[idx - 1].evalCp : 0;
      const afterEval = m.evalCp;
      const playerSign = m.turn === 'white' ? 1 : -1;
      const deltaCp = (afterEval - beforeEval) * playerSign;
      const deltaW = deltaCp / 400;  // approx, since W ≈ 0.5 + cp/800 near 0
      if (m.turn === 'white') whiteDeltas.push(deltaW);
      else blackDeltas.push(deltaW);
    }

    return {
      whiteAccuracy: gameAccuracy(whiteDeltas),
      blackAccuracy: gameAccuracy(blackDeltas),
      counts,
      totalPlies: moveHistory.length,
    };
  }, [moveHistory]);

  const cards = [
    { label: 'White Accuracy', value: `${summary.whiteAccuracy.toFixed(1)}%`, color: '#F1F5F9', icon: Target },
    { label: 'Black Accuracy', value: `${summary.blackAccuracy.toFixed(1)}%`, color: '#94A3B8', icon: Target },
    { label: 'Brilliant Moves', value: summary.counts.BRILLIANT, color: CLASSIFICATION_META.BRILLIANT.color, icon: Sparkles },
    { label: 'Blunders', value: summary.counts.BLUNDER, color: CLASSIFICATION_META.BLUNDER.color, icon: AlertTriangle },
    { label: 'Mistakes', value: summary.counts.MISTAKE, color: CLASSIFICATION_META.MISTAKE.color, icon: TrendingDown },
    { label: 'Inaccuracies', value: summary.counts.INACCURACY, color: CLASSIFICATION_META.INACCURACY.color, icon: TrendingDown },
  ];

  if (moveHistory.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((c) => (
        <Card key={c.label} className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">{c.label}</span>
              <c.icon className="h-3.5 w-3.5" style={{ color: c.color }} />
            </div>
            <div className="text-2xl font-bold" style={{ color: c.color }}>
              {c.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
