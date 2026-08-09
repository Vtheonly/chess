// PlayerHeader — shows player name, color, ELO, captured material, and clock-like indicator.

'use client';

import { useGameStore } from '@/store/useGameStore';

interface Props {
  color: 'white' | 'black';
  name?: string;
  elo?: number;
}

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

export function PlayerHeader({ color, name, elo }: Props) {
  const moveHistory = useGameStore((s) => s.moveHistory);
  const fen = useGameStore((s) => s.fen);
  const isGameActive = useGameStore((s) => s.isGameActive);
  const playerColor = useGameStore((s) => s.playerColor);
  const aiPlayElo = useGameStore((s) => s.aiPlayElo);

  // Calculate captured material for this color
  const captures = moveHistory
    .filter(m => m.isCapture && m.turn !== color)
    .map(m => {
      // Look up captured piece type from SAN (x indicates capture, but type is harder)
      // Simplification: parse from the move record's uci — check what was on the destination
      return m.san;
    });

  // Calculate material advantage
  const materialDiff = calculateMaterialDiff(fen, color);

  const displayName = name || (color === playerColor ? 'You' : `Stockfish ${aiPlayElo}`);
  const displayElo = elo || (color === playerColor ? undefined : aiPlayElo);

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-800 rounded-md">
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-lg"
          style={{ background: color === 'white' ? '#F1F5F9' : '#0F172A', color: color === 'white' ? '#0F172A' : '#F1F5F9' }}
        >
          {color === 'white' ? '♔' : '♚'}
        </div>
        <div>
          <div className="text-sm font-medium text-slate-100">{displayName}</div>
          {displayElo && <div className="text-xs text-slate-400">{displayElo} Elo</div>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {captures.length > 0 && (
          <div className="text-xs text-slate-400">
            Captured: {captures.length}
          </div>
        )}
        {materialDiff > 0 && (
          <div className="text-xs font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
            +{materialDiff}
          </div>
        )}
        {isGameActive && (
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        )}
      </div>
    </div>
  );
}

function calculateMaterialDiff(fen: string, color: 'white' | 'black'): number {
  // Count pieces on the board
  const white: Record<string, number> = { p:0,n:0,b:0,r:0,q:0,k:0 };
  const black: Record<string, number> = { p:0,n:0,b:0,r:0,q:0,k:0 };
  const board = fen.split(' ')[0];
  for (const ch of board) {
    if ('PNBRQK'.includes(ch)) white[ch.toLowerCase()]++;
    if ('pnbrqk'.includes(ch)) black[ch]++;
  }
  const whiteMat = white.p*1 + white.n*3 + white.b*3 + white.r*5 + white.q*9;
  const blackMat = black.p*1 + black.n*3 + black.b*3 + black.r*5 + black.q*9;
  const diff = color === 'white' ? whiteMat - blackMat : blackMat - whiteMat;
  return Math.max(0, diff);
}
