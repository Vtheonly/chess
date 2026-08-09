// ChessboardContainer — interactive SVG chessboard with drag-and-drop,
// legal-move dots, last-move highlight, check highlight, and SVG arrows.

'use client';

import { useCallback, useMemo, useState, useEffect } from 'react';
import { Chess, Square, PieceSymbol, Color } from 'chess.js';
import { useGameStore } from '@/store/useGameStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { ARROW_COLORS } from '@/types/chess';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1];

// Square colors per spec §11.1
const LIGHT_BG = '#F0D9B5';
const DARK_BG = '#B58863';
const LAST_MOVE_TINT = 'rgba(245, 158, 11, 0.45)';
const SELECTED_TINT = 'rgba(245, 158, 11, 0.55)';
const CHECK_TINT = 'rgba(239, 68, 68, 0.55)';
const LEGAL_DOT = 'rgba(34, 197, 94, 0.55)';
const LEGAL_CAPTURE_RING = 'rgba(239, 68, 68, 0.65)';

// Unicode chess pieces (no external SVG required)
const PIECE_UNICODE: Record<string, string> = {
  wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
  bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚',
};

interface DragState {
  from: string;
  x: number;
  y: number;
  piece: string;
}

export function ChessboardContainer({ size = 480 }: { size?: number }) {
  const fen = useGameStore((s) => s.fen);
  const selectedSquare = useGameStore((s) => s.selectedSquare);
  const legalMoves = useGameStore((s) => s.legalMovesFromSelected);
  const lastMove = useGameStore((s) => s.lastMove);
  const activeArrows = useGameStore((s) => s.activeArrows);
  const selectSquare = useGameStore((s) => s.selectSquare);
  const makeMove = useGameStore((s) => s.makeMove);
  const orientation = useSettingsStore((s) => s.boardOrientation);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);

  const chess = useMemo(() => {
    try { return new Chess(fen); } catch { return new Chess(); }
  }, [fen]);

  const inCheck = chess.inCheck() && !chess.isCheckmate();
  const checkSquare = useMemo(() => {
    if (!inCheck) return null;
    const turn = chess.turn();
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = board[r][f];
        if (p && p.type === 'k' && p.color === turn) {
          return `${FILES[f]}${8 - r}`;
        }
      }
    }
    return null;
  }, [chess, inCheck]);

  const [dragState, setDragState] = useState<DragState | null>(null);

  // Files/ranks based on orientation
  const displayFiles = orientation === 'white' ? FILES : [...FILES].reverse();
  const displayRanks = orientation === 'white' ? RANKS : [...RANKS].reverse();

  const squareSize = size / 8;

  const playSound = useCallback((type: 'move' | 'capture' | 'check' | 'castle') => {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      const freqs = { move: 440, capture: 220, check: 660, castle: 550 };
      osc.frequency.value = freqs[type];
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch { /* ignore */ }
  }, [soundEnabled]);

  const handleSquareClick = useCallback((sq: string) => {
    if (selectedSquare && selectedSquare !== sq && legalMoves.includes(sq)) {
      // Make move
      const uci = `${selectedSquare}${sq}`;
      // Detect promotion (pawn to last rank)
      const piece = chess.get(selectedSquare as Square);
      const toRank = parseInt(sq[1], 10);
      if (piece && piece.type === 'p' && (toRank === 8 || toRank === 1)) {
        // Default to queen promotion
        makeMove(`${uci}q`);
      } else {
        makeMove(uci);
      }
      playSound('move');
      return;
    }
    selectSquare(sq);
  }, [selectedSquare, legalMoves, selectSquare, makeMove, chess, playSound]);

  const handlePieceDragStart = useCallback((e: React.DragEvent, sq: string) => {
    const piece = chess.get(sq as Square);
    if (!piece || piece.color !== chess.turn()) {
      e.preventDefault();
      return;
    }
    selectSquare(sq);
    setDragState({ from: sq, x: e.clientX, y: e.clientY, piece: `${piece.color}${piece.type}` });
    // Hide the drag image (we'll show our own floating piece)
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    e.dataTransfer.setDragImage(img, 0, 0);
    e.dataTransfer.effectAllowed = 'move';
  }, [chess, selectSquare]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragState) {
      setDragState({ ...dragState, x: e.clientX, y: e.clientY });
    }
  }, [dragState]);

  const handleDrop = useCallback((e: React.DragEvent, toSq: string) => {
    e.preventDefault();
    if (!dragState) return;
    const from = dragState.from;
    if (from === toSq) {
      setDragState(null);
      return;
    }
    const piece = chess.get(from as Square);
    const toRank = parseInt(toSq[1], 10);
    if (piece && piece.type === 'p' && (toRank === 8 || toRank === 1)) {
      makeMove(`${from}${toSq}q`);
    } else {
      makeMove(`${from}${toSq}`);
    }
    // Sound
    const isCapture = chess.get(toSq as Square) !== null;
    playSound(isCapture ? 'capture' : 'move');
    setDragState(null);
  }, [dragState, chess, makeMove, playSound]);

  const handleDragEnd = useCallback(() => {
    setDragState(null);
  }, []);

  // Keyboard navigation: arrow keys for prev/next move
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const state = useGameStore.getState();
      if (e.key === 'ArrowLeft') state.navigateToPly(state.currentPly - 1);
      else if (e.key === 'ArrowRight') state.navigateToPly(state.currentPly + 1);
      else if (e.key === 'Home') state.navigateToPly(-1);
      else if (e.key === 'End') state.navigateToPly(state.moveHistory.length - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="relative select-none rounded-lg overflow-hidden shadow-2xl"
      style={{ width: size, height: size }}
      onDragOver={handleDragOver}
    >
      {/* Board grid */}
      <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
        {displayRanks.map((rank, rIdx) =>
          displayFiles.map((file, fIdx) => {
            const sq = `${file}${rank}`;
            const isLight = (rIdx + fIdx) % 2 === 0;
            const piece = chess.get(sq as Square);
            const isSelected = selectedSquare === sq;
            const isLegal = legalMoves.includes(sq);
            const isLastMove = lastMove && (lastMove.from === sq || lastMove.to === sq);
            const isCheck = checkSquare === sq;
            const pieceKey = piece ? `${piece.color}${piece.type}` : null;

            return (
              <div
                key={sq}
                className="relative flex items-center justify-center cursor-pointer"
                style={{
                  background: isLight ? LIGHT_BG : DARK_BG,
                  width: squareSize,
                  height: squareSize,
                }}
                onClick={() => handleSquareClick(sq)}
                onDrop={(e) => handleDrop(e, sq)}
                onDragOver={handleDragOver}
              >
                {/* Coordinate labels (corners) */}
                {fIdx === 0 && (
                  <span
                    className="absolute top-0.5 left-1 text-[10px] font-bold pointer-events-none"
                    style={{ color: isLight ? DARK_BG : LIGHT_BG }}
                  >
                    {rank}
                  </span>
                )}
                {rIdx === 7 && (
                  <span
                    className="absolute bottom-0.5 right-1 text-[10px] font-bold pointer-events-none"
                    style={{ color: isLight ? DARK_BG : LIGHT_BG }}
                  >
                    {file}
                  </span>
                )}

                {/* Tints */}
                {isLastMove && (
                  <div className="absolute inset-0 pointer-events-none" style={{ background: LAST_MOVE_TINT }} />
                )}
                {isSelected && (
                  <div className="absolute inset-0 pointer-events-none" style={{ background: SELECTED_TINT }} />
                )}
                {isCheck && (
                  <div className="absolute inset-0 pointer-events-none animate-pulse" style={{ background: CHECK_TINT }} />
                )}

                {/* Piece */}
                {pieceKey && (
                  <div
                    draggable
                    onDragStart={(e) => handlePieceDragStart(e, sq)}
                    onDragEnd={handleDragEnd}
                    className="relative z-10 cursor-grab active:cursor-grabbing"
                    style={{
                      fontSize: squareSize * 0.78,
                      lineHeight: 1,
                      color: piece!.color === 'w' ? '#FFFFFF' : '#1A1A1A',
                      textShadow: piece!.color === 'w'
                        ? '0 1px 2px rgba(0,0,0,0.6), 0 0 1px rgba(0,0,0,0.8)'
                        : '0 1px 2px rgba(255,255,255,0.3)',
                      opacity: dragState?.from === sq ? 0.3 : 1,
                      userSelect: 'none',
                    }}
                  >
                    {PIECE_UNICODE[pieceKey]}
                  </div>
                )}

                {/* Legal move indicators */}
                {isLegal && !piece && (
                  <div
                    className="absolute rounded-full pointer-events-none"
                    style={{
                      width: squareSize * 0.32,
                      height: squareSize * 0.32,
                      background: LEGAL_DOT,
                    }}
                  />
                )}
                {isLegal && piece && (
                  <div
                    className="absolute inset-1 rounded-full pointer-events-none"
                    style={{ border: `4px solid ${LEGAL_CAPTURE_RING}` }}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* SVG Arrow overlay */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        <defs>
          <marker id="arrowhead" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">
            <polygon points="0 0, 4 2, 0 4" fill="currentColor" />
          </marker>
        </defs>
        {activeArrows.map(([from, to, color], i) => {
          const fromCoords = squareToCoords(from, orientation, squareSize);
          const toCoords = squareToCoords(to, orientation, squareSize);
          if (!fromCoords || !toCoords) return null;
          const dx = toCoords.x - fromCoords.x;
          const dy = toCoords.y - fromCoords.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const ux = dx / len, uy = dy / len;
          // Shorten the arrow so the head doesn't cover the piece
          const startPad = squareSize * 0.30;
          const endPad = squareSize * 0.35;
          const x1 = fromCoords.x + ux * startPad;
          const y1 = fromCoords.y + uy * startPad;
          const x2 = toCoords.x - ux * endPad;
          const y2 = toCoords.y - uy * endPad;
          return (
            <line
              key={i}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={color}
              strokeWidth={squareSize * 0.10}
              strokeLinecap="round"
              markerEnd="url(#arrowhead)"
              opacity={0.85}
              style={{ color }}
            />
          );
        })}
      </svg>

      {/* Floating drag piece — rendered via portal-like fixed positioning */}
      {dragState && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: dragState.x - squareSize / 2,
            top: dragState.y - squareSize / 2,
            fontSize: squareSize * 0.78,
            lineHeight: 1,
            color: dragState.piece[0] === 'w' ? '#FFFFFF' : '#1A1A1A',
            textShadow: dragState.piece[0] === 'w'
              ? '0 2px 4px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,1)'
              : '0 2px 4px rgba(255,255,255,0.4)',
          }}
        >
          {PIECE_UNICODE[dragState.piece]}
        </div>
      )}
    </div>
  );
}

function squareToCoords(sq: string, orientation: 'white' | 'black', squareSize: number): { x: number; y: number } | null {
  const file = sq.charCodeAt(0) - 'a'.charCodeAt(0);  // 0..7
  const rank = parseInt(sq[1], 10) - 1;                // 0..7
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  const dispFile = orientation === 'white' ? file : 7 - file;
  const dispRank = orientation === 'white' ? 7 - rank : rank;
  return {
    x: dispFile * squareSize + squareSize / 2,
    y: dispRank * squareSize + squareSize / 2,
  };
}
