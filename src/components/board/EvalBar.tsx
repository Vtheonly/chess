// EvalBar — vertical centipawn evaluation bar (White on bottom, Black on top).

'use client';

import { useGameStore } from '@/store/useGameStore';
import { evaluate, winChance } from '@/lib/chess/engine';

interface Props {
  height?: number;
  width?: number;
}

export function EvalBar({ height = 480, width = 28 }: Props) {
  const fen = useGameStore((s) => s.fen);
  const evalResult = evaluate(fen);
  const wc = winChance(evalResult.cp, evalResult.isMate, evalResult.mateIn);
  // White's share from 0..1
  const whiteShare = Math.max(0.02, Math.min(0.98, wc));

  const isMate = evalResult.isMate;
  const mateLabel = isMate && evalResult.cp > 0 ? 'M' : isMate && evalResult.cp < 0 ? '-M' : null;

  // Format eval label: e.g. "+1.2", "-0.5", "M5"
  const evalLabel = isMate
    ? (evalResult.cp > 0 ? 'M' : '-M')
    : `${evalResult.cp >= 0 ? '+' : ''}${(evalResult.cp / 100).toFixed(1)}`;

  return (
    <div
      className="relative rounded-md overflow-hidden border border-slate-700 shadow-lg"
      style={{ height, width, background: '#1A1A1A' }}
    >
      {/* Black portion (top) */}
      <div
        className="absolute top-0 left-0 right-0 transition-all duration-300 ease-out"
        style={{
          height: `${(1 - whiteShare) * 100}%`,
          background: '#0F172A',
        }}
      >
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-slate-300">
          {evalResult.cp < 0 ? evalLabel : ''}
        </span>
      </div>
      {/* White portion (bottom) */}
      <div
        className="absolute bottom-0 left-0 right-0 transition-all duration-300 ease-out"
        style={{
          height: `${whiteShare * 100}%`,
          background: '#F1F5F9',
        }}
      >
        <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-slate-700">
          {evalResult.cp >= 0 ? evalLabel : ''}
        </span>
      </div>
    </div>
  );
}
