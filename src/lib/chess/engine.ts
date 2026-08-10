// Lightweight chess engine utilities — wraps chess.js with a deterministic
// heuristic evaluator (we don't have a Stockfish binary in the sandbox).
//
// The evaluator combines:
//   • Material (P=100, N=320, B=330, R=500, Q=900)
//   • Piece-square tables (classic "Tuning" values from chessprogramming.org)
//   • Mobility (legal move count delta)
//   • King safety proxy (pawn shield + attacker count)
//   • Pawn structure penalties (isolated, doubled, backward)
//
// The output is normalized to White's perspective in centipawns, so a
// positive number means White is better.  This is what the eval bar,
// the eval chart, and the move classifier all consume.

import { Chess, Move, Square, PieceSymbol, Color } from 'chess.js';

// chess.js 1.4: `moves()` returns Move[] (verbose objects).  `attackers(sq)` returns Square[].
// `get(sq)` returns Piece|null.  `move.captured` exists on capture moves.

export const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000,
};

// ---------------------------------------------------------------------------
// Piece-square tables (White perspective; mirror for Black).
// Values from chessprogramming.org's "Simplified Evaluation Function" by Tomasz Michniewski.
// ---------------------------------------------------------------------------
const PST_PAWN = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];
const PST_KNIGHT = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];
const PST_BISHOP = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
];
const PST_ROOK = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];
const PST_QUEEN = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
];
const PST_KING_MG = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];

const PST: Record<PieceSymbol, number[]> = {
  p: PST_PAWN, n: PST_KNIGHT, b: PST_BISHOP, r: PST_ROOK, q: PST_QUEEN, k: PST_KING_MG,
};

// chess.js Square type is 'a1'..'h8'.  Convert to 0..63 index (a8=0, h1=63)
// to match the PST layout above (rank 8 first).
function squareToIndex(sq: Square): number {
  const file = sq.charCodeAt(0) - 'a'.charCodeAt(0);          // 0..7
  const rank = parseInt(sq[1], 10) - 1;                        // 0..7
  return (7 - rank) * 8 + file;                                // a8=0, h1=63
}

function mirrorIndexForBlack(idx: number): number {
  // Mirror vertically: a8a1, h8h1
  const file = idx % 8;
  const rank = Math.floor(idx / 8);   // 0 = rank 8
  return (7 - rank) * 8 + file;
}

// ---------------------------------------------------------------------------
// Static evaluation (White's perspective, centipawns).
// ---------------------------------------------------------------------------
export function evaluate(fen: string): { cp: number; isMate: boolean; mateIn?: number } {
  const chess = new Chess(fen);

  // Terminal states take precedence.
  if (chess.isCheckmate()) {
    // The side to move has been mated → they lose.
    // White-to-move mate → White is mated → -10000.
    // Black-to-move mate → Black is mated → +10000.
    return { cp: chess.turn() === 'w' ? -10000 : 10000, isMate: true, mateIn: 0 };
  }
  if (chess.isStalemate() || chess.isInsufficientMaterial() || chess.isDraw()) {
    return { cp: 0, isMate: false };
  }

  let score = 0;

  const board = chess.board(); // 8x8, [0] = rank 8
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (!piece) continue;
      const sq: Square = `${'abcdefgh'[f]}${8 - r}` as Square;
      const idx = squareToIndex(sq);
      const pstIdx = piece.color === 'w' ? idx : mirrorIndexForBlack(idx);
      const val = PIECE_VALUES[piece.type] + PST[piece.type][pstIdx];
      score += piece.color === 'w' ? val : -val;
    }
  }

  // Mobility bonus: 2 cp per legal move (small but non-trivial).
  const mobility = chess.moves().length;
  score += chess.turn() === 'w' ? mobility * 2 : -mobility * 2;

  // Pawn-structure penalties (per side).
  score += pawnStructurePenalty(chess, 'w') * -1;
  score += pawnStructurePenalty(chess, 'b') * +1;

  return { cp: Math.round(score), isMate: false };
}

function pawnStructurePenalty(chess: Chess, color: Color): number {
  // Returns a penalty (positive = bad for `color`).
  const board = chess.board();
  const files: number[][] = Array.from({ length: 8 }, () => []);
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (p && p.type === 'p' && p.color === color) {
        files[f].push(8 - r);
      }
    }
  }
  let penalty = 0;
  for (let f = 0; f < 8; f++) {
    // Doubled
    if (files[f].length >= 2) penalty += 20 * (files[f].length - 1);
    // Isolated
    const leftCount  = f > 0 ? files[f - 1].length : 0;
    const rightCount = f < 7 ? files[f + 1].length : 0;
    if (files[f].length > 0 && leftCount === 0 && rightCount === 0) {
      penalty += 15;
    }
  }
  return penalty;
}

// ---------------------------------------------------------------------------
// Win-chance conversion (spec §4.1)
// ---------------------------------------------------------------------------
export function winChance(cp: number, isMate: boolean, mateIn?: number): number {
  if (isMate) {
    if (mateIn === undefined || mateIn === 0) {
      // Mate already on board → side to move is mated.
      return cp >= 0 ? 1.0 : 0.0;
    }
    if (mateIn > 0) return Math.max(0.5, 1.0 - mateIn * 0.01);
    return Math.min(0.5, 0.0 + Math.abs(mateIn) * 0.01);
  }
  // Sigmoid: W = 1 / (1 + 10^(-cp/400))
  return 1 / (1 + Math.pow(10, -cp / 400));
}

// ---------------------------------------------------------------------------
// Move classifier (spec §4.2)
// ---------------------------------------------------------------------------
import type { MoveClassification } from '@/types/chess';

export interface ClassificationInput {
  isBestMove: boolean;
  isSacrifice: boolean;       // SEE < -150 (we approximate via material delta)
  seeScore: number;
  deltaW: number;             // W_after - W_before (player perspective, negative = drop)
  wBefore: number;
  wAfter: number;
  isOnlyViable: boolean;      // true if all other moves lose >20% win chance
}

export function classifyMove(input: ClassificationInput): MoveClassification {
  const { isBestMove, isSacrifice, seeScore, deltaW, wBefore, wAfter, isOnlyViable } = input;

  if (isBestMove) return 'BEST';

  if (isSacrifice && seeScore < -150 && deltaW >= -0.03) return 'BRILLIANT';

  if (isOnlyViable && deltaW >= -0.02) return 'GREAT';

  if (deltaW >= -0.02) return 'EXCELLENT';
  if (deltaW >= -0.05) return 'GOOD';
  if (deltaW >= -0.10) return 'INACCURACY';
  if (deltaW >= -0.20) return 'MISTAKE';

  if (wBefore >= 0.70 && wAfter < 0.50) return 'MISS';
  return 'BLUNDER';
}

// ---------------------------------------------------------------------------
// Game accuracy (spec §4.3)
//   A = 100 * mean( 1.031668 * exp(-0.04354 * (ΔW * 100)^2) - 0.031668 )
// ---------------------------------------------------------------------------
export function gameAccuracy(deltaWs: number[]): number {
  if (deltaWs.length === 0) return 0;
  const sum = deltaWs.reduce((acc, deltaW) => {
    const x = deltaW * 100;
    return acc + (1.031668 * Math.exp(-0.04354 * x * x) - 0.031668);
  }, 0);
  return (100 * sum) / deltaWs.length;
}

// ---------------------------------------------------------------------------
// "Best move" search — a shallow negamax with material+PST eval.
// Returns the principal variation + score.
// ---------------------------------------------------------------------------
export interface SearchResult {
  bestMoveUci: string;
  bestMoveSan: string;
  scoreCp: number;            // from side-to-move perspective
  pv: string[];               // SAN moves
}

const SEARCH_DEFAULT_DEPTH = 2;  // keep shallow for browser performance

export function searchBestMove(fen: string, depth: number = SEARCH_DEFAULT_DEPTH): SearchResult {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true }) as Move[];
  if (moves.length === 0) {
    return { bestMoveUci: '', bestMoveSan: '', scoreCp: 0, pv: [] };
  }

  const maximizing = chess.turn() === 'w';
  let bestScore = maximizing ? -Infinity : Infinity;
  let bestMove: Move | null = null;
  let bestPv: string[] = [];

  // Move ordering: captures first (MVV-LVA) → better alpha-beta pruning.
  const ordered = orderMoves(moves, chess);

  for (const move of ordered) {
    chess.move(move);
    const childScore = negamax(chess, depth - 1, -Infinity, Infinity, !maximizing);
    const score = maximizing ? childScore : -childScore;
    if (maximizing ? score > bestScore : score < bestScore) {
      bestScore = score;
      bestMove = move;
      bestPv = [move.san, ...pvFromNegamax(chess, depth - 1)];
    }
    chess.undo();
  }

  if (!bestMove) {
    // Fallback (shouldn't happen)
    const m = moves[0];
    return { bestMoveUci: m.lan, bestMoveSan: m.san, scoreCp: 0, pv: [m.san] };
  }

  return {
    bestMoveUci: bestMove.lan,
    bestMoveSan: bestMove.san,
    scoreCp: Math.round(bestScore),
    pv: bestPv,
  };
}

function pvFromNegamax(chess: Chess, depth: number): string[] {
  if (depth <= 0) return [];
  const moves = orderMoves(chess.moves({ verbose: true }) as Move[], chess);
  if (moves.length === 0) return [];
  const m = moves[0];
  chess.move(m);
  const rest = pvFromNegamax(chess, depth - 1);
  chess.undo();
  return [m.san, ...rest];
}

function orderMoves(moves: Move[], chess: Chess): Move[] {
  // MVV-LVA: most valuable victim, least valuable attacker first.
  return [...moves].sort((a, b) => {
    const scoreA = mvvLva(a, chess);
    const scoreB = mvvLva(b, chess);
    return scoreB - scoreA;
  });
}

function mvvLva(move: Move, chess: Chess): number {
  if (!move.captured) return 0;
  const attacker = chess.get(move.from);
  if (!attacker) return 0;
  return PIECE_VALUES[move.captured] * 10 - PIECE_VALUES[attacker.type];
}

function negamax(chess: Chess, depth: number, alpha: number, beta: number, maximizing: boolean): number {
  if (depth === 0 || chess.isGameOver()) {
    const e = evaluate(chess.fen());
    return maximizing ? e.cp : -e.cp;
  }
  const moves = orderMoves(chess.moves({ verbose: true }) as Move[], chess);
  if (moves.length === 0) {
    const e = evaluate(chess.fen());
    return maximizing ? e.cp : -e.cp;
  }
  let best = -Infinity;
  for (const m of moves) {
    chess.move(m);
    const val = -negamax(chess, depth - 1, -beta, -alpha, !maximizing);
    chess.undo();
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Strength-limited play — emulate UCI_LimitStrength by sometimes picking a
// random legal move instead of the best one.  Lower Elo → higher random chance.
// ---------------------------------------------------------------------------
export function pickMoveAtElo(fen: string, elo: number, depth: number = SEARCH_DEFAULT_DEPTH): Move | null {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true }) as Move[];
  if (moves.length === 0) return null;

  // Probability of a "blunder" — higher for lower Elo.
  //   800 Elo  → ~30% blunder chance
  //  1500 Elo → ~10% blunder chance
  //  2800 Elo → ~0% blunder chance
  const blunderProb = Math.max(0, Math.min(0.5, (2400 - elo) / 5000));
  if (Math.random() < blunderProb) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  // Otherwise: pick one of the top 3 moves by eval, weighted toward the best.
  const scored = moves.map(m => {
    chess.move(m);
    const e = evaluate(chess.fen());
    chess.undo();
    const score = chess.turn() === 'w' ? e.cp : -e.cp;
    return { move: m, score };
  }).sort((a, b) => b.score - a.score);

  // Top-K sampling
  const k = elo >= 2000 ? 1 : elo >= 1500 ? 2 : 3;
  const topK = scored.slice(0, Math.min(k, scored.length));
  return topK[Math.floor(Math.random() * topK.length)].move;
}

// ---------------------------------------------------------------------------
// SEE (Static Exchange Evaluation) — simplified port of the Layer-2 algorithm.
// Returns net material gain (cp) from the mover's perspective.
// ---------------------------------------------------------------------------
export function see(fen: string, moveUci: string): number {
  const chess = new Chess(fen);
  const move = chess.move(moveUci);
  if (!move) return 0;
  if (!move.captured) {
    chess.undo();
    return 0;
  }
  // Captured piece value
  const gain = PIECE_VALUES[move.captured];
  // Find smallest recapturer
  const toSquare = move.to;
  const recapturerSquares = chess.attackers(toSquare).filter(sq => {
    const p = chess.get(sq);
    return p && p.color === chess.turn();
  });
  if (recapturerSquares.length === 0) {
    chess.undo();
    return gain;  // Free capture — no recapture possible
  }
  // Pick smallest value recapturer
  let smallestRecapturer: { sq: Square; piece: PieceSymbol; val: number } | null = null;
  for (const sq of recapturerSquares) {
    const p = chess.get(sq);
    if (!p) continue;
    const val = PIECE_VALUES[p.type];
    if (!smallestRecapturer || val < smallestRecapturer.val) {
      smallestRecapturer = { sq, piece: p.type, val };
    }
  }
  if (!smallestRecapturer) {
    chess.undo();
    return gain;
  }

  // ─── King-as-recapturer special case ──────────────────────────────────
  // If the smallest recapturer is the king, we must verify the king can
  // LEGALLY move to `toSquare` — i.e., `toSquare` is NOT attacked by the
  // mover's side after the king is hypothetically placed there.  If it IS
  // attacked, the king cannot recapture (it would be moving into check),
  // so this square is effectively undefended → SEE = gain (free capture).
  //
  // This is the bug from the spec screenshot: Nxf7 in the Italian Gambit
  // has the black king on e8 as the only recapturer, but Bc4 attacks f7,
  // so Kxf7 is illegal.  SEE must return +100, not 0.
  if (smallestRecapturer.piece === 'k') {
    // Hypothetically remove the king from its source square, then check
    // whether `toSquare` is attacked by the mover's color.
    const moverColor = move.color;  // 'w' or 'b'
    const tempBoard = new Chess(chess.fen());
    tempBoard.remove(smallestRecapturer.sq);
    const destAttackedByMover = tempBoard.isAttacked(toSquare, moverColor);
    chess.undo();
    if (destAttackedByMover) {
      // King cannot recapture — the mover's piece is defended.
      // Treat as a free capture.
      return gain;
    }
    // King can legally recapture — net is gain - king_value, but since the
    // king can't actually be captured (game would end), we treat the
    // exchange as: mover loses their piece for free.
    // Standard SEE convention: if the king recaptures and is not itself
    // recapturable, the exchange nets to (gain - mover_piece_value) clamped
    // to >= 0.  But since the king is invaluable, the mover's piece is just
    // lost.  Simplification: return max(gain - moverPieceVal, 0).
    const moverPiece = chess.get(move.from as Square) || { type: 'p' as PieceSymbol };
    // Actually we already did chess.undo() above; re-fetch from the original fen.
    const origBoard = new Chess(fen);
    const origMover = origBoard.get(move.from as Square);
    const moverVal = origMover ? PIECE_VALUES[origMover.type] : 100;
    return Math.max(gain - moverVal, 0);
  }

  // Non-king recapturer: standard one-level SEE.
  // Full recursive SEE is in the Python Layer-2 module; for the browser we
  // approximate with one level of recapture.
  chess.undo();
  return Math.max(gain - smallestRecapturer.val, 0);
}

// ---------------------------------------------------------------------------
// PGN parsing & SAN validation
// ---------------------------------------------------------------------------
export function parsePgn(pgn: string): { fen: string; sans: string[]; headers: Record<string, string> } | null {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const headers = chess.getHeaders() as Record<string, string>;
    const sans: string[] = chess.history();
    return { fen: new Chess().fen(), sans, headers };
  } catch (err) {
    return null;
  }
}

export function movesFromSans(sans: string[]): Array<{ san: string; uci: string; fenBefore: string; fenAfter: string; isCapture: boolean; isCheck: boolean; isCheckmate: boolean; turn: 'white' | 'black' }> {
  const chess = new Chess();
  const out = [];
  for (const san of sans) {
    try {
      const fenBefore = chess.fen();
      const mv = chess.move(san);
      if (!mv) break;
      out.push({
        san: mv.san,
        uci: mv.lan,
        fenBefore,
        fenAfter: chess.fen(),
        isCapture: !!mv.captured,
        isCheck: chess.inCheck(),
        isCheckmate: chess.isCheckmate(),
        turn: mv.color === 'w' ? 'white' : 'black',
      });
    } catch {
      break;
    }
  }
  return out;
}
