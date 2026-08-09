// GameControls — Reset / Step Back / Step Forward / Start buttons.

'use client';

import { useGameStore } from '@/store/useGameStore';
import { Button } from '@/components/ui/button';
import { RotateCcw, ChevronLeft, ChevronRight, Play, Pause, Square, FastForward } from 'lucide-react';

export function GameControls() {
  const mode = useGameStore((s) => s.mode);
  const currentPly = useGameStore((s) => s.currentPly);
  const moveHistory = useGameStore((s) => s.moveHistory);
  const isGameActive = useGameStore((s) => s.isGameActive);
  const isPaused = useGameStore((s) => s.isPaused);
  const gameResult = useGameStore((s) => s.gameResult);

  const resetGame = useGameStore((s) => s.resetGame);
  const navigateToPly = useGameStore((s) => s.navigateToPly);
  const startSelfPlay = useGameStore((s) => s.startSelfPlay);
  const pauseSelfPlay = useGameStore((s) => s.pauseSelfPlay);

  const atStart = currentPly <= -1;
  const atEnd = currentPly >= moveHistory.length - 1;
  const isSimMode = mode === 'SIMULATE';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigateToPly(-1)}
        disabled={atStart}
        title="Jump to start (Home)"
      >
        <FastForward className="h-3.5 w-3.5 rotate-180" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigateToPly(currentPly - 1)}
        disabled={atStart}
        title="Previous move (←)"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigateToPly(currentPly + 1)}
        disabled={atEnd}
        title="Next move (→)"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => navigateToPly(moveHistory.length - 1)}
        disabled={atEnd}
        title="Jump to end (End)"
      >
        <FastForward className="h-3.5 w-3.5" />
      </Button>

      <div className="w-px h-6 bg-slate-700 mx-1" />

      {isSimMode && !isGameActive && !gameResult && (
        <Button size="sm" onClick={startSelfPlay} className="bg-emerald-600 hover:bg-emerald-700">
          <Play className="h-3.5 w-3.5 mr-1" /> Start
        </Button>
      )}
      {isSimMode && isGameActive && !isPaused && (
        <Button size="sm" variant="outline" onClick={pauseSelfPlay}>
          <Pause className="h-3.5 w-3.5 mr-1" /> Pause
        </Button>
      )}
      {isSimMode && isGameActive && isPaused && (
        <Button size="sm" onClick={startSelfPlay} className="bg-emerald-600 hover:bg-emerald-700">
          <Play className="h-3.5 w-3.5 mr-1" /> Resume
        </Button>
      )}

      <Button size="sm" variant="destructive" onClick={resetGame}>
        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
      </Button>
    </div>
  );
}
