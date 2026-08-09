// NarrativePanel — displays the LLM-generated commentary for the current move.

'use client';

import { useGameStore } from '@/store/useGameStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, Sparkles } from 'lucide-react';
import { ClassificationBadge } from '@/components/game/ClassificationBadge';
import { CLASSIFICATION_META } from '@/types/chess';

export function NarrativePanel() {
  const currentPly = useGameStore((s) => s.currentPly);
  const moveHistory = useGameStore((s) => s.moveHistory);
  const currentCommentary = useGameStore((s) => s.currentCommentary);
  const isGeneratingNarrative = useGameStore((s) => s.isGeneratingNarrative);

  const currentMove = currentPly >= 0 ? moveHistory[currentPly] : null;
  const commentary = currentMove?.commentary || currentCommentary;

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-amber-400" />
          Coach Commentary
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
      <CardContent className="pt-0">
        {isGeneratingNarrative ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Analyzing move...
          </div>
        ) : commentary ? (
          <div className="text-sm text-slate-200 leading-relaxed">
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
          <div className="text-slate-500 text-sm py-4">
            Make a move to receive coach commentary.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
