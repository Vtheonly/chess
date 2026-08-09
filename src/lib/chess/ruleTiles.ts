// RuleTileSynthesizer — port of the spec's Python `RuleTileSynthesizer` (§3.1).
//
// Takes a ChessMove + Layer-2 strategic features (computed by the engine)
// and produces:
//   • atomicRuleTiles[]      — visual cards for the UI
//   • calculationBreakdown   — exact math (base × phase multiplier = final)
//
// The synthesizer is the SINGLE SOURCE OF TRUTH for which rules fired.
// The LLM is never allowed to invent rule tiles — it only narrates the
// tiles we hand it.  This is the architectural fix for the hallucination
// issue flagged in the spec (LLM claiming "c6 develops the bishop" when
// the symbolic engine proves is_development=false).

import { Chess, Square, PieceSymbol } from 'chess.js';
import type {
  AtomicRuleTile,
  CalculationBreakdown,
  RulePointCalculationItem,
  RuleCategory,
  ImportanceTier,
} from '@/types/chess';
import { evaluate } from './engine';

// ---------------------------------------------------------------------------
// Rule metadata — names, principles, icons (spec §3.1 RULE_METADATA)
// ---------------------------------------------------------------------------
interface RuleMeta {
  name: string;
  category: RuleCategory;
  principle: string;
  baseScoreCp: number;
  tier: ImportanceTier;
}

const RULE_METADATA: Record<string, RuleMeta> = {
  KNIGHT_OUTPOST: {
    name: 'Knight Outpost',
    category: 'piece_activity',
    principle: 'Knights are most dominant when stationed on unchallengeable central outposts in enemy territory.',
    baseScoreCp: 41,
    tier: 'PRIMARY',
  },
  BISHOP_OUTPOST: {
    name: 'Bishop Outpost',
    category: 'piece_activity',
    principle: 'A bishop on an outpost square controls long diagonals without being challenged by enemy pawns.',
    baseScoreCp: 30,
    tier: 'SECONDARY',
  },
  CONCRETE_THREAT: {
    name: 'Concrete Threat Created',
    category: 'tactics',
    principle: 'Attacking enemy pieces forces defensive responses and gains initiative.',
    baseScoreCp: 60,
    tier: 'PRIMARY',
  },
  CENTER_CONTROL: {
    name: 'Center Control',
    category: 'space_center',
    principle: 'Control of central squares (d4, d5, e4, e5) dictates piece mobility across the board.',
    baseScoreCp: 14,
    tier: 'SECONDARY',
  },
  OPEN_FILE: {
    name: 'Open File Control',
    category: 'piece_activity',
    principle: 'Rooks belong on open files where their long-range power is unrestricted.',
    baseScoreCp: 25,
    tier: 'SECONDARY',
  },
  PAWN_ISOLATION: {
    name: 'Isolated Pawn',
    category: 'pawn_structure',
    principle: 'An isolated pawn cannot be defended by other pawns and becomes a long-term weakness.',
    baseScoreCp: -20,
    tier: 'SECONDARY',
  },
  PAWN_DOUBLED: {
    name: 'Doubled Pawns',
    category: 'pawn_structure',
    principle: 'Doubled pawns cannot defend each other and reduce mobility along the file.',
    baseScoreCp: -15,
    tier: 'MINOR',
  },
  PAWN_PASSED: {
    name: 'Passed Pawn',
    category: 'pawn_structure',
    principle: 'A passed pawn has no enemy pawns blocking its advance and is a major endgame asset.',
    baseScoreCp: 35,
    tier: 'PRIMARY',
  },
  KING_EXPOSURE: {
    name: 'King Exposure',
    category: 'king_safety',
    principle: 'A king lacking pawn shield cover is vulnerable to direct piece attacks.',
    baseScoreCp: -45,
    tier: 'PRIMARY',
  },
  KING_ATTACK: {
    name: 'King Zone Attack',
    category: 'king_safety',
    principle: 'Concentrating attackers near the enemy king creates mating threats and forces defensive play.',
    baseScoreCp: 28,
    tier: 'PRIMARY',
  },
  DEVELOPMENT: {
    name: 'Piece Development',
    category: 'piece_activity',
    principle: 'Developing a minor piece from its home rank increases mobility and prepares castling.',
    baseScoreCp: 18,
    tier: 'SECONDARY',
  },
  MATERIAL_GAIN: {
    name: 'Material Won',
    category: 'material',
    principle: 'Winning material is the most concrete advantage — every centipawn counts.',
    baseScoreCp: 0,  // dynamic — set from SEE
    tier: 'PRIMARY',
  },
  MATERIAL_LOSS: {
    name: 'Material Lost',
    category: 'material',
    principle: 'Losing material without compensation is the most direct path to a losing position.',
    baseScoreCp: 0,  // dynamic — set from SEE (negative)
    tier: 'PRIMARY',
  },
  CHECK_DELIVERED: {
    name: 'Check Delivered',
    category: 'tactics',
    principle: 'Giving check forces the opponent to respond immediately, gaining a tempo.',
    baseScoreCp: 12,
    tier: 'SECONDARY',
  },
  MOBILITY_GAIN: {
    name: 'Mobility Gain',
    category: 'piece_activity',
    principle: 'Increasing the number of legal move options improves flexibility and piece coordination.',
    baseScoreCp: 10,
    tier: 'MINOR',
  },
};

// ---------------------------------------------------------------------------
// Phase calculation (Stockfish-style)
//   • Phase = 1.0  → pure middlegame (all pieces on board)
//   • Phase = 0.0  → pure endgame (only kings + pawns)
//   We use the standard Stockfish phase weights: N=1, B=1, R=2, Q=4, total=24.
// ---------------------------------------------------------------------------
const PHASE_WEIGHTS: Record<string, number> = { n: 1, b: 1, r: 2, q: 4 };
const TOTAL_PHASE = 24;

export function computeGamePhase(fen: string): number {
  const board = fen.split(' ')[0];
  let nonPawnMaterial = 0;
  for (const ch of board) {
    const lower = ch.toLowerCase();
    if (PHASE_WEIGHTS[lower]) nonPawnMaterial += PHASE_WEIGHTS[lower];
  }
  // Clamp: 0 → endgame (0.0), 24 → middlegame (1.0)
  return Math.min(1.0, nonPawnMaterial / TOTAL_PHASE);
}

// ---------------------------------------------------------------------------
// Outpost detection (ported from Python Layer-2)
// ---------------------------------------------------------------------------
function isOutpostSquare(board: Chess, square: Square, color: 'w' | 'b'): boolean {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);  // 0..7
  const rank = parseInt(square[1], 10) - 1;                // 0..7

  // Rank restrictions
  const rankLo = color === 'w' ? 3 : 2;
  const rankHi = color === 'w' ? 5 : 4;
  if (rank < rankLo || rank > rankHi) return false;

  // Friendly pawn support
  const attackers = board.attackers(color, square);
  let hasPawnSupport = false;
  for (const sq of attackers) {
    const p = board.get(sq);
    if (p && p.type === 'p' && p.color === color) {
      hasPawnSupport = true;
      break;
    }
  }
  if (!hasPawnSupport) return false;

  // No enemy pawn can attack this square (current or future)
  const enemyColor = color === 'w' ? 'b' : 'w';
  const enemyPawns = board.findPiece({ type: 'p', color: enemyColor as any });
  for (const psq of enemyPawns) {
    const pFile = psq.charCodeAt(0) - 'a'.charCodeAt(0);
    if (Math.abs(pFile - file) !== 1) continue;
    const pRank = parseInt(psq[1], 10) - 1;
    if (color === 'w' && pRank >= rank) return false;
    if (color === 'b' && pRank <= rank) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Pawn structure helpers (lightweight — for tile generation only)
// ---------------------------------------------------------------------------
function pawnStructureCounts(fen: string, color: 'w' | 'b') {
  const board = new Chess(fen);
  const files: number[][] = Array.from({ length: 8 }, () => []);
  const pawns = board.findPiece({ type: 'p', color: color as any });
  for (const sq of pawns) {
    const file = sq.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = parseInt(sq[1], 10) - 1;
    files[file].push(rank);
  }
  let isolated = 0, doubled = 0, passed = 0;
  for (let f = 0; f < 8; f++) {
    if (files[f].length === 0) continue;
    if (files[f].length >= 2) doubled += files[f].length - 1;
    const left = f > 0 ? files[f - 1].length : 0;
    const right = f < 7 ? files[f + 1].length : 0;
    if (left === 0 && right === 0) isolated++;
    // Passed: no enemy pawn on same or adjacent files ahead
    const enemyColor = color === 'w' ? 'b' : 'w';
    const enemyPawns = board.findPiece({ type: 'p', color: enemyColor as any });
    for (const r of files[f]) {
      const isPassed = !enemyPawns.some(esq => {
        const ef = esq.charCodeAt(0) - 'a'.charCodeAt(0);
        const er = parseInt(esq[1], 10) - 1;
        if (Math.abs(ef - f) > 1) return false;
        return color === 'w' ? er > r : er < r;
      });
      if (isPassed) passed++;
    }
  }
  return { isolated, doubled, passed };
}

// ---------------------------------------------------------------------------
// Synthesizer input — everything needed to generate tiles for one move
// ---------------------------------------------------------------------------
export interface SynthesizerInput {
  fenBefore: string;
  fenAfter: string;
  moveUci: string;
  moveSan: string;
  playerColor: 'white' | 'black';
  seeScore: number;
  isCapture: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
  capturedPiece?: string;  // 'p', 'n', 'b', 'r', 'q'
  concreteThreats: Array<{ san: string; gainCp: number; target: string; piece: string }>;
  evalBeforeCp: number;
  evalAfterCp: number;
  bestMoveSan?: string;
}

// ---------------------------------------------------------------------------
// Main synthesizer — generates tiles + breakdown
// ---------------------------------------------------------------------------
export function generateTilesAndCalc(input: SynthesizerInput): {
  tiles: AtomicRuleTile[];
  breakdown: CalculationBreakdown;
} {
  const tiles: AtomicRuleTile[] = [];
  const calcItems: RulePointCalculationItem[] = [];
  const phase = computeGamePhase(input.fenAfter);

  const boardBefore = new Chess(input.fenBefore);
  const boardAfter = new Chess(input.fenAfter);
  const moverColor: 'w' | 'b' = input.playerColor === 'white' ? 'w' : 'b';
  const fromSquare = input.moveUci.slice(0, 2);
  const toSquare = input.moveUci.slice(2, 4);

  // ── Material tile (always first if capture) ──────────────────────────────
  if (input.isCapture && input.capturedPiece) {
    const pieceValues: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900 };
    const capturedValue = pieceValues[input.capturedPiece] || 0;
    const seeNet = input.seeScore;  // net gain (positive = won material)

    if (Math.abs(seeNet) >= 50) {
      const ruleId = seeNet > 0 ? 'MATERIAL_GAIN' : 'MATERIAL_LOSS';
      const meta = RULE_METADATA[ruleId];
      const baseScore = Math.abs(seeNet);
      const finalScore = Math.round(baseScore * phase);
      tiles.push({
        ruleId,
        ruleName: seeNet > 0 ? `Won ${input.capturedPiece.toUpperCase()} piece` : `Lost material (${seeNet}cp)`,
        category: meta.category,
        rawDeltaCp: baseScore,
        weightedPointsCp: seeNet > 0 ? finalScore : -finalScore,
        principleSummary: meta.principle,
        highlightSquares: [toSquare],
        arrowVectors: [[fromSquare, toSquare, 'rgba(167, 139, 250, 0.85)']],
        importanceTier: meta.tier,
      });
      calcItems.push({
        ruleName: seeNet > 0 ? 'Material Won' : 'Material Lost',
        baseScoreCp: baseScore,
        phaseWeightMultiplier: phase,
        finalPointsCp: seeNet > 0 ? finalScore : -finalScore,
      });
    }
  }

  // ── Outpost tile (knight or bishop on outpost square) ─────────────────────
  const movedPiece = boardAfter.get(toSquare as Square);
  if (movedPiece && (movedPiece.type === 'n' || movedPiece.type === 'b') && movedPiece.color === moverColor) {
    if (isOutpostSquare(boardAfter, toSquare as Square, moverColor)) {
      const ruleId = movedPiece.type === 'n' ? 'KNIGHT_OUTPOST' : 'BISHOP_OUTPOST';
      const meta = RULE_METADATA[ruleId];
      const finalCp = Math.round(meta.baseScoreCp * phase);
      tiles.push({
        ruleId,
        ruleName: meta.name,
        category: meta.category,
        rawDeltaCp: meta.baseScoreCp,
        weightedPointsCp: finalCp,
        principleSummary: meta.principle,
        highlightSquares: [toSquare],
        arrowVectors: [[fromSquare, toSquare, 'rgba(96, 165, 250, 0.85)']],
        importanceTier: meta.tier,
      });
      calcItems.push({
        ruleName: meta.name,
        baseScoreCp: meta.baseScoreCp,
        phaseWeightMultiplier: phase,
        finalPointsCp: finalCp,
      });
    }
  }

  // ── Concrete threat tile ─────────────────────────────────────────────────
  if (input.concreteThreats.length > 0) {
    const top = input.concreteThreats[0];
    const meta = RULE_METADATA.CONCRETE_THREAT;
    const baseScore = Math.max(top.gainCp, 30);  // floor for visibility
    const finalScore = Math.round(baseScore * phase);
    tiles.push({
      ruleId: 'CONCRETE_THREAT',
      ruleName: `Threat on ${top.piece.toUpperCase()}${top.target ? ` at ${top.target}` : ''}`,
      category: meta.category,
      rawDeltaCp: baseScore,
      weightedPointsCp: finalScore,
      principleSummary: meta.principle,
      highlightSquares: [top.target],
      arrowVectors: [[toSquare, top.target, 'rgba(248, 113, 113, 0.85)']],
      importanceTier: meta.tier,
    });
    calcItems.push({
      ruleName: `Threat on ${top.piece.toUpperCase()}`,
      baseScoreCp: baseScore,
      phaseWeightMultiplier: phase,
      finalPointsCp: finalScore,
    });
  }

  // ── Center control tile ──────────────────────────────────────────────────
  const centerSquares: Square[] = ['d4', 'd5', 'e4', 'e5'] as Square[];
  const beforeCount = centerSquares.filter(sq => boardBefore.isAttacked(sq, moverColor)).length;
  const afterCount = centerSquares.filter(sq => boardAfter.isAttacked(sq, moverColor)).length;
  const centerDelta = afterCount - beforeCount;
  if (Math.abs(centerDelta) >= 1) {
    const meta = RULE_METADATA.CENTER_CONTROL;
    const baseScore = meta.baseScoreCp * centerDelta;
    const finalScore = Math.round(baseScore * phase);
    tiles.push({
      ruleId: 'CENTER_CONTROL',
      ruleName: meta.name,
      category: meta.category,
      rawDeltaCp: baseScore,
      weightedPointsCp: finalScore,
      principleSummary: meta.principle,
      highlightSquares: centerSquares.filter(sq => boardAfter.isAttacked(sq, moverColor)).map(s => s as string),
      arrowVectors: centerDelta > 0
        ? [[fromSquare, toSquare, 'rgba(52, 211, 153, 0.85)']]
        : [],
      importanceTier: meta.tier,
    });
    calcItems.push({
      ruleName: meta.name,
      baseScoreCp: baseScore,
      phaseWeightMultiplier: phase,
      finalPointsCp: finalScore,
    });
  }

  // ── Open file tile (rook or queen on open file) ──────────────────────────
  if (movedPiece && (movedPiece.type === 'r' || movedPiece.type === 'q')) {
    const file = toSquare.charCodeAt(0) - 'a'.charCodeAt(0);
    const filePawns = boardAfter.findPiece({ type: 'p', color: moverColor as any })
      .filter(sq => sq.charCodeAt(0) - 'a'.charCodeAt(0) === file);
    const enemyFilePawns = boardAfter.findPiece({ type: 'p', color: (moverColor === 'w' ? 'b' : 'w') as any })
      .filter(sq => sq.charCodeAt(0) - 'a'.charCodeAt(0) === file);
    if (filePawns.length === 0 && enemyFilePawns.length === 0) {
      const meta = RULE_METADATA.OPEN_FILE;
      const finalScore = Math.round(meta.baseScoreCp * phase);
      tiles.push({
        ruleId: 'OPEN_FILE',
        ruleName: meta.name,
        category: meta.category,
        rawDeltaCp: meta.baseScoreCp,
        weightedPointsCp: finalScore,
        principleSummary: meta.principle,
        highlightSquares: [toSquare],
        arrowVectors: [[fromSquare, toSquare, 'rgba(96, 165, 250, 0.85)']],
        importanceTier: meta.tier,
      });
      calcItems.push({
        ruleName: meta.name,
        baseScoreCp: meta.baseScoreCp,
        phaseWeightMultiplier: phase,
        finalPointsCp: finalScore,
      });
    }
  }

  // ── Development tile (minor piece off home rank) ─────────────────────────
  if (movedPiece && (movedPiece.type === 'n' || movedPiece.type === 'b')) {
    const homeRank = moverColor === 'w' ? 1 : 8;
    const fromRank = parseInt(fromSquare[1], 10);
    if (fromRank === homeRank) {
      const meta = RULE_METADATA.DEVELOPMENT;
      const finalScore = Math.round(meta.baseScoreCp * phase);
      tiles.push({
        ruleId: 'DEVELOPMENT',
        ruleName: meta.name,
        category: meta.category,
        rawDeltaCp: meta.baseScoreCp,
        weightedPointsCp: finalScore,
        principleSummary: meta.principle,
        highlightSquares: [toSquare],
        arrowVectors: [[fromSquare, toSquare, 'rgba(96, 165, 250, 0.85)']],
        importanceTier: meta.tier,
      });
      calcItems.push({
        ruleName: meta.name,
        baseScoreCp: meta.baseScoreCp,
        phaseWeightMultiplier: phase,
        finalPointsCp: finalScore,
      });
    }
  }

  // ── Check delivered tile ─────────────────────────────────────────────────
  if (input.isCheck && !input.isCheckmate) {
    const meta = RULE_METADATA.CHECK_DELIVERED;
    const finalScore = Math.round(meta.baseScoreCp * phase);
    // Find enemy king square
    const enemyColor = moverColor === 'w' ? 'b' : 'w';
    const enemyKing = boardAfter.findPiece({ type: 'k', color: enemyColor as any })[0];
    tiles.push({
      ruleId: 'CHECK_DELIVERED',
      ruleName: meta.name,
      category: meta.category,
      rawDeltaCp: meta.baseScoreCp,
      weightedPointsCp: finalScore,
      principleSummary: meta.principle,
      highlightSquares: enemyKing ? [enemyKing] : [toSquare],
      arrowVectors: [[fromSquare, toSquare, 'rgba(248, 113, 113, 0.85)']],
      importanceTier: meta.tier,
    });
    calcItems.push({
      ruleName: meta.name,
      baseScoreCp: meta.baseScoreCp,
      phaseWeightMultiplier: phase,
      finalPointsCp: finalScore,
    });
  }

  // ── King-zone attack tile (gain in king-zone attackers) ──────────────────
  const enemyColor = moverColor === 'w' ? 'b' : 'w';
  const enemyKingBefore = boardBefore.findPiece({ type: 'k', color: enemyColor as any })[0];
  const enemyKingAfter = boardAfter.findPiece({ type: 'k', color: enemyColor as any })[0];
  if (enemyKingAfter) {
    const kingZoneAfter = computeKingZone(enemyKingAfter);
    const attackersBefore = kingZoneAfter.filter(sq => boardBefore.isAttacked(sq as Square, moverColor)).length;
    const attackersAfter = kingZoneAfter.filter(sq => boardAfter.isAttacked(sq as Square, moverColor)).length;
    const attackerDelta = attackersAfter - attackersBefore;
    if (attackerDelta >= 2) {
      const meta = RULE_METADATA.KING_ATTACK;
      const baseScore = meta.baseScoreCp * attackerDelta;
      const finalScore = Math.round(baseScore * phase);
      tiles.push({
        ruleId: 'KING_ATTACK',
        ruleName: meta.name,
        category: meta.category,
        rawDeltaCp: baseScore,
        weightedPointsCp: finalScore,
        principleSummary: meta.principle,
        highlightSquares: kingZoneAfter.slice(0, 4),
        arrowVectors: [[toSquare, enemyKingAfter, 'rgba(251, 113, 133, 0.85)']],
        importanceTier: meta.tier,
      });
      calcItems.push({
        ruleName: meta.name,
        baseScoreCp: baseScore,
        phaseWeightMultiplier: phase,
        finalPointsCp: finalScore,
      });
    }
  }

  // ── Pawn structure tiles (isolated, doubled, passed) ─────────────────────
  const structAfter = pawnStructureCounts(input.fenAfter, moverColor);
  const structBefore = pawnStructureCounts(input.fenBefore, moverColor);

  if (structAfter.isolated > structBefore.isolated) {
    const meta = RULE_METADATA.PAWN_ISOLATION;
    const baseScore = meta.baseScoreCp * (structAfter.isolated - structBefore.isolated);
    const finalScore = Math.round(baseScore * phase);
    // Find the isolated pawn square (approximation: the file)
    tiles.push({
      ruleId: 'PAWN_ISOLATION',
      ruleName: meta.name,
      category: meta.category,
      rawDeltaCp: baseScore,
      weightedPointsCp: finalScore,
      principleSummary: meta.principle,
      highlightSquares: [toSquare],
      arrowVectors: [],
      importanceTier: meta.tier,
    });
    calcItems.push({
      ruleName: meta.name,
      baseScoreCp: baseScore,
      phaseWeightMultiplier: phase,
      finalPointsCp: finalScore,
    });
  }

  if (structAfter.passed > structBefore.passed) {
    const meta = RULE_METADATA.PAWN_PASSED;
    const baseScore = meta.baseScoreCp * (structAfter.passed - structBefore.passed);
    const finalScore = Math.round(baseScore * phase);
    tiles.push({
      ruleId: 'PAWN_PASSED',
      ruleName: meta.name,
      category: meta.category,
      rawDeltaCp: baseScore,
      weightedPointsCp: finalScore,
      principleSummary: meta.principle,
      highlightSquares: [toSquare],
      arrowVectors: [[fromSquare, toSquare, 'rgba(251, 191, 36, 0.85)']],
      importanceTier: meta.tier,
    });
    calcItems.push({
      ruleName: meta.name,
      baseScoreCp: baseScore,
      phaseWeightMultiplier: phase,
      finalPointsCp: finalScore,
    });
  }

  // ── Mobility tile (if delta is significant) ──────────────────────────────
  const mobilityBefore = boardBefore.moves().length;
  const mobilityAfter = (() => {
    // Mover's mobility after their own move = count moves they'd have if it were still their turn.
    // We approximate by toggling side via FEN.
    try {
      const fenParts = input.fenAfter.split(' ');
      fenParts[1] = fenParts[1] === 'w' ? 'b' : 'w';
      fenParts[3] = '-';
      const tmp = new Chess();
      tmp.load(fenParts.join(' '));
      return tmp.moves().length;
    } catch {
      return boardAfter.moves().length;
    }
  })();
  const mobilityDelta = mobilityAfter - mobilityBefore;
  if (mobilityDelta >= 5) {
    const meta = RULE_METADATA.MOBILITY_GAIN;
    const baseScore = Math.min(20, mobilityDelta);  // cap
    const finalScore = Math.round(baseScore * phase);
    tiles.push({
      ruleId: 'MOBILITY_GAIN',
      ruleName: meta.name,
      category: meta.category,
      rawDeltaCp: baseScore,
      weightedPointsCp: finalScore,
      principleSummary: `${meta.principle} (+${mobilityDelta} legal moves)`,
      highlightSquares: [toSquare],
      arrowVectors: [],
      importanceTier: meta.tier,
    });
    calcItems.push({
      ruleName: meta.name,
      baseScoreCp: baseScore,
      phaseWeightMultiplier: phase,
      finalPointsCp: finalScore,
    });
  }

  // ── Build the calculation breakdown ──────────────────────────────────────
  const whitePositivePoints = calcItems
    .filter(i => i.finalPointsCp > 0)
    .reduce((s, i) => s + i.finalPointsCp, 0);
  const blackPositivePoints = calcItems
    .filter(i => i.finalPointsCp < 0)
    .reduce((s, i) => s + Math.abs(i.finalPointsCp), 0);

  const breakdown: CalculationBreakdown = {
    startEvalCp: input.evalBeforeCp,
    endEvalCp: input.evalAfterCp,
    netChangeCp: input.evalAfterCp - input.evalBeforeCp,
    gamePhaseFactor: phase,
    whitePositivePoints,
    blackPositivePoints,
    ruleCalculations: calcItems,
  };

  return { tiles, breakdown };
}

// ---------------------------------------------------------------------------
// King zone helper (3×3 around king)
// ---------------------------------------------------------------------------
function computeKingZone(kingSquare: string): string[] {
  const file = kingSquare.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = parseInt(kingSquare[1], 10) - 1;
  const out: string[] = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      const f = file + df, r = rank + dr;
      if (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
        out.push(`${'abcdefgh'[f]}${r + 1}`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anti-hallucination filter — verifies the LLM's text doesn't claim things
// the symbolic engine proved false.  Specifically guards against the bug
// documented in the spec: LLM claiming "c6 develops the bishop" when the
// engine proved is_development=false.
// ---------------------------------------------------------------------------
export interface HallucinationCheckResult {
  passed: boolean;
  violations: string[];
}

// ---------------------------------------------------------------------------
// ALLOWLIST of strategic concepts the LLM may mention.
// Each entry maps a regex (concept detection) → required tile ID(s).
// If the LLM mentions the concept but no matching tile fired → VIOLATION.
//
// This is the architectural fix for the "6-rule denylist" gap: instead of
// listing every possible lie, we list every possible truth and reject
// anything that doesn't map to a verified tile.
// ---------------------------------------------------------------------------
interface ConceptRule {
  concept: string;                          // human-readable name
  pattern: RegExp;                          // detects the concept in LLM text
  requiredTileIds: string[];                // any of these tiles must be present
  explanation: string;                      // why it's a violation if missing
}

const STRATEGIC_CONCEPT_ALLOWLIST: ConceptRule[] = [
  {
    concept: 'piece development',
    pattern: /\b(develop(?:s|ing|ment)?|brings?\s+(?:out|into\s+play)|undevelope)\b/i,
    requiredTileIds: ['DEVELOPMENT'],
    explanation: 'Piece development requires a minor piece (knight or bishop) to move from its home rank. Pawn moves like c6, d5, e6 do NOT develop pieces.',
  },
  {
    concept: 'outpost',
    pattern: /\boutpost\b/i,
    requiredTileIds: ['KNIGHT_OUTPOST', 'BISHOP_OUTPOST'],
    explanation: 'An outpost requires the destination square to be (a) on ranks 4-6 for White / 3-5 for Black, (b) defended by a friendly pawn, and (c) unchallengeable by any enemy pawn on adjacent files.',
  },
  {
    concept: 'open file',
    pattern: /\bopen\s+file\b|\bsemi-?open\s+file\b/i,
    requiredTileIds: ['OPEN_FILE'],
    explanation: 'An open file requires the destination file to contain zero pawns of either color, with a rook or queen occupying it.',
  },
  {
    concept: 'sacrifice',
    pattern: /\bsacrifice(?:s|d)?\b|\bgambit\b|\bgives?\s+up\s+(?:material|a\s+(?:pawn|piece))\b/i,
    requiredTileIds: ['MATERIAL_LOSS'],
    explanation: `A sacrifice requires SEE ≤ -150cp (real material given up). Current SEE = SEE_PLACEHOLDERcp.`,
  },
  {
    concept: 'winning material',
    pattern: /\bwins?\s+(?:material|a\s+(?:pawn|piece|knight|bishop|rook|queen))\b|\bcaptures?\s+(?:and\s+)?wins\b|\bgains?\s+(?:material|a\s+(?:pawn|piece))\b/i,
    requiredTileIds: ['MATERIAL_GAIN'],
    explanation: `Winning material requires SEE > 0cp. Current SEE = SEE_PLACEHOLDERcp.`,
  },
  {
    concept: 'passed pawn',
    pattern: /\bpassed\s+pawn\b/i,
    requiredTileIds: ['PAWN_PASSED'],
    explanation: 'A passed pawn requires no enemy pawns on the same file or adjacent files ahead of it.',
  },
  {
    concept: 'isolated pawn',
    pattern: /\bisolat(?:e|ed|ion)\b/i,
    requiredTileIds: ['PAWN_ISOLATION'],
    explanation: 'An isolated pawn has no friendly pawns on either adjacent file.',
  },
  {
    concept: 'doubled pawns',
    pattern: /\bdoubl(?:e|ed|ing)\s+pawns?\b/i,
    requiredTileIds: ['PAWN_DOUBLED'],
    explanation: 'Doubled pawns require two or more friendly pawns on the same file.',
  },
  {
    concept: 'concrete threat / fork / pin',
    pattern: /\b(threat(?:s|ening)?|fork|pin|double(?:-|\s)attack|hanging|attack(?:s|ing)?\s+(?:the\s+)?(?:queen|rook|bishop|knight|king))\b/i,
    requiredTileIds: ['CONCRETE_THREAT', 'CHECK_DELIVERED'],
    explanation: 'A concrete threat requires a winning capture (SEE ≥ 0) available after a null-move. No such capture was detected.',
  },
  {
    concept: 'king attack / king safety',
    pattern: /\b(king\s+(?:attack|safety|expos(?:e|ure)|vulnerab|weak)|attack(?:s|ing)?\s+(?:the\s+)?king|around\s+the\s+king|mating\s+(?:threat|attack|net))\b/i,
    requiredTileIds: ['KING_ATTACK', 'KING_EXPOSURE', 'CHECK_DELIVERED'],
    explanation: 'A king attack requires the mover to have gained ≥2 attackers in the enemy king zone, OR a king-safety penalty, OR a check.',
  },
  {
    concept: 'center control',
    pattern: /\b(center\s+(?:control|squares|play)|control\s+of\s+(?:the\s+)?center|central\s+(?:control|squares|outpost))\b/i,
    requiredTileIds: ['CENTER_CONTROL'],
    explanation: 'Center control requires a net increase in attacks on d4/d5/e4/e5.',
  },
  {
    concept: 'check',
    // Match "check" / "gives check" / "+" but NOT when preceded by negation ("no check", "without check")
    pattern: /\b(?<!no\s)(?<!without\s)(?<!not\s)check(?:s|ing|mating)?\b|\bgives?\s+check\b|\b\+\s*$/mi,
    requiredTileIds: ['CHECK_DELIVERED'],
    explanation: 'A check requires the move to attack the enemy king.',
  },
  {
    concept: 'mobility / activity',
    pattern: /\b(mobility|active|activat(?:e|es|ing)|piece\s+activity|improves?\s+(?:the\s+)?position)\b/i,
    requiredTileIds: ['MOBILITY_GAIN', 'DEVELOPMENT', 'OPEN_FILE', 'KNIGHT_OUTPOST', 'BISHOP_OUTPOST'],
    explanation: 'Activity claims require a measurable increase: mobility gain ≥5 legal moves, piece development, open file control, or an outpost.',
  },
];

// Concepts that are NOT yet covered by any tile — these are flagged as
// "unverifiable" rather than "false", because we can't prove or disprove
// them with the current symbolic engine.  The LLM should avoid them.
const UNVERIFIABLE_CONCEPTS: ConceptRule[] = [
  {
    concept: 'bishop pair',
    pattern: /\bbishop\s+pair\b|\btwo\s+bishops\b/i,
    requiredTileIds: [],
    explanation: 'The bishop pair advantage is not yet tracked by the symbolic engine. Avoid claiming it.',
  },
  {
    concept: 'luft / king escape square',
    pattern: /\bluft\b|\bking\s+(?:escape|flight)\s+square\b|\bmakes?\s+luft\b/i,
    requiredTileIds: [],
    explanation: 'Luft (creating a king escape square) is not yet tracked. Avoid claiming it.',
  },
  {
    concept: 'prophylaxis',
    pattern: /\bprophylax(?:is|tic)\b|\bprophylactic\b|\bprevent(?:s|ing)\s+(?:the\s+)?(?:opponent|enemy)\b/i,
    requiredTileIds: [],
    explanation: 'Prophylactic moves are not yet symbolically verified. Avoid the term "prophylaxis" unless describing a concrete prevented threat.',
  },
  {
    concept: 'initiative / tempo',
    pattern: /\b(initiative|tempo|gains?\s+(?:a\s+)?tempo|seize(?:s)?\s+the\s+initiative)\b/i,
    requiredTileIds: [],
    explanation: 'Initiative and tempo are not yet symbolically tracked. Avoid these terms.',
  },
  {
    concept: 'space advantage',
    pattern: /\bspace\s+(?:advantage|control|edge|gain)\b|\bmore\s+space\b/i,
    requiredTileIds: [],
    explanation: 'Space advantage is not yet tracked (only center control is). Avoid "space" claims.',
  },
  {
    concept: 'backward pawn',
    pattern: /\bbackward\s+pawn\b/i,
    requiredTileIds: [],
    explanation: 'Backward pawn detection is not yet implemented. Avoid the term.',
  },
  {
    concept: 'trapped piece',
    pattern: /\btrap(?:s|ped|ping)\s+(?:a\s+)?(?:the\s+)?(?:enemy\s+)?(?:piece|knight|bishop|rook|queen)\b|\btrapped\s+(?:piece|knight|bishop|rook|queen)\b/i,
    requiredTileIds: [],
    explanation: 'Trapped piece detection is not yet implemented. Avoid the claim.',
  },
  {
    concept: 'bad bishop',
    pattern: /\bbad\s+bishop\b/i,
    requiredTileIds: [],
    explanation: 'Bad bishop (blocked by own pawns) detection is not yet implemented. Avoid the claim.',
  },
  {
    concept: 'rook lift / rook on the 7th',
    pattern: /\brook\s+(?:lift|on\s+the\s+7th|seventh)|\b7th\s+rank\s+(?:rook|domination)\b/i,
    requiredTileIds: [],
    explanation: 'Rook lift / 7th-rank domination is not yet tracked. Avoid the claim.',
  },
  {
    concept: 'overloaded piece',
    pattern: /\boverload(?:ed|ing)\s+piece\b/i,
    requiredTileIds: [],
    explanation: 'Overloaded piece detection is not yet implemented. Avoid the claim.',
  },
  {
    concept: 'zugzwang',
    pattern: /\bzugzwang\b/i,
    requiredTileIds: [],
    explanation: 'Zugzwang detection is not yet implemented. Avoid the term.',
  },
  {
    concept: 'opposition',
    pattern: /\bopposition\b/i,
    requiredTileIds: [],
    explanation: 'King opposition detection is not yet implemented. Avoid the term.',
  },
];

// ---------------------------------------------------------------------------
// MAIN FILTER — allowlist-based.
//   For every concept the LLM mentions:
//     • If it's in the allowlist → require a matching tile (else violation)
//     • If it's in the unverifiable list → flag as "unverifiable concept"
//     • If no tiles fired at all → restrict LLM to tactical facts only
// ---------------------------------------------------------------------------
export function checkNarrativeAgainstTiles(
  narrative: string,
  tiles: AtomicRuleTile[],
  input: SynthesizerInput,
): HallucinationCheckResult {
  const violations: string[] = [];
  const text = narrative;

  // ─── Empty-tiles fallback ─────────────────────────────────────────────
  // If NO tiles fired, the LLM may only mention tactical facts (eval delta,
  // capture/no-capture, check/mate).  Any strategic claim is a violation.
  if (tiles.length === 0) {
    const strategicClaim = STRATEGIC_CONCEPT_ALLOWLIST.some(rule => rule.pattern.test(text));
    const unverifiableClaim = UNVERIFIABLE_CONCEPTS.some(rule => rule.pattern.test(text));
    if (strategicClaim || unverifiableClaim) {
      // Identify which concepts were mentioned
      const mentioned: string[] = [];
      for (const rule of [...STRATEGIC_CONCEPT_ALLOWLIST, ...UNVERIFIABLE_CONCEPTS]) {
        if (rule.pattern.test(text)) mentioned.push(rule.concept);
      }
      violations.push(
        `No atomic rule tiles fired for this move (it is a quiet move with no detected strategic feature). ` +
        `The LLM mentioned: ${mentioned.join(', ')}. ` +
        `When no tiles fire, commentary must be restricted to tactical facts only (eval change, capture status, check status) — not strategic concepts.`
      );
    }
  }

  // ─── Allowlist enforcement ────────────────────────────────────────────
  for (const rule of STRATEGIC_CONCEPT_ALLOWLIST) {
    if (!rule.pattern.test(text)) continue;
    const hasTile = rule.requiredTileIds.some(id => tiles.some(t => t.ruleId === id));
    if (!hasTile) {
      // Special-case: sacrifice / winning-material use SEE in the explanation
      let explanation = rule.explanation;
      if (explanation.includes('SEE_PLACEHOLDER')) {
        explanation = explanation.replace(/SEE_PLACEHOLDER/g, String(input.seeScore));
      }
      // Special-case: check is allowed if input.isCheck is true (even without tile, e.g. mate)
      if (rule.concept === 'check' && input.isCheck) continue;
      // Special-case: development is allowed if the move actually developed (verify with engine)
      if (rule.concept === 'piece development') {
        const board = new Chess(input.fenBefore);
        const movedPiece = board.get(input.moveUci.slice(0, 2) as Square);
        if (movedPiece && (movedPiece.type === 'n' || movedPiece.type === 'b')) {
          const homeRank = movedPiece.color === 'w' ? 1 : 8;
          const fromRank = parseInt(input.moveUci[1], 10);
          if (fromRank === homeRank) continue;  // actually did develop — don't flag
        }
      }
      violations.push(
        `LLM mentioned "${rule.concept}" but no corresponding tile fired. ${explanation}`
      );
    }
  }

  // ─── Unverifiable concept warning ─────────────────────────────────────
  for (const rule of UNVERIFIABLE_CONCEPTS) {
    if (!rule.pattern.test(text)) continue;
    violations.push(
      `LLM mentioned "${rule.concept}" which is not yet tracked by the symbolic engine. ${rule.explanation}`
    );
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

export { RULE_METADATA };
