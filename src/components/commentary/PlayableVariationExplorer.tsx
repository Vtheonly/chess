// PlayableVariationExplorer — interactive sub-board + synchronized step
// commentary for the 6-move future variation line.
//
// Uses our existing ChessboardContainer for the mini-board (rendered in
// read-only mode by setting a separate game store slice... actually we
// just render a lightweight standalone SVG board here to avoid coupling
// with the main game store).

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Chess } from 'chess.js';
import type { VariationStep } from '@/lib/chess/multiMoveChainAnalyzer';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Play, Pause, SkipBack, SkipForward, X } from 'lucide-react';

interface Props {
  steps: VariationStep[];
  onExit: () => void;
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1];
const LIGHT_BG = '#F0D9B5';
const DARK_BG = '#B58863';
const PIECE_UNICODE: Record<string, string> = {
  wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
  bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚',
};

export function PlayableVariationExplorer({ steps, onExit }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const currentStep = steps[currentIndex];

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= steps.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1500);
    return () => clearInterval(interval);
  }, [isPlaying, steps.length]);

  const goTo = useCallback((idx: number) => {
    setIsPlaying(false);
    setCurrentIndex(Math.max(0, Math.min(steps.length - 1, idx)));
  }, [steps.length]);

  if (!currentStep) return null;

  // Render the mini-board from currentStep.fenAfter
  const chess = new Chess(currentStep.fenAfter);
  const lastMove = {
    from: currentStep.moveUci.slice(0, 2),
    to: currentStep.moveUci.slice(2, 4),
  };

  const roleBadge = {
    player_initiator: { label: 'Player Initiator', cls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' },
    opponent_response: { label: 'Opponent Response', cls: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
    player_continuation: { label: 'Player Continuation', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
    opponent_defense: { label: 'Opponent Defense', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  }[currentStep.role];

  const squareSize = 32; // mini-board: 256px / 8

  return (
    <div className="bg-slate-900 border-2 border-indigo-500/80 rounded-xl p-4 shadow-2xl my-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl"></span>
          <div>
            <h3 className="font-bold text-indigo-300 text-sm tracking-wide">
              PLAYABLE VARIATION EXPLORER
            </h3>
            <p className="text-[11px] text-slate-400">
              Step through the {steps.length}-move future chain to see how the position develops.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onExit}>
          <X className="h-3.5 w-3.5" /> Close
        </Button>
      </div>

      {/* Main Grid: Mini Board + Step Commentary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {/* Interactive Mini Board */}
        <div className="space-y-2">
          <div className="w-full max-w-[256px] mx-auto">
            <div className="grid grid-cols-8 grid-rows-8 rounded-lg overflow-hidden border-2 border-slate-700 shadow-md">
              {RANKS.map((rank, rIdx) =>
                FILES.map((file, fIdx) => {
                  const sq = `${file}${rank}`;
                  const isLight = (rIdx + fIdx) % 2 === 0;
                  const piece = chess.get(sq as any);
                  const isLastMove = lastMove.from === sq || lastMove.to === sq;
                  const pieceKey = piece ? `${piece.color}${piece.type}` : null;
                  return (
                    <div
                      key={sq}
                      className="relative flex items-center justify-center"
                      style={{
                        background: isLight ? LIGHT_BG : DARK_BG,
                        width: squareSize,
                        height: squareSize,
                      }}
                    >
                      {isLastMove && (
                        <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(245, 158, 11, 0.45)' }} />
                      )}
                      {pieceKey && (
                        <span
                          style={{
                            fontSize: squareSize * 0.78,
                            lineHeight: 1,
                            color: piece!.color === 'w' ? '#FFFFFF' : '#1A1A1A',
                            textShadow: piece!.color === 'w'
                              ? '0 1px 2px rgba(0,0,0,0.6)'
                              : '0 1px 2px rgba(255,255,255,0.3)',
                          }}
                        >
                          {PIECE_UNICODE[pieceKey]}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Playback Controls */}
          <div className="flex items-center justify-center gap-1.5 pt-1">
            <Button size="icon" variant="outline" onClick={() => goTo(0)} disabled={currentIndex === 0} className="h-7 w-7">
              <SkipBack className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === 0}>
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </Button>
            <Button size="sm" onClick={() => setIsPlaying(!isPlaying)} className="bg-indigo-600 hover:bg-indigo-500">
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {isPlaying ? 'Pause' : 'Auto-Play'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => goTo(currentIndex + 1)} disabled={currentIndex === steps.length - 1}>
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="outline" onClick={() => goTo(steps.length - 1)} disabled={currentIndex === steps.length - 1} className="h-7 w-7">
              <SkipForward className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Synchronized Step Explanation */}
        <div className="space-y-3 bg-slate-800/80 p-3.5 rounded-lg border border-slate-700">
          <div className="flex items-center justify-between border-b border-slate-700 pb-2">
            <span className="font-bold text-slate-200 text-sm">
              Step {currentIndex + 1} of {steps.length}:{' '}
              <span className="text-indigo-400 font-mono">{currentStep.moveSan}</span>
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase border ${roleBadge.cls}`}>
              {roleBadge.label}
            </span>
          </div>

          <div className="space-y-1.5">
            <span className="text-slate-400 font-medium block text-[11px]">What this move accomplishes:</span>
            <p className="text-slate-200 bg-slate-900/60 p-2 rounded border border-slate-700/60 font-medium text-xs">
              {currentStep.stepGoal}
            </p>
          </div>

          {currentStep.tiles.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-slate-400 font-medium block text-[11px]">Active rules at this step:</span>
              <div className="space-y-1">
                {currentStep.tiles.map((tile, idx) => (
                  <div key={idx} className="bg-slate-900/40 p-1.5 rounded border border-slate-700/50 flex items-center justify-between">
                    <span className="font-semibold text-slate-300 text-xs">{tile.ruleName}</span>
                    <span className="font-mono text-emerald-400 font-bold text-xs">
                      {tile.weightedPointsCp > 0 ? '+' : ''}{tile.weightedPointsCp} cp
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-1 border-t border-slate-700 text-slate-400 font-mono text-xs">
            <span>Resulting Eval:</span>
            <span className="text-slate-200 font-bold">
              {currentStep.evalCp > 0 ? '+' : ''}{(currentStep.evalCp / 100).toFixed(2)} cp
            </span>
          </div>
        </div>
      </div>

      {/* Chain Sequence Pills */}
      <div className="mt-3 pt-3 border-t border-slate-800 flex items-center gap-1.5 overflow-x-auto pb-1">
        <span className="text-slate-400 font-medium text-[11px] shrink-0">Chain:</span>
        {steps.map((step, idx) => (
          <button
            key={idx}
            onClick={() => goTo(idx)}
            className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold shrink-0 transition-all ${
              idx === currentIndex
                ? 'bg-indigo-600 text-white shadow-md scale-105 ring-2 ring-indigo-400'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {idx + 1}. {step.moveSan}
          </button>
        ))}
      </div>
    </div>
  );
}
