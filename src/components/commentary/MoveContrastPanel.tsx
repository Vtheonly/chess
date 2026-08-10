// MoveContrastPanel — side-by-side comparison of Played Move vs Engine's
// Best Move. Shows what each move achieved, eval difference, and why the
// played move failed (if it did).

'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { MoveContrastComparison } from '@/lib/chess/contrastiveAnalyzer';

interface Props {
  contrast: MoveContrastComparison;
}

export function MoveContrastPanel({ contrast }: Props) {
  const badgeClass = contrast.isPlayedMoveBest
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
    : contrast.evalDifferenceCp <= 50
    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
    : 'bg-rose-500/15 text-rose-300 border-rose-500/40';

  const badgeText = contrast.isPlayedMoveBest
    ? 'TOP MOVE MATCH'
    : `-${contrast.evalDifferenceCp} cp DIFFERENCE`;

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <span className="text-lg">⚖️</span>
            Comparative Analysis
          </span>
          <span className={`text-xs px-2.5 py-1 rounded-full font-mono font-bold border ${badgeClass}`}>
            {badgeText}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="text-xs text-slate-200 font-semibold p-2.5 bg-slate-900/60 rounded border border-slate-700/50">
          {contrast.coreVerdict}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {/* Played Move */}
          <div className="bg-slate-900/40 p-3 rounded border border-slate-700/50 space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
              <span className="font-bold text-slate-200">
                Played: <span className="text-indigo-400 font-mono text-sm">{contrast.playedMoveSan}</span>
              </span>
              <span className="text-slate-400 font-mono">
                {(contrast.playedMoveEvalCp / 100).toFixed(2)} cp
              </span>
            </div>
            <div className="space-y-1">
              <span className="text-slate-400 font-medium block">Achieved:</span>
              {contrast.whatPlayedMoveAchieved.length > 0 ? (
                <ul className="space-y-1">
                  {contrast.whatPlayedMoveAchieved.map((item, idx) => (
                    <li key={idx} className="text-slate-300 flex items-start gap-1">
                      <span className="text-indigo-400 shrink-0">•</span>
                      <span className="text-[11px] leading-tight">{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-slate-500 italic text-[11px]">No structural features achieved</span>
              )}
            </div>
          </div>

          {/* Best Move */}
          <div className="bg-slate-900/40 p-3 rounded border border-slate-700/50 space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
              <span className="font-bold text-slate-200">
                Engine Top: <span className="text-emerald-400 font-mono text-sm">{contrast.bestMoveSan}</span>
              </span>
              <span className="text-emerald-400 font-mono">
                {(contrast.bestMoveEvalCp / 100).toFixed(2)} cp
              </span>
            </div>
            <div className="space-y-1">
              <span className="text-slate-400 font-medium block">Top Line Achieves:</span>
              {contrast.whatBestMoveAchieved.length > 0 ? (
                <ul className="space-y-1">
                  {contrast.whatBestMoveAchieved.map((item, idx) => (
                    <li key={idx} className="text-slate-300 flex items-start gap-1">
                      <span className="text-emerald-400 shrink-0">•</span>
                      <span className="text-[11px] leading-tight">{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-slate-500 italic text-[11px]">Standard tactical continuation</span>
              )}
            </div>
          </div>
        </div>

        {contrast.whyPlayedMoveFailed && (
          <div className="p-2.5 bg-rose-950/40 border border-rose-800/60 rounded text-xs text-rose-200">
            <strong className="text-rose-300 block mb-1">Why this move fell short:</strong>
            {contrast.whyPlayedMoveFailed}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
