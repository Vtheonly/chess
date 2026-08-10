// RuleTileSynthesizer — Generates human, chess-literate rule tiles and exact
// point calculations.
//
// Takes a ChessMove + Layer-2 strategic features (computed by the engine)
// and produces:
//   • atomicRuleTiles[]      — visual cards for the UI
//   • calculationBreakdown   — exact math (base × phase multiplier = final)
//
// The synthesizer is the SINGLE SOURCE OF TRUTH for which rules fired.
// The LLM is never allowed to invent rule tiles — it only narrates the
// tiles we hand it.

import { Chess, Square, PieceSymbol } from 'chess.js';
import type {
  AtomicRuleTile,
  CalculationBreakdown,
  RulePointCalculationItem,
  RuleCategory,
  ImportanceTier,
} from '@/types/chess';
import { evaluate } from './engine';

// Re-export so consumers can `import { type AtomicRuleTile } from './ruleTiles'`
// without needing to know we route it through @/types/chess.
export type { AtomicRuleTile } from '@/types/chess';

// ---------------------------------------------------------------------------
// Rule metadata — names, principles, icons
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
    principle: 'Posts a knight on an advanced, defended square where enemy pawns cannot challenge it.',
    baseScoreCp: 41,
    tier: 'PRIMARY',
  },
  BISHOP_OUTPOST: {
    name: 'Bishop Outpost',
    category: 'piece_activity',
    principle: 'Anchors a bishop on an advanced square to dominate long diagonals.',
    baseScoreCp: 30,
    tier: 'SECONDARY',
  },
  CONCRETE_THREAT: {
    name: 'Tactical Attack',
    category: 'tactics',
    principle: 'Creates an immediate threat against an undefended or high-value enemy target.',
    baseScoreCp: 60,
    tier: 'PRIMARY',
  },
  CENTER_CONTROL: {
    name: 'Central Control',
    category: 'space_center',
    principle: 'Increases pressure and attack coverage on the key central squares (d4, d5, e4, e5).',
    baseScoreCp: 14,
    tier: 'SECONDARY',
  },
  OPEN_FILE: {
    name: 'Open File Control',
    category: 'piece_activity',
    principle: 'Claims an open file with a rook or queen to infiltrate the opponent\'s camp.',
    baseScoreCp: 25,
    tier: 'SECONDARY',
  },
  PAWN_ISOLATION: {
    name: 'Isolated Pawn Weakness',
    category: 'pawn_structure',
    principle: 'Creates an isolated pawn that lacks adjacent pawn support.',
    baseScoreCp: -20,
    tier: 'SECONDARY',
  },
  PAWN_DOUBLED: {
    name: 'Doubled Pawns',
    category: 'pawn_structure',
    principle: 'Stacks pawns on the same file, reducing their mobility and defensive synergy.',
    baseScoreCp: -15,
    tier: 'MINOR',
  },
  PAWN_PASSED: {
    name: 'Passed Pawn Advanced',
    category: 'pawn_structure',
    principle: 'Advances a passed pawn with no opposing pawns in front to block its promotion path.',
    baseScoreCp: 35,
    tier: 'PRIMARY',
  },
  KING_EXPOSURE: {
    name: 'King Exposure',
    category: 'king_safety',
    principle: 'Exposes the king by weakening or stripping away its pawn cover.',
    baseScoreCp: -45,
    tier: 'PRIMARY',
  },
  KING_ATTACK: {
    name: 'King Zone Attack',
    category: 'king_safety',
    principle: 'Brings attacking forces near the enemy king to build mating threats.',
    baseScoreCp: 28,
    tier: 'PRIMARY',
  },
  DEVELOPMENT: {
    name: 'Piece Development',
    category: 'piece_activity',
    principle: 'Develops a minor piece from its starting square into active play.',
    baseScoreCp: 18,
    tier: 'SECONDARY',
  },
  MATERIAL_GAIN: {
    name: 'Material Won',
    category: 'material',
    principle: 'Wins material cleanly, creating a permanent piece or pawn advantage.',
    baseScoreCp: 0,
    tier: 'PRIMARY',
  },
  MATERIAL_LOSS: {
    name: 'Material Lost',
    category: 'material',
    principle: 'Gives up material, requiring tactical compensation to stay equal.',
    baseScoreCp: 0,
    tier: 'PRIMARY',
  },
  CHECK_DELIVERED: {
    name: 'Check Delivered',
    category: 'tactics',
    principle: 'Gives check to the enemy king, seizing the initiative and forcing an escape move.',
    baseScoreCp: 12,
    tier: 'SECONDARY',
  },
  MOBILITY_GAIN: {
    name: 'Mobility Gain',
    category: 'piece_activity',
    principle: 'Opens up new squares and lines for your pieces.',
    baseScoreCp: 10,
    tier: 'MINOR',
  },
  BAD_BISHOP: {
    name: 'Bad Bishop Freed',
    category: 'piece_activity',
    principle: 'Frees a restricted bishop from behind its own fixed pawns.',
    baseScoreCp: 35,
    tier: 'SECONDARY',
  },
  ROOK_ON_7TH: {
    name: 'Rook on 7th Rank',
    category: 'piece_activity',
    principle: 'Infiltrates the 7th rank with a rook, attacking pawns and confining the king.',
    baseScoreCp: 45,
    tier: 'PRIMARY',
  },
  SEMI_OPEN_FILE: {
    name: 'Semi-Open File Pressure',
    category: 'piece_activity',
    principle: 'Places a rook on a semi-open file to pressure enemy pawns.',
    baseScoreCp: 20,
    tier: 'MINOR',
  },
  BACKWARD_PAWN: {
    name: 'Backward Pawn Created',
    category: 'pawn_structure',
    principle: 'Creates a backward pawn that cannot advance safely.',
    baseScoreCp: -25,
    tier: 'SECONDARY',
  },
  PAWN_SHIELD: {
    name: 'King Protection',
    category: 'king_safety',
    principle: 'Strengthens the pawn barrier protecting the castled king.',
    baseScoreCp: 35,
    tier: 'SECONDARY',
  },
  KING_TROPISM: {
    name: 'King Attack Pressure',
    category: 'king_safety',
    principle: 'Marches attacking pieces closer to the enemy king.',
    baseScoreCp: 30,
    tier: 'PRIMARY',
  },
  SPACE_ADVANTAGE: {
    name: 'Space Control',
    category: 'space_center',
    principle: 'Claims space in enemy territory, cramping opponent piece mobility.',
    baseScoreCp: 25,
    tier: 'MINOR',
  },
  PIN_CREATED: {
    name: 'Pin Created',
    category: 'tactics',
    principle: 'Pins an enemy piece against a higher-value target or the king.',
    baseScoreCp: 60,
    tier: 'PRIMARY',
  },
};

const PHASE_WEIGHTS: Record<string, number> = { n: 1, b: 1, r: 2, q: 4 };
const TOTAL_PHASE = 24;

export function computeGamePhase(fen: string): number {
  const board = fen.split(' ')[0];
  let nonPawnMaterial = 0;
  for (const ch of board) {
    const lower = ch.toLowerCase();
    if (PHASE_WEIGHTS[lower]) nonPawnMaterial += PHASE_WEIGHTS[lower];
  }
  return Math.min(1.0, nonPawnMaterial / TOTAL_PHASE);
}

// ---------------------------------------------------------------------------
// Outpost detection
// ---------------------------------------------------------------------------
function isOutpostSquare(board: Chess, square: Square, color: 'w' | 'b'): boolean {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = parseInt(square[1], 10) - 1;

  const rankLo = color === 'w' ? 3 : 2;
  const rankHi = color === 'w' ? 5 : 4;
  if (rank < rankLo || rank > rankHi) return false;

  const attackers = board.attackers(square, color);
  let hasPawnSupport = false;
  for (const sq of attackers) {
    const p = board.get(sq);
    if (p && p.type === 'p' && p.color === color) {
      hasPawnSupport = true;
      break;
    }
  }
  if (!hasPawnSupport) return false;

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
// Pawn structure helpers
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
  let isolated = 0, doubled = 0, passed = 0, backward = 0;
  const enemyColor = color === 'w' ? 'b' : 'w';
  const enemyPawns = board.findPiece({ type: 'p', color: enemyColor as any });
  for (let f = 0; f < 8; f++) {
    if (files[f].length === 0) continue;
    if (files[f].length >= 2) doubled += files[f].length - 1;
    const left = f > 0 ? files[f - 1].length : 0;
    const right = f < 7 ? files[f + 1].length : 0;
    if (left === 0 && right === 0) isolated++;
    for (const r of files[f]) {
      const isPassed = !enemyPawns.some(esq => {
        const ef = esq.charCodeAt(0) - 'a'.charCodeAt(0);
        const er = parseInt(esq[1], 10) - 1;
        if (Math.abs(ef - f) > 1) return false;
        return color === 'w' ? er > r : er < r;
      });
      if (isPassed) passed++;
      const behindRank = color === 'w' ? r - 1 : r + 1;
      const hasFriendBehind = (left > 0 || right > 0) && files[f-1]?.includes(behindRank) || files[f+1]?.includes(behindRank);
      const stopperRank = color === 'w' ? r + 2 : r - 2;
      const hasEnemyStopper = enemyPawns.some(esq => {
        const ef = esq.charCodeAt(0) - 'a'.charCodeAt(0);
        const er = parseInt(esq[1], 10) - 1;
        return Math.abs(ef - f) === 1 && er === stopperRank;
      });
      if (!hasFriendBehind && hasEnemyStopper) backward++;
    }
  }
  return { isolated, doubled, passed, backward };
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
  concreteThreats?: Array<{ san: string; gainCp: number; target: string; piece: string }>;
  evalBeforeCp: number;
  evalAfterCp: number;
  bestMoveSan?: string;
  pvLineSan?: string[];  // Principal variation line (for PURE_CALCULATION fallback)
}

// ---------------------------------------------------------------------------
// Main synthesizer
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

  // 1. MATERIAL
  if (input.isCapture && input.capturedPiece) {
    const pieceValues: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900 };
    const seeNet = input.seeScore;

    if (Math.abs(seeNet) >= 50) {
      const ruleId = seeNet > 0 ? 'MATERIAL_GAIN' : 'MATERIAL_LOSS';
      const meta = RULE_METADATA[ruleId];
      const baseScore = Math.abs(seeNet);
      const finalScore = Math.round(baseScore * phase);
      const pieceName = pieceFullName(input.capturedPiece);
      tiles.push({
        ruleId,
        ruleName: seeNet > 0 ? `Captured ${pieceName}` : `Lost Material`,
        category: meta.category,
        rawDeltaCp: baseScore,
        weightedPointsCp: seeNet > 0 ? finalScore : -finalScore,
        principleSummary: seeNet > 0
          ? `Wins a ${pieceName.toLowerCase()} on ${toSquare}.`
          : `Gives up material on ${toSquare}.`,
        highlightSquares: [toSquare],
        arrowVectors: [[fromSquare, toSquare, 'rgba(167, 139, 250, 0.85)']],
        importanceTier: meta.tier,
      });
      calcItems.push({
        ruleName: seeNet > 0 ? 'Material Captured' : 'Material Given Up',
        baseScoreCp: baseScore,
        phaseWeightMultiplier: phase,
        finalPointsCp: seeNet > 0 ? finalScore : -finalScore,
      });
    }
  }

  // 2. OUTPOST
  const movedPiece = boardAfter.get(toSquare as Square);
  if (movedPiece && (movedPiece.type === 'n' || movedPiece.type === 'b') && movedPiece.color === moverColor) {
    if (isOutpostSquare(boardAfter, toSquare as Square, moverColor)) {
      const ruleId = movedPiece.type === 'n' ? 'KNIGHT_OUTPOST' : 'BISHOP_OUTPOST';
      const meta = RULE_METADATA[ruleId];
      const finalCp = Math.round(meta.baseScoreCp * phase);
      const pieceName = movedPiece.type === 'n' ? 'Knight' : 'Bishop';
      tiles.push({
        ruleId,
        ruleName: `${pieceName} Outpost on ${toSquare}`,
        category: meta.category,
        rawDeltaCp: meta.baseScoreCp,
        weightedPointsCp: finalCp,
        principleSummary: `Anchors the ${pieceName.toLowerCase()} on ${toSquare}, supported by a pawn where enemy pawns cannot drive it away.`,
        highlightSquares: [toSquare],
        arrowVectors: [[fromSquare, toSquare, 'rgba(96, 165, 250, 0.85)']],
        importanceTier: meta.tier,
      });
      calcItems.push({
        ruleName: `${pieceName} Outpost (${toSquare})`,
        baseScoreCp: meta.baseScoreCp,
        phaseWeightMultiplier: phase,
        finalPointsCp: finalCp,
      });
    }
  }

  // 3. CONCRETE THREAT
  if (input.concreteThreats && input.concreteThreats.length > 0) {
    const top = input.concreteThreats[0];
    const meta = RULE_METADATA.CONCRETE_THREAT;
    const baseScore = Math.max(top.gainCp, 30);
    const finalScore = Math.round(baseScore * phase);
    const targetPieceName = pieceFullName(top.piece);
    const enemySideName = moverColor === 'w' ? 'Black' : 'White';
    tiles.push({
      ruleId: 'CONCRETE_THREAT',
      ruleName: `Attacks ${targetPieceName} on ${top.target}`,
      category: meta.category,
      rawDeltaCp: baseScore,
      weightedPointsCp: finalScore,
      principleSummary: `Creates an immediate attack against ${enemySideName}'s ${targetPieceName.toLowerCase()} on ${top.target}.`,
      highlightSquares: [top.target],
      arrowVectors: [[toSquare, top.target, 'rgba(248, 113, 113, 0.85)']],
      importanceTier: meta.tier,
    });
    calcItems.push({
      ruleName: `Threat on ${targetPieceName}`,
      baseScoreCp: baseScore,
      phaseWeightMultiplier: phase,
      finalPointsCp: finalScore,
    });
  }

  // 4. CENTER CONTROL
  const centerSquares: Square[] = ['d4', 'd5', 'e4', 'e5'] as Square[];
  const beforeCount = centerSquares.filter(sq => boardBefore.isAttacked(sq, moverColor)).length;
  const afterCount = centerSquares.filter(sq => boardAfter.isAttacked(sq, moverColor)).length;
  const centerDelta = afterCount - beforeCount;
  if (Math.abs(centerDelta) >= 1) {
    const meta = RULE_METADATA.CENTER_CONTROL;
    const baseScore = meta.baseScoreCp * centerDelta;
    const finalScore = Math.round(baseScore * phase);
    const controlledSquares = centerSquares.filter(sq => boardAfter.isAttacked(sq, moverColor));
    tiles.push({
      ruleId: 'CENTER_CONTROL',
      ruleName: 'Central Control',
      category: meta.category,
      rawDeltaCp: baseScore,
      weightedPointsCp: finalScore,
      principleSummary: centerDelta > 0
        ? `Increases attacks on the center squares (${controlledSquares.join(', ')}).`
        : `Reduces coverage over central squares.`,
      highlightSquares: controlledSquares.map(s => s as string),
      arrowVectors: centerDelta > 0 ? [[fromSquare, toSquare, 'rgba(52, 211, 153, 0.85)']] : [],
      importanceTier: meta.tier,
    });
    calcItems.push({
      ruleName: meta.name,
      baseScoreCp: baseScore,
      phaseWeightMultiplier: phase,
      finalPointsCp: finalScore,
    });
  }

  // 5. OPEN FILE
  if (movedPiece && (movedPiece.type === 'r' || movedPiece.type === 'q')) {
    const file = toSquare.charCodeAt(0) - 'a'.charCodeAt(0);
    const filePawns = boardAfter.findPiece({ type: 'p', color: moverColor as any })
      .filter(sq => sq.charCodeAt(0) - 'a'.charCodeAt(0) === file);
    const enemyFilePawns = boardAfter.findPiece({ type: 'p', color: (moverColor === 'w' ? 'b' : 'w') as any })
      .filter(sq => sq.charCodeAt(0) - 'a'.charCodeAt(0) === file);
    if (filePawns.length === 0 && enemyFilePawns.length === 0) {
      const meta = RULE_METADATA.OPEN_FILE;
      const finalScore = Math.round(meta.baseScoreCp * phase);
      const pieceName = movedPiece.type === 'r' ? 'Rook' : 'Queen';
      tiles.push({
        ruleId: 'OPEN_FILE',
        ruleName: `${pieceName} on Open ${toSquare[0].toUpperCase()}-File`,
        category: meta.category,
        rawDeltaCp: meta.baseScoreCp,
        weightedPointsCp: finalScore,
        principleSummary: `Places the ${pieceName.toLowerCase()} on the fully open ${toSquare[0]}-file to pressure enemy lines.`,
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

  // 6. DEVELOPMENT (minor piece off home rank)
  if (movedPiece && (movedPiece.type === 'n' || movedPiece.type === 'b')) {
    const homeRank = moverColor === 'w' ? 1 : 8;
    const fromRank = parseInt(fromSquare[1], 10);
    if (fromRank === homeRank) {
      const meta = RULE_METADATA.DEVELOPMENT;
      const finalScore = Math.round(meta.baseScoreCp * phase);
      const pieceName = movedPiece.type === 'n' ? 'Knight' : 'Bishop';
      tiles.push({
        ruleId: 'DEVELOPMENT',
        ruleName: `Develops ${pieceName} to ${toSquare}`,
        category: meta.category,
        rawDeltaCp: meta.baseScoreCp,
        weightedPointsCp: finalScore,
        principleSummary: `Brings the ${pieceName.toLowerCase()} off its starting rank to ${toSquare} into active play.`,
        highlightSquares: [toSquare],
        arrowVectors: [[fromSquare, toSquare, 'rgba(96, 165, 250, 0.85)']],
        importanceTier: meta.tier,
      });
      calcItems.push({
        ruleName: `Develops ${pieceName}`,
        baseScoreCp: meta.baseScoreCp,
        phaseWeightMultiplier: phase,
        finalPointsCp: finalScore,
      });
    }
  }

  // 7. CHECK DELIVERED
  if (input.isCheck && !input.isCheckmate) {
    const meta = RULE_METADATA.CHECK_DELIVERED;
    const finalScore = Math.round(meta.baseScoreCp * phase);
    const enemyColor = moverColor === 'w' ? 'b' : 'w';
    const enemyKing = boardAfter.findPiece({ type: 'k', color: enemyColor as any })[0];
    tiles.push({
      ruleId: 'CHECK_DELIVERED',
      ruleName: `Delivers Check on ${toSquare}`,
      category: meta.category,
      rawDeltaCp: meta.baseScoreCp,
      weightedPointsCp: finalScore,
      principleSummary: `Attacks the king directly with ${input.moveSan}, forcing an immediate escape move.`,
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

  // 8. PASSED PAWN
  const structAfter = pawnStructureCounts(input.fenAfter, moverColor);
  const structBefore = pawnStructureCounts(input.fenBefore, moverColor);
  if (structAfter.passed > structBefore.passed) {
    const meta = RULE_METADATA.PAWN_PASSED;
    const baseScore = meta.baseScoreCp * (structAfter.passed - structBefore.passed);
    const finalScore = Math.round(baseScore * phase);
    tiles.push({
      ruleId: 'PAWN_PASSED',
      ruleName: `Passed Pawn Created (${toSquare})`,
      category: meta.category,
      rawDeltaCp: baseScore,
      weightedPointsCp: finalScore,
      principleSummary: `Creates a passed pawn on ${toSquare} with no opposing pawns blocking its path.`,
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

  // 9. HUMAN-READABLE FALLBACK (When no single static rule dominates)
  // CRITICAL: zero-unexplained-moves guarantee. If NO strategic or tactical
  // rule fired, we do NOT output 0 tiles. We ground the move in piece-aware,
  // square-aware language describing what it concretely does.
  if (tiles.length === 0) {
    const pvSummary = input.pvLineSan && input.pvLineSan.length > 0
      ? input.pvLineSan.slice(0, 4).join(' ')
      : input.moveSan;
    const netEvalChange = input.evalAfterCp - input.evalBeforeCp;
    const humanSummary = buildHumanFallbackSummary(
      input.moveSan, movedPiece?.type, fromSquare, toSquare, pvSummary, moverColor,
    );

    tiles.push({
      ruleId: 'PURE_CALCULATION',
      ruleName: 'Tactical Continuation',
      category: 'tactics',
      rawDeltaCp: Math.abs(netEvalChange),
      weightedPointsCp: netEvalChange,
      principleSummary: humanSummary,
      highlightSquares: [toSquare],
      arrowVectors: [[fromSquare, toSquare, 'rgba(148, 163, 184, 0.80)']],
      importanceTier: 'PRIMARY',
    });
    calcItems.push({
      ruleName: 'Tactical Continuation',
      baseScoreCp: Math.abs(netEvalChange),
      phaseWeightMultiplier: 1.0,
      finalPointsCp: netEvalChange,
    });
  }

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
// Piece-name helper
// ---------------------------------------------------------------------------
function pieceFullName(p?: string): string {
  switch (p?.toLowerCase()) {
    case 'p': return 'Pawn';
    case 'n': return 'Knight';
    case 'b': return 'Bishop';
    case 'r': return 'Rook';
    case 'q': return 'Queen';
    case 'k': return 'King';
    default: return 'Piece';
  }
}

// ---------------------------------------------------------------------------
// Human fallback summary — describes what a quiet move concretely does,
// using the actual piece type, source/target square, and PV line.
// ---------------------------------------------------------------------------
function buildHumanFallbackSummary(
  moveSan: string,
  pieceType: string | undefined,
  fromSq: string,
  toSq: string,
  pvStr: string,
  moverColor: 'w' | 'b',
): string {
  // Castling (SAN starts with 'O')
  if (moveSan.startsWith('O-O-O')) {
    return `${moverColor === 'w' ? 'White' : 'Black'} castles queenside, tucking the king to safety and connecting the rooks.`;
  }
  if (moveSan.startsWith('O-O')) {
    return `${moverColor === 'w' ? 'White' : 'Black'} castles kingside, tucking the king to safety and connecting the rooks.`;
  }

  // Determine file/rank for richer pawn descriptions
  const toFile = toSq.charCodeAt(0) - 'a'.charCodeAt(0);
  const toRank = parseInt(toSq[1], 10);
  const isCenterFile = toFile >= 3 && toFile <= 4;          // d/e files
  const isWingFile = toFile <= 1 || toFile >= 6;             // a/b/g/h files
  const isAdvancedRank = moverColor === 'w' ? toRank >= 5 : toRank <= 4;

  if (pieceType === 'p') {
    if (isCenterFile && isAdvancedRank) {
      return `Pushes the ${toSq[0]}-pawn deep into the center to break up enemy pawn structure, with the line ${pvStr}.`;
    }
    if (isCenterFile) {
      return `Advances the center pawn to ${toSq} to contest the central squares and open lines for the pieces behind.`;
    }
    if (isWingFile && isAdvancedRank) {
      return `Stages a wing pawn push to ${toSq} to gain space on the flank and cramp the enemy pieces.`;
    }
    if (isWingFile) {
      return `Advances the wing pawn to ${toSq}, preparing to support pieces or create luft for the king.`;
    }
    return `Advances the pawn to ${toSq}, adjusting the pawn structure and the line ${pvStr}.`;
  }

  if (pieceType === 'n' || pieceType === 'b') {
    const pieceName = pieceType === 'n' ? 'knight' : 'bishop';
    return `Repositions the ${pieceName} from ${fromSq} to ${toSq} to improve its activity, eyeing key squares in the line ${pvStr}.`;
  }
  if (pieceType === 'r' || pieceType === 'q') {
    const pieceName = pieceType === 'r' ? 'rook' : 'queen';
    return `Reroutes the ${pieceName} from ${fromSq} to ${toSq} to prepare tactical pressure, following the line ${pvStr}.`;
  }
  if (pieceType === 'k') {
    // King walks toward center are notable in endgames; king fleeing is defensive
    const isCenterWalk = toRank >= 4 && toRank <= 5 && toFile >= 3 && toFile <= 4;
    if (isCenterWalk) {
      return `Marches the king to ${toSq} toward the center — typical in endgames where the king becomes an active fighting piece.`;
    }
    return `Moves the king to ${toSq} to step out of pressure or improve its defensive footprint.`;
  }
  return `Plays ${moveSan} as part of the tactical sequence ${pvStr}.`;
}

// ---------------------------------------------------------------------------
// Anti-hallucination filter — verifies the LLM's text doesn't claim things
// the symbolic engine proved false. Specifically guards against the bug
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
// ---------------------------------------------------------------------------
interface ConceptRule {
  concept: string;
  pattern: RegExp;
  requiredTileIds: string[];
  explanation: string;
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
    requiredTileIds: ['OPEN_FILE', 'SEMI_OPEN_FILE'],
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
    requiredTileIds: ['CONCRETE_THREAT', 'CHECK_DELIVERED', 'PIN_CREATED'],
    explanation: 'A concrete threat requires a winning capture (SEE ≥ 0) available after a null-move. No such capture was detected.',
  },
  {
    concept: 'king attack / king safety',
    pattern: /\b(king\s+(?:attack|safety|expos(?:e|ure)|vulnerab|weak)|attack(?:s|ing)?\s+(?:the\s+)?king|around\s+the\s+king|mating\s+(?:threat|attack|net))\b/i,
    requiredTileIds: ['KING_ATTACK', 'KING_EXPOSURE', 'CHECK_DELIVERED', 'KING_TROPISM'],
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

// Concepts NOT yet covered by any tile — flagged as "unverifiable" rather than
// "false", because we can't prove or disprove them with the current engine.
const UNVERIFIABLE_CONCEPTS: ConceptRule[] = [
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
// ---------------------------------------------------------------------------
export function checkNarrativeAgainstTiles(
  narrative: string,
  tiles: AtomicRuleTile[],
  input: SynthesizerInput,
): HallucinationCheckResult {
  const violations: string[] = [];
  const text = narrative;

  // Empty-tiles fallback
  if (tiles.length === 0) {
    const strategicClaim = STRATEGIC_CONCEPT_ALLOWLIST.some(rule => rule.pattern.test(text));
    const unverifiableClaim = UNVERIFIABLE_CONCEPTS.some(rule => rule.pattern.test(text));
    if (strategicClaim || unverifiableClaim) {
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

  // Allowlist enforcement
  for (const rule of STRATEGIC_CONCEPT_ALLOWLIST) {
    if (!rule.pattern.test(text)) continue;
    const hasTile = rule.requiredTileIds.some(id => tiles.some(t => t.ruleId === id));
    if (!hasTile) {
      let explanation = rule.explanation;
      if (explanation.includes('SEE_PLACEHOLDER')) {
        explanation = explanation.replace(/SEE_PLACEHOLDER/g, String(input.seeScore));
      }
      if (rule.concept === 'check' && input.isCheck) continue;
      if (rule.concept === 'piece development') {
        const board = new Chess(input.fenBefore);
        const movedPiece = board.get(input.moveUci.slice(0, 2) as Square);
        if (movedPiece && (movedPiece.type === 'n' || movedPiece.type === 'b')) {
          const homeRank = movedPiece.color === 'w' ? 1 : 8;
          const fromRank = parseInt(input.moveUci[1], 10);
          if (fromRank === homeRank) continue;
        }
      }
      violations.push(
        `LLM mentioned "${rule.concept}" but no corresponding tile fired. ${explanation}`
      );
    }
  }

  // Unverifiable concept warning
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
