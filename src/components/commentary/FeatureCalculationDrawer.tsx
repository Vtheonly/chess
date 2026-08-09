// FeatureCalculationDrawer — expandable accordion showing the exact
// mathematical tally (base score × phase multiplier = final points).
// Mirrors spec §2.2.

'use client';

import { useState } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Calculator, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { CalculationBreakdown } from '@/types/chess';

interface Props {
  breakdown?: CalculationBreakdown;
}

export function FeatureCalculationDrawer({ breakdown }: Props) {
  const [open, setOpen] = useState(false);
  const currentPly = useGameStore((s) => s.currentPly);
  const moveHistory = useGameStore((s) => s.moveHistory);

  const bd = breakdown ?? (currentPly >= 0 ? moveHistory[currentPly]?.calculationBreakdown : undefined);

  if (!bd) return null;

  const phaseLabel = bd.gamePhaseFactor >= 0.75 ? 'Middlegame'
                   : bd.gamePhaseFactor >= 0.4 ? 'Transition'
                   : 'Endgame';
  const sumOfRules = bd.ruleCalculations.reduce((s, r) => s + r.finalPointsCp, 0);
  const matchesNet = Math.abs(sumOfRules - bd.netChangeCp) <= 50;  // ±50cp tolerance (heuristic eval ≠ pure rule sum)
  const moverPositive = bd.netChangeCp >= 0 ? bd.whitePositivePoints : bd.blackPositivePoints;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="bg-slate-800/40 border-slate-700">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between p-3 h-auto hover:bg-slate-800/80"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <Calculator className="h-4 w-4 text-cyan-400" />
              Feature Point Calculation Breakdown
            </span>
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-3 space-y-3">
            {/* Top summary row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <SummaryCell
                label="Eval Before"
                value={`${bd.startEvalCp >= 0 ? '+' : ''}${(bd.startEvalCp / 100).toFixed(2)}`}
              />
              <SummaryCell
                label="Eval After"
                value={`${bd.endEvalCp >= 0 ? '+' : ''}${(bd.endEvalCp / 100).toFixed(2)}`}
                highlight
              />
              <SummaryCell
                label="Net Change"
                value={`${bd.netChangeCp >= 0 ? '+' : ''}${bd.netChangeCp}cp`}
                highlight
              />
              <SummaryCell
                label="Game Phase"
                value={`${phaseLabel} (${bd.gamePhaseFactor.toFixed(2)})`}
              />
            </div>

            {/* Rule calculation table */}
            <div className="rounded-md border border-slate-700 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-800/80 text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="text-left py-2 px-2 font-medium">Rule</th>
                    <th className="text-right py-2 px-2 font-medium">Base</th>
                    <th className="text-right py-2 px-2 font-medium">× Phase</th>
                    <th className="text-right py-2 px-2 font-medium">Final</th>
                  </tr>
                </thead>
                <tbody>
                  {bd.ruleCalculations.map((r, i) => (
                    <tr key={i} className="border-t border-slate-700/50">
                      <td className="py-1.5 px-2 text-slate-200">{r.ruleName}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-slate-300">
                        {r.baseScoreCp >= 0 ? '+' : ''}{r.baseScoreCp}cp
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono text-slate-400">
                        × {r.phaseWeightMultiplier.toFixed(2)}
                      </td>
                      <td
                        className="py-1.5 px-2 text-right font-mono font-bold"
                        style={{
                          color: r.finalPointsCp > 0 ? '#22C55E' : r.finalPointsCp < 0 ? '#EF4444' : '#94A3B8',
                        }}
                      >
                        {r.finalPointsCp >= 0 ? '+' : ''}{r.finalPointsCp}cp
                      </td>
                    </tr>
                  ))}
                  {bd.ruleCalculations.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-center text-slate-500 italic">
                        No discrete rule calculations (quiet move).
                      </td>
                    </tr>
                  )}
                </tbody>
                {bd.ruleCalculations.length > 0 && (
                  <tfoot className="bg-slate-800/80">
                    <tr className="border-t-2 border-slate-600">
                      <td className="py-2 px-2 font-semibold text-slate-200" colSpan={3}>
                        Sum of rule points
                      </td>
                      <td
                        className="py-2 px-2 text-right font-mono font-bold"
                        style={{ color: sumOfRules >= 0 ? '#22C55E' : '#EF4444' }}
                      >
                        {sumOfRules >= 0 ? '+' : ''}{sumOfRules}cp
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2 text-slate-400" colSpan={3}>
                        vs. actual eval delta (tolerance ±50cp)
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono text-slate-400">
                        {bd.netChangeCp >= 0 ? '+' : ''}{bd.netChangeCp}cp
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2" colSpan={4}>
                        <div className="flex items-center justify-end gap-1.5 text-xs">
                          {matchesNet ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                              <span className="text-emerald-400">Match</span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                              <span className="text-amber-400">
                                Heuristic residual ({Math.abs(sumOfRules - bd.netChangeCp)}cp)
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Positive/negative split */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 p-2">
                <div className="text-emerald-400 text-[10px] uppercase tracking-wider">Positive Points</div>
                <div className="font-mono font-bold text-emerald-300">+{bd.whitePositivePoints}cp</div>
              </div>
              <div className="rounded-md bg-red-500/10 border border-red-500/30 p-2">
                <div className="text-red-400 text-[10px] uppercase tracking-wider">Negative Points</div>
                <div className="font-mono font-bold text-red-300">-{bd.blackPositivePoints}cp</div>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function SummaryCell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md p-2 ${highlight ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-slate-800/60'}`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`font-mono font-bold ${highlight ? 'text-amber-300' : 'text-slate-100'}`}>
        {value}
      </div>
    </div>
  );
}
