// Position Health Assessor — 360° audit of the board state BEFORE the move.
// Answers: "What makes this position good or bad?"
//
// Audits: material, bishops, outposts, open files, pawn structure, king safety.
// Outputs strengths + weaknesses for both White and Black.

import { Chess, Square } from 'chess.js';
import { CONCEPT_TAXONOMY, ConceptDefinition } from './taxonomy';

export interface PositionAuditItem {
  concept: ConceptDefinition;
  scoreCp: number;
  description: string;
  side: 'white' | 'black';
}

export interface PositionHealthAssessment {
  evalCp: number;
  statusHeadline: string;
  whiteStrengths: PositionAuditItem[];
  whiteWeaknesses: PositionAuditItem[];
  blackStrengths: PositionAuditItem[];
  blackWeaknesses: PositionAuditItem[];
  overallSummary: string;
}

export function assessPositionHealth(fen: string, evalCp: number): PositionHealthAssessment {
  const board = new Chess(fen);

  const whiteStrengths: PositionAuditItem[] = [];
  const whiteWeaknesses: PositionAuditItem[] = [];
  const blackStrengths: PositionAuditItem[] = [];
  const blackWeaknesses: PositionAuditItem[] = [];

  // 1. Audit Material
  const matDiff = computeMaterialDiff(board);
  if (Math.abs(matDiff) >= 100) {
    const item: PositionAuditItem = {
      concept: CONCEPT_TAXONOMY.MATERIAL_ADVANTAGE,
      scoreCp: Math.abs(matDiff),
      description: `${matDiff > 0 ? 'White' : 'Black'} has a material advantage of +${(Math.abs(matDiff) / 100).toFixed(1)} pawns.`,
      side: matDiff > 0 ? 'white' : 'black',
    };
    if (matDiff > 0) whiteStrengths.push(item);
    else blackStrengths.push(item);
  }

  // 2. Audit Bishops (bishop pair + bad bishops)
  auditBishops(board, whiteStrengths, whiteWeaknesses, blackStrengths, blackWeaknesses);

  // 3. Audit Knights & Outposts
  auditKnightsAndOutposts(board, whiteStrengths, whiteWeaknesses, blackStrengths, blackWeaknesses);

  // 4. Audit Open Files & Rooks
  auditRooksAndFiles(board, whiteStrengths, whiteWeaknesses, blackStrengths, blackWeaknesses);

  // 5. Audit Pawn Structure (isolated, doubled, passed)
  auditPawnStructure(board, whiteStrengths, whiteWeaknesses, blackStrengths, blackWeaknesses);

  // 6. Audit King Safety
  auditKingSafety(board, whiteStrengths, whiteWeaknesses, blackStrengths, blackWeaknesses);

  // Build status headline
  let statusHeadline = 'Equilibrium position with equal chances.';
  if (evalCp > 200) statusHeadline = 'White holds a decisive, winning advantage.';
  else if (evalCp > 70) statusHeadline = 'White controls a clear positional & tactical advantage.';
  else if (evalCp < -200) statusHeadline = 'Black holds a decisive, winning advantage.';
  else if (evalCp < -70) statusHeadline = 'Black controls a clear positional & tactical advantage.';

  const whiteSummary = whiteStrengths.map(s => s.concept.name).join(', ') || 'No major structural strengths';
  const blackSummary = blackStrengths.map(s => s.concept.name).join(', ') || 'No major structural strengths';
  const overallSummary = `Position eval is ${evalCp > 0 ? '+' : ''}${(evalCp / 100).toFixed(2)} pawns. White key assets: [${whiteSummary}]. Black key assets: [${blackSummary}].`;

  return {
    evalCp,
    statusHeadline,
    whiteStrengths,
    whiteWeaknesses,
    blackStrengths,
    blackWeaknesses,
    overallSummary,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function computeMaterialDiff(board: Chess): number {
  const vals: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  let diff = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = (String.fromCharCode(97 + f) + (8 - r)) as Square;
      const p = board.get(sq);
      if (p) {
        const v = vals[p.type] || 0;
        diff += p.color === 'w' ? v : -v;
      }
    }
  }
  return diff;
}

function auditBishops(
  board: Chess,
  wStr: PositionAuditItem[], wWeak: PositionAuditItem[],
  bStr: PositionAuditItem[], bWeak: PositionAuditItem[],
) {
  let wBishops = 0, bBishops = 0;
  const wBishopSquares: Square[] = [];
  const bBishopSquares: Square[] = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = (String.fromCharCode(97 + f) + (8 - r)) as Square;
      const p = board.get(sq);
      if (p && p.type === 'b') {
        if (p.color === 'w') { wBishops++; wBishopSquares.push(sq); }
        else { bBishops++; bBishopSquares.push(sq); }
      }
    }
  }
  if (wBishops >= 2) {
    wStr.push({
      concept: CONCEPT_TAXONOMY.BISHOP_PAIR, scoreCp: 50,
      description: 'White possesses the Bishop Pair, controlling all light and dark square diagonals.',
      side: 'white',
    });
  }
  if (bBishops >= 2) {
    bStr.push({
      concept: CONCEPT_TAXONOMY.BISHOP_PAIR, scoreCp: 50,
      description: 'Black possesses the Bishop Pair, controlling all light and dark square diagonals.',
      side: 'black',
    });
  }
  // Check for bad bishops (≥3 own pawns on same color complex)
  for (const sq of wBishopSquares) {
    if (isBadBishopHelper(board, sq, 'w')) {
      wWeak.push({
        concept: CONCEPT_TAXONOMY.BAD_BISHOP, scoreCp: -35,
        description: `White bishop on ${sq} is hemmed in by own pawns on the same color complex.`,
        side: 'white',
      });
    }
  }
  for (const sq of bBishopSquares) {
    if (isBadBishopHelper(board, sq, 'b')) {
      bWeak.push({
        concept: CONCEPT_TAXONOMY.BAD_BISHOP, scoreCp: -35,
        description: `Black bishop on ${sq} is hemmed in by own pawns on the same color complex.`,
        side: 'black',
      });
    }
  }
}

function isBadBishopHelper(board: Chess, square: Square, color: 'w' | 'b'): boolean {
  const piece = board.get(square);
  if (!piece || piece.type !== 'b' || piece.color !== color) return false;
  const sqFile = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const sqRank = parseInt(square[1], 10) - 1;
  const isLight = (sqFile + sqRank) % 2 === 0;
  const pawns = board.findPiece({ type: 'p', color: color as any });
  let sameColor = 0;
  for (const psq of pawns) {
    const pf = psq.charCodeAt(0) - 'a'.charCodeAt(0);
    const pr = parseInt(psq[1], 10) - 1;
    if ((pf + pr) % 2 === 0 === isLight) sameColor++;
  }
  return sameColor >= 3;
}

function auditKnightsAndOutposts(
  board: Chess,
  wStr: PositionAuditItem[], wWeak: PositionAuditItem[],
  bStr: PositionAuditItem[], bWeak: PositionAuditItem[],
) {
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = (String.fromCharCode(97 + f) + (8 - r)) as Square;
      const p = board.get(sq);
      if (p && p.type === 'n') {
        const rank = 8 - r;
        if (p.color === 'w' && rank >= 4 && rank <= 6) {
          wStr.push({
            concept: CONCEPT_TAXONOMY.KNIGHT_OUTPOST, scoreCp: 45,
            description: `White knight anchored on outpost square ${sq}.`,
            side: 'white',
          });
        } else if (p.color === 'b' && rank >= 3 && rank <= 5) {
          bStr.push({
            concept: CONCEPT_TAXONOMY.KNIGHT_OUTPOST, scoreCp: 45,
            description: `Black knight anchored on outpost square ${sq}.`,
            side: 'black',
          });
        }
      }
    }
  }
}

function auditRooksAndFiles(
  board: Chess,
  wStr: PositionAuditItem[], wWeak: PositionAuditItem[],
  bStr: PositionAuditItem[], bWeak: PositionAuditItem[],
) {
  for (let f = 0; f < 8; f++) {
    const fileChar = String.fromCharCode(97 + f);
    let whitePawns = 0, blackPawns = 0, whiteRooks = 0, blackRooks = 0;
    for (let r = 0; r < 8; r++) {
      const sq = (fileChar + (8 - r)) as Square;
      const p = board.get(sq);
      if (p) {
        if (p.type === 'p') {
          if (p.color === 'w') whitePawns++; else blackPawns++;
        }
        if (p.type === 'r') {
          if (p.color === 'w') whiteRooks++; else blackRooks++;
        }
      }
    }
    if (whitePawns === 0 && blackPawns === 0) {
      if (whiteRooks > 0) {
        wStr.push({
          concept: CONCEPT_TAXONOMY.OPEN_FILE, scoreCp: 35,
          description: `White controls open ${fileChar}-file with rook.`,
          side: 'white',
        });
      }
      if (blackRooks > 0) {
        bStr.push({
          concept: CONCEPT_TAXONOMY.OPEN_FILE, scoreCp: 35,
          description: `Black controls open ${fileChar}-file with rook.`,
          side: 'black',
        });
      }
    }
    // Semi-open: no friendly pawns, ≥1 enemy pawn
    if (whitePawns === 0 && blackPawns > 0 && whiteRooks > 0) {
      wStr.push({
        concept: CONCEPT_TAXONOMY.SEMI_OPEN_FILE, scoreCp: 20,
        description: `White rook on semi-open ${fileChar}-file pressures enemy pawns.`,
        side: 'white',
      });
    }
    if (blackPawns === 0 && whitePawns > 0 && blackRooks > 0) {
      bStr.push({
        concept: CONCEPT_TAXONOMY.SEMI_OPEN_FILE, scoreCp: 20,
        description: `Black rook on semi-open ${fileChar}-file pressures enemy pawns.`,
        side: 'black',
      });
    }
    // Rook on 7th rank
    if (whiteRooks > 0) {
      const sq7 = (fileChar + '7') as Square;
      const p7 = board.get(sq7);
      if (p7 && p7.type === 'r' && p7.color === 'w') {
        wStr.push({
          concept: CONCEPT_TAXONOMY.ROOK_ON_7TH, scoreCp: 50,
          description: `White rook on 7th rank (${sq7}) cuts off the enemy king.`,
          side: 'white',
        });
      }
    }
    if (blackRooks > 0) {
      const sq2 = (fileChar + '2') as Square;
      const p2 = board.get(sq2);
      if (p2 && p2.type === 'r' && p2.color === 'b') {
        bStr.push({
          concept: CONCEPT_TAXONOMY.ROOK_ON_7TH, scoreCp: 50,
          description: `Black rook on 2nd rank (${sq2}) cuts off the enemy king.`,
          side: 'black',
        });
      }
    }
  }
}

function auditPawnStructure(
  board: Chess,
  wStr: PositionAuditItem[], wWeak: PositionAuditItem[],
  bStr: PositionAuditItem[], bWeak: PositionAuditItem[],
) {
  for (let f = 0; f < 8; f++) {
    const fileChar = String.fromCharCode(97 + f);
    let wPawnsInFile = 0, bPawnsInFile = 0;
    const wPawnRanks: number[] = [];
    const bPawnRanks: number[] = [];
    for (let r = 0; r < 8; r++) {
      const sq = (fileChar + (8 - r)) as Square;
      const p = board.get(sq);
      if (p && p.type === 'p') {
        if (p.color === 'w') { wPawnsInFile++; wPawnRanks.push(8 - r); }
        else { bPawnsInFile++; bPawnRanks.push(8 - r); }
      }
    }
    if (wPawnsInFile >= 2) {
      wWeak.push({
        concept: CONCEPT_TAXONOMY.DOUBLED_PAWNS, scoreCp: -20,
        description: `White has doubled pawns on the ${fileChar}-file.`,
        side: 'white',
      });
    }
    if (bPawnsInFile >= 2) {
      bWeak.push({
        concept: CONCEPT_TAXONOMY.DOUBLED_PAWNS, scoreCp: -20,
        description: `Black has doubled pawns on the ${fileChar}-file.`,
        side: 'black',
      });
    }
    // Isolated check
    const leftW = f > 0 ? countPawnsOnFile(board, f - 1, 'w') : 0;
    const rightW = f < 7 ? countPawnsOnFile(board, f + 1, 'w') : 0;
    if (wPawnsInFile > 0 && leftW === 0 && rightW === 0) {
      wWeak.push({
        concept: CONCEPT_TAXONOMY.ISOLATED_PAWN, scoreCp: -25,
        description: `White has an isolated pawn on the ${fileChar}-file.`,
        side: 'white',
      });
    }
    const leftB = f > 0 ? countPawnsOnFile(board, f - 1, 'b') : 0;
    const rightB = f < 7 ? countPawnsOnFile(board, f + 1, 'b') : 0;
    if (bPawnsInFile > 0 && leftB === 0 && rightB === 0) {
      bWeak.push({
        concept: CONCEPT_TAXONOMY.ISOLATED_PAWN, scoreCp: -25,
        description: `Black has an isolated pawn on the ${fileChar}-file.`,
        side: 'black',
      });
    }
    // Passed pawn check
    for (const wr of wPawnRanks) {
      const enemyPawns = board.findPiece({ type: 'p', color: 'b' as any });
      const isPassed = !enemyPawns.some(esq => {
        const ef = esq.charCodeAt(0) - 'a'.charCodeAt(0);
        const er = parseInt(esq[1], 10);
        return Math.abs(ef - f) <= 1 && er > wr;
      });
      if (isPassed) {
        wStr.push({
          concept: CONCEPT_TAXONOMY.PASSED_PAWN, scoreCp: 55,
          description: `White has a passed pawn on ${fileChar}${wr}.`,
          side: 'white',
        });
        break; // one per file is enough
      }
    }
    for (const br of bPawnRanks) {
      const enemyPawns = board.findPiece({ type: 'p', color: 'w' as any });
      const isPassed = !enemyPawns.some(esq => {
        const ef = esq.charCodeAt(0) - 'a'.charCodeAt(0);
        const er = parseInt(esq[1], 10);
        return Math.abs(ef - f) <= 1 && er < br;
      });
      if (isPassed) {
        bStr.push({
          concept: CONCEPT_TAXONOMY.PASSED_PAWN, scoreCp: 55,
          description: `Black has a passed pawn on ${fileChar}${br}.`,
          side: 'black',
        });
        break;
      }
    }
  }
}

function countPawnsOnFile(board: Chess, fileIdx: number, color: 'w' | 'b'): number {
  const fileChar = String.fromCharCode(97 + fileIdx);
  let count = 0;
  for (let r = 0; r < 8; r++) {
    const sq = (fileChar + (8 - r)) as Square;
    const p = board.get(sq);
    if (p && p.type === 'p' && p.color === color) count++;
  }
  return count;
}

function auditKingSafety(
  board: Chess,
  wStr: PositionAuditItem[], wWeak: PositionAuditItem[],
  bStr: PositionAuditItem[], bWeak: PositionAuditItem[],
) {
  const wKingSq = findKingSqHelper(board, 'w');
  const bKingSq = findKingSqHelper(board, 'b');

  // Pawn shield check
  if (wKingSq) {
    const shieldCount = countPawnShield(board, wKingSq, 'w');
    if (shieldCount >= 2 && (wKingSq === 'g1' || wKingSq === 'c1' || wKingSq === 'h1' || wKingSq === 'b1')) {
      wStr.push({
        concept: CONCEPT_TAXONOMY.KING_PAWN_SHIELD, scoreCp: 40,
        description: 'White king is castled and protected behind an intact pawn shield.',
        side: 'white',
      });
    } else if (shieldCount === 0) {
      wWeak.push({
        concept: CONCEPT_TAXONOMY.KING_EXPOSURE, scoreCp: -70,
        description: 'White king lacks pawn shield cover and is vulnerable to direct attacks.',
        side: 'white',
      });
    }
  }
  if (bKingSq) {
    const shieldCount = countPawnShield(board, bKingSq, 'b');
    if (shieldCount >= 2 && (bKingSq === 'g8' || bKingSq === 'c8' || bKingSq === 'h8' || bKingSq === 'b8')) {
      bStr.push({
        concept: CONCEPT_TAXONOMY.KING_PAWN_SHIELD, scoreCp: 40,
        description: 'Black king is castled and protected behind an intact pawn shield.',
        side: 'black',
      });
    } else if (shieldCount === 0) {
      bWeak.push({
        concept: CONCEPT_TAXONOMY.KING_EXPOSURE, scoreCp: -70,
        description: 'Black king lacks pawn shield cover and is vulnerable to direct attacks.',
        side: 'black',
      });
    }
  }
}

function countPawnShield(board: Chess, kingSq: Square, color: 'w' | 'b'): number {
  const kingFile = kingSq.charCodeAt(0) - 'a'.charCodeAt(0);
  const kingRank = parseInt(kingSq[1], 10) - 1;
  const shieldRank = color === 'w' ? kingRank + 1 : kingRank - 1;
  if (shieldRank < 0 || shieldRank > 7) return 0;
  let count = 0;
  for (const df of [-1, 0, 1]) {
    const f = kingFile + df;
    if (f >= 0 && f <= 7) {
      const sq = `${'abcdefgh'[f]}${shieldRank + 1}` as Square;
      const p = board.get(sq);
      if (p && p.type === 'p' && p.color === color) count++;
    }
  }
  return count;
}

function findKingSqHelper(board: Chess, color: 'w' | 'b'): Square | null {
  const kings = board.findPiece({ type: 'k', color: color as any });
  return kings.length > 0 ? (kings[0] as Square) : null;
}
