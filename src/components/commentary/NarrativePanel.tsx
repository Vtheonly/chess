// NarrativePanel — Dual-View (spec §1.3): natural-language narrative +
// atomic rule tiles + feature calculation breakdown.
//
// The LLM's text is shown FIRST, then the atomic rule tiles are rendered
// directly below it.  This forces the user to see the verified symbolic
// facts alongside the prose, making LLM hallucinations visually obvious
// (the bug from the spec screenshot — LLM claiming "c6 develops the bishop"
// while no DEVELOPMENT tile exists — would be caught here).

'use client';

import { useGameStore } from '@/store/useGameStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, MessageSquare, AlertTriangle } from 'lucide-react';
import { ClassificationBadge } from '@/components/game/ClassificationBadge';
import { RuleTilesContainer } from './RuleTilesContainer';
import { FeatureCalculationDrawer } from './FeatureCalculationDrawer';
import { CLASSIFICATION_META } from '@/types/chess';

export function NarrativePanel() {
  const currentPly = useGameStore((s) => s.currentPly);
  const moveHistory = useGameStore((s) => s.moveHistory);
  const currentCommentary = useGameStore((s) => s.currentCommentary);
  const isGeneratingNarrative = useGameStore((s) => s.isGeneratingNarrative);

  const currentMove = currentPly >= 0 ? moveHistory[currentPly] : null;
  const commentary = currentMove?.commentary || currentCommentary;
  const hasHallucinationNotice = commentary?.includes('⚠️ Verification notice:');

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-amber-400" />
          Coach Commentary
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-normal ml-1">
            Dual-View
          </span>
          {currentMove?.classification && (
            <Badge
              variant="outline"
              className="ml-auto"
              style={{
                borderColor: CLASSIFICATION_META[currentMove.classification].color,
                color: CLASSIFICATION_META[currentMove.classification].color,
              }}
            >
              {CLASSIFICATION_META[currentMove.classification].label}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* ─── 1. Natural Language Narrative ─────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-wider">
            <MessageSquare className="h-3 w-3" />
            Narrative
          </div>
          {isGeneratingNarrative ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing move...
            </div>
          ) : commentary ? (
            <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
              {commentary}
            </div>
          ) : currentMove ? (
            <div className="text-slate-400 text-sm">
              <span className="font-mono text-slate-200">{currentMove.san}</span>
              {' '}— {currentMove.isCapture ? 'capture' : 'positional move'}.
              Eval: {currentMove.evalCp >= 0 ? '+' : ''}{(currentMove.evalCp / 100).toFixed(2)}.
              {currentMove.bestMoveSan && currentMove.bestMoveSan !== currentMove.san && (
                <> Engine suggested <span className="font-mono text-emerald-400">{currentMove.bestMoveSan}</span>.</>
              )}
            </div>
          ) : (
            <div className="text-slate-500 text-sm py-3">
              Make a move to receive coach commentary.
            </div>
          )}

          {/* Hallucination notice (if LLM was caught lying) */}
          {hasHallucinationNotice && (
            <div className="flex items-start gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/40 text-xs text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Anti-hallucination filter triggered.</span>{' '}
                The symbolic engine detected one or more claims in the LLM's text that
                contradict the verified chess facts.  See the atomic rule tiles below
                for the ground truth.
              </div>
            </div>
          )}
        </div>

        {/* ─── 2. Atomic Rule Tiles ──────────────────────────────────────── */}
        {currentMove && (
          <div className="border-t border-slate-700/50 pt-3">
            <RuleTilesContainer tiles={currentMove.atomicRuleTiles} />
          </div>
        )}

        {/* ─── 3. Feature Point Calculation Breakdown ────────────────────── */}
        {currentMove?.calculationBreakdown && (
          <div className="border-t border-slate-700/50 pt-3">
            <FeatureCalculationDrawer breakdown={currentMove.calculationBreakdown} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
