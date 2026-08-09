// MoveHistoryTable — move list with classification badges, click to navigate.

'use client';

import { useGameStore } from '@/store/useGameStore';
import { ClassificationBadge } from './ClassificationBadge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useEffect, useRef } from 'react';

export function MoveHistoryTable() {
  const moveHistory = useGameStore((s) => s.moveHistory);
  const currentPly = useGameStore((s) => s.currentPly);
  const navigateToPly = useGameStore((s) => s.navigateToPly);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to current move
  useEffect(() => {
    if (!scrollRef.current) return;
    const activeEl = scrollRef.current.querySelector('[data-active="true"]') as HTMLElement;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentPly]);

  // Group moves into pairs (white move, black move)
  const rows: Array<{ num: number; white?: typeof moveHistory[0]; black?: typeof moveHistory[0] }> = [];
  for (let i = 0; i < moveHistory.length; i += 2) {
    rows.push({
      num: Math.floor(i / 2) + 1,
      white: moveHistory[i],
      black: moveHistory[i + 1],
    });
  }

  if (rows.length === 0) {
    return (
      <div className="text-center text-slate-500 py-8 text-sm">
        No moves yet. Make a move to begin analysis.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="max-h-96 overflow-y-auto custom-scroll">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.num} className="border-b border-slate-800 last:border-0">
              <td className="py-1.5 px-2 text-slate-500 font-mono text-xs w-8">
                {row.num}.
              </td>
              <td
                className={`py-1.5 px-2 cursor-pointer hover:bg-slate-800 transition-colors ${
                  currentPly === (row.white?.ply ?? -1) ? 'bg-slate-700' : ''
                }`}
                data-active={currentPly === (row.white?.ply ?? -1)}
                onClick={() => row.white && navigateToPly(row.white.ply)}
              >
                <div className="flex items-center gap-2">
                  {row.white?.classification && (
                    <ClassificationBadge classification={row.white.classification} size="sm" />
                  )}
                  <span className="font-mono">{row.white?.san}</span>
                </div>
              </td>
              <td
                className={`py-1.5 px-2 cursor-pointer hover:bg-slate-800 transition-colors ${
                  currentPly === (row.black?.ply ?? -1) ? 'bg-slate-700' : ''
                }`}
                data-active={currentPly === (row.black?.ply ?? -1)}
                onClick={() => row.black && navigateToPly(row.black.ply)}
              >
                <div className="flex items-center gap-2">
                  {row.black?.classification && (
                    <ClassificationBadge classification={row.black.classification} size="sm" />
                  )}
                  <span className="font-mono">{row.black?.san}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
