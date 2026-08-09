// ThreatList — lists concrete tactical threats detected in the current position.

'use client';

import { useGameStore } from '@/store/useGameStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skull } from 'lucide-react';
import { evaluate, searchBestMove, see } from '@/lib/chess/engine';
import { useMemo } from 'react';
import { Chess } from 'chess.js';

export function ThreatList() {
  const fen = useGameStore((s) => s.fen);
  const currentPly = useGameStore((s) => s.currentPly);
  const moveHistory = useGameStore((s) => s.moveHistory);

  const threats = useMemo(() => {
    // Re-compute threats from the current FEN
    try {
      const chess = new Chess(fen);
      if (chess.isGameOver()) return [];
      // Null-move proxy: toggle side via FEN
      const fenParts = fen.split(' ');
      fenParts[1] = fenParts[1] === 'w' ? 'b' : 'w';
      fenParts[3] = '-';
      const tmpBoard = new Chess();
      tmpBoard.load(fenParts.join(' '));
      const captures = tmpBoard.moves({ verbose: true });
      const out: Array<{ san: string; gain: number; target: string; piece: string }> = [];
      for (const m of captures.slice(0, 12)) {
        if (!m.captured) continue;
        const gain = see(tmpBoard.fen(), m.lan);
        if (gain >= 0) {
          out.push({ san: m.san, gain, target: m.to, piece: m.captured });
        }
      }
      return out.sort((a, b) => b.gain - a.gain).slice(0, 5);
    } catch {
      return [];
    }
  }, [fen]);

  const bestMove = useMemo(() => {
    try {
      return searchBestMove(fen, 1);
    } catch {
      return null;
    }
  }, [fen]);

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Skull className="h-4 w-4 text-red-400" />
          Tactical Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Best Move</div>
          {bestMove && bestMove.bestMoveSan ? (
            <div className="font-mono text-lg text-emerald-400">{bestMove.bestMoveSan}</div>
          ) : (
            <div className="text-slate-500 text-sm">—</div>
          )}
          {bestMove && bestMove.pv.length > 1 && (
            <div className="text-xs text-slate-500 mt-1">
              PV: {bestMove.pv.slice(0, 5).join(' ')}
            </div>
          )}
        </div>

        <div className="border-t border-slate-700 pt-2">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            Concrete Threats ({threats.length})
          </div>
          {threats.length === 0 ? (
            <div className="text-slate-500 text-sm">No winning captures available.</div>
          ) : (
            <ul className="space-y-1">
              {threats.map((t, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-slate-200">{t.san}</span>
                  <span className="text-xs text-slate-400">
                    +{t.gain}cp on {t.piece} @ {t.target}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
