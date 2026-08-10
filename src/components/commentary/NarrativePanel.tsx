// NarrativePanel — Comprehensive Diagnostic Dashboard.
//
// Renders the full multi-card analysis for each move:
//   1. Position Health Audit (what makes the position good/bad)
//   2. Contrastive Analysis (Played vs Best Move)
//   3. Patient Zero Root Cause (where the mistake started — if applicable)
//   4. Multi-Move Strategic Chain (7-stage future plan)
//   5. Playable Variation Explorer (interactive sub-board — on demand)
//   6. Natural Language Narrative (LLM text + anti-hallucination banner)
//   7. Atomic Rule Tiles (verified symbolic facts)
//   8. Feature Point Calculation Breakdown (math)

'use client';

import { useState, useMemo } from 'react';
import { Chess } from 'chess.js';
import { useGameStore } from '@/store/useGameStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles, MessageSquare, AlertTriangle } from 'lucide-react';
import { ClassificationBadge } from '@/components/game/ClassificationBadge';
import { RuleTilesContainer } from './RuleTilesContainer';
import { FeatureCalculationDrawer } from './FeatureCalculationDrawer';
import { PositionAssessmentCard } from './PositionAssessmentCard';
import { MoveContrastPanel } from './MoveContrastPanel';
import { RootCauseCard } from './RootCauseCard';
import { StrategicChainCard } from './StrategicChainCard';
import { PlayableVariationExplorer } from './PlayableVariationExplorer';
import { CLASSIFICATION_META } from '@/types/chess';
import { assessPositionHealth } from '@/lib/chess/positionAssessor';
import { analyzeMoveContrast } from '@/lib/chess/contrastiveAnalyzer';
import { traceRootCause } from '@/lib/chess/rootCauseTracer';
import { analyzeMultiMoveChain } from '@/lib/chess/multiMoveChainAnalyzer';
import { evaluate, searchBestMove } from '@/lib/chess/engine';

export function NarrativePanel() {
  const currentPly = useGameStore((s) => s.currentPly);
  const moveHistory = useGameStore((s) => s.moveHistory);
  const currentCommentary = useGameStore((s) => s.currentCommentary);
  const isGeneratingNarrative = useGameStore((s) => s.isGeneratingNarrative);
  const [showVariationExplorer, setShowVariationExplorer] = useState(false);

  const currentMove = currentPly >= 0 ? moveHistory[currentPly] : null;
  const commentary = currentMove?.commentary || currentCommentary;
  const hasHallucinationNotice = commentary?.includes('⚠️ Verification notice:');

  // Compute diagnostic analyses (memoized so they don't recompute on every render)
  const diagnostics = useMemo(() => {
    if (!currentMove) return null;

    // 1. Position Health Audit
    const healthAssessment = assessPositionHealth(currentMove.fenBefore, currentMove.evalCp);

    // 2. Contrastive Analysis (Played vs Best Move)
    const evalBefore = currentPly > 0
      ? moveHistory[currentPly - 1].evalCp
      : 0;
    const contrast = analyzeMoveContrast(
      currentMove.fenBefore,
      currentMove.uci,
      currentMove.san,
      evalBefore,
      currentMove.evalCp,
    );

    // 3. Root Cause
    const rootCause = traceRootCause(moveHistory, currentPly);

    // 4. Multi-Move Strategic Chain
    // Build PV line from search + current move
    const search = searchBestMove(currentMove.fenBefore, 1);
    const pvLineSan = search.pv.length > 0 ? [currentMove.san, ...search.pv.slice(1)] : [currentMove.san];
    const pvLineUci = [currentMove.uci, ...search.bestMoveUci ? [search.bestMoveUci] : []];
    // Try to build UCI for PV moves by replaying
    const pvUciList: string[] = [currentMove.uci];
    try {
      const tmpBoard = new Chess(currentMove.fenBefore);
      tmpBoard.move(currentMove.uci);
      for (let i = 1; i < pvLineSan.length; i++) {
        const m = tmpBoard.move(pvLineSan[i]);
        if (m) pvUciList.push(m.lan);
        else break;
      }
    } catch { /* keep partial */ }

    const bestEvalCp = currentMove.evalCp + (contrast.isPlayedMoveBest ? 0 : contrast.evalDifferenceCp);
    const strategicChain = analyzeMultiMoveChain(
      currentMove.fenBefore,
      currentMove.uci,
      currentMove.san,
      contrast.bestMoveSan,
      evalBefore,
      currentMove.evalCp,
      bestEvalCp,
      pvLineSan,
      pvUciList,
    );

    return { healthAssessment, contrast, rootCause, strategicChain };
  }, [currentMove, currentPly, moveHistory]);

  return (
    <div className="space-y-4">
      {/* ─── 1. Position Health Audit ────────────────────────────────────── */}
      {diagnostics && <PositionAssessmentCard assessment={diagnostics.healthAssessment} />}

      {/* ─── 2. Contrastive Analysis ─────────────────────────────────────── */}
      {diagnostics && <MoveContrastPanel contrast={diagnostics.contrast} />}

      {/* ─── 3. Patient Zero Root Cause ──────────────────────────────────── */}
      {diagnostics?.rootCause && <RootCauseCard record={diagnostics.rootCause} />}

      {/* ─── 4. Multi-Move Strategic Chain ───────────────────────────────── */}
      {diagnostics && (
        <StrategicChainCard
          chain={diagnostics.strategicChain}
          onExploreVariation={() => setShowVariationExplorer(true)}
        />
      )}

      {/* ─── 5. Playable Variation Explorer (on demand) ──────────────────── */}
      {showVariationExplorer && diagnostics && (
        <PlayableVariationExplorer
          steps={diagnostics.strategicChain.variationSteps}
          onExit={() => setShowVariationExplorer(false)}
        />
      )}

      {/* ─── 6. Coach Commentary + Rule Tiles + Math ─────────────────────── */}
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
          {/* Narrative text */}
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

            {hasHallucinationNotice && (
              <div className="flex items-start gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/40 text-xs text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Anti-hallucination filter triggered.</span>{' '}
                  The symbolic engine detected claims in the LLM's text that contradict the
                  verified chess facts. See the atomic rule tiles below for the ground truth.
                </div>
              </div>
            )}
          </div>

          {/* Atomic Rule Tiles */}
          {currentMove && (
            <div className="border-t border-slate-700/50 pt-3">
              <RuleTilesContainer tiles={currentMove.atomicRuleTiles} />
            </div>
          )}

          {/* Feature Calculation Breakdown */}
          {currentMove?.calculationBreakdown && (
            <div className="border-t border-slate-700/50 pt-3">
              <FeatureCalculationDrawer breakdown={currentMove.calculationBreakdown} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
