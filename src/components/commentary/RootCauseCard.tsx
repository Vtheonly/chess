// RootCauseCard — "Patient Zero" callout showing where a mistake originated.
// Scans backward through game history to find the inflexion point.

'use client';

import { useGameStore } from '@/store/useGameStore';
import type { RootCauseRecord } from '@/lib/chess/rootCauseTracer';

interface Props {
  record: RootCauseRecord;
}

export function RootCauseCard({ record }: Props) {
  const navigateToPly = useGameStore((s) => s.navigateToPly);

  return (
    <div className="bg-rose-950/40 border border-rose-800/80 rounded-xl p-4 shadow-lg">
      <div className="flex items-center justify-between border-b border-rose-900/80 pb-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">☣️</span>
          <h3 className="font-semibold text-rose-200 text-sm tracking-wide uppercase">
            Patient Zero (Root Cause)
          </h3>
        </div>
        <span className="text-xs px-2 py-0.5 bg-rose-900 text-rose-200 font-mono rounded">
          -{record.patientZeroEvalDropCp} cp Drop
        </span>
      </div>

      <div className="space-y-2 text-xs">
        <p className="text-rose-100 font-medium leading-relaxed">{record.rootCauseExplanation}</p>

        <div className="flex items-center justify-between pt-1 text-slate-300">
          <span>
            Introduced on move{' '}
            <strong className="text-rose-300">{record.patientZeroMoveNumber}</strong>{' '}
            ({record.patientZeroMoveSan})
          </span>
          <button
            onClick={() => navigateToPly(record.patientZeroPly)}
            className="px-2.5 py-1 bg-rose-800 hover:bg-rose-700 text-white rounded font-medium transition-colors text-xs"
          >
            Jump to Move {record.patientZeroMoveNumber} ↵
          </button>
        </div>
      </div>
    </div>
  );
}
