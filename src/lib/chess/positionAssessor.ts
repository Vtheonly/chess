// Position Health Assessor — 360° audit of the board state before a move.
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

  // 1. Material Audit
  const matDiff = computeMaterialDiff(board);
  if (Math.abs(matDiff) >= 100) {
    const side = matDiff > 0 ? 'white' : 'black';
    const leader = matDiff > 0 ? 'White' : 'Black';
    const item: PositionAuditItem = {
      concept: CONCEPT_TAXONOMY.MATERIAL_ADVANTAGE,
      scoreCp: Math.abs(matDiff),
      description: `${leader} holds a +${(Math.abs(matDiff) / 100).toFixed(1)} pawn material lead.`,
      side,
    };
    if (matDiff > 0) whiteStrengths.push(item);
    else blackStrengths.push(item);
  }

  // 2. Bishops
  auditBishops(board, whiteStrengths, whiteWeaknesses, blackStrengths, blackWeaknesses);

  // 3. Outposts
  auditKnightsAndOutposts(board, whiteStrengths, whiteWeaknesses, blackStrengths, blackWeaknesses);

  // 4. Open Files
  auditRooksAndFiles(board, whiteStrengths, whiteWeaknesses, blackStrengths, blackWeaknesses);

  // 5. Pawn Structure
  auditPawnStructure(board, whiteStrengths, whiteWeaknesses, blackStrengths, blackWeaknesses);

  // 6. King Safety
  auditKingSafety(board, whiteStrengths, whiteWeaknesses, blackStrengths, blackWeaknesses);

  let statusHeadline = 'Balanced position with equal chances.';
  if (evalCp > 200) statusHeadline = 'White holds a winning advantage.';
  else if (evalCp > 70) statusHeadline = 'White has a clear positional edge.';
  else if (evalCp < -200) statusHeadline = 'Black holds a winning advantage.';
  else if (evalCp < -70) statusHeadline = 'Black has a clear positional edge.';

  const whiteSummary = whiteStrengths.map(s => s.concept.name).join(', ') || 'No major strengths';
  const blackSummary = blackStrengths.map(s => s.concept.name).join(', ') || 'No major strengths';
  const overallSummary = `Eval: ${evalCp > 0 ? '+' : ''}${(evalCp / 100).toFixed(2)} pawns. White: [${whiteSummary}]. Black: [${blackSummary}].`;

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

  // Bishop pair advantage is exclusive — only one side can have the pair.
  // A pair against a single enemy bishop is a real advantage; both sides
  // having two bishops is just parity.
  if (wBishops >= 2 && bBishops < 2) {
    wStr.push({
      concept: CONCEPT_TAXONOMY.BISHOP_PAIR, scoreCp: 50,
      description: 'White holds the bishop pair advantage — both colors covered by bishops, against Black\'s single bishop.',
      side: 'white',
    });
  }
  if (bBishops >= 2 && wBishops < 2) {
    bStr.push({
      concept: CONCEPT_TAXONOMY.BISHOP_PAIR, scoreCp: 50,
      description: 'Black holds the bishop pair advantage — both colors covered by bishops, against White\'s single bishop.',
      side: 'black',
    });
  }

  // Bad-bishop detection: only flag if the bishop's forward diagonals are
  // genuinely obstructed by *fixed* own pawns (pawns that can't easily move).
  // A bishop behind a movable pawn chain is NOT bad — it's just undeveloped.
  for (const sq of wBishopSquares) {
    if (isBadBishopHelper(board, sq, 'w')) {
      wWeak.push({
        concept: CONCEPT_TAXONOMY.BAD_BISHOP, scoreCp: -35,
        description: `White bishop on ${sq} is restricted by fixed pawns on the same color complex.`,
        side: 'white',
      });
    }
  }
  for (const sq of bBishopSquares) {
    if (isBadBishopHelper(board, sq, 'b')) {
      bWeak.push({
        concept: CONCEPT_TAXONOMY.BAD_BISHOP, scoreCp: -35,
        description: `Black bishop on ${sq} is restricted by fixed pawns on the same color complex.`,
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

  // Look at own pawns on the same color complex that are AHEAD of the bishop
  // (closer to enemy) AND blocked (i.e. can't advance because a pawn or piece
  // sits in front). A blocked same-color pawn is "fixed" — that's what makes
  // the bishop bad.
  const pawns = board.findPiece({ type: 'p', color: color as any });
  let fixedSameColorPawns = 0;
  for (const psq of pawns) {
    const pf = psq.charCodeAt(0) - 'a'.charCodeAt(0);
    const pr = parseInt(psq[1], 10) - 1;
    // Same color complex?
    if ((pf + pr) % 2 === 0 !== isLight) continue;
    // Must be ahead of bishop (toward enemy)
    const isAhead = color === 'w' ? pr > sqRank : pr < sqRank;
    if (!isAhead) continue;
    // Is the square in front of this pawn occupied?
    const aheadRank = color === 'w' ? pr + 1 : pr - 1;
    if (aheadRank < 0 || aheadRank > 7) continue;
    const aheadSq = `${'abcdefgh'[pf]}${aheadRank + 1}` as Square;
    if (board.get(aheadSq) !== null) {
      fixedSameColorPawns++;
    }
  }
  return fixedSameColorPawns >= 2;
}

function auditKnightsAndOutposts(
  board: Chess,
  wStr: PositionAuditItem[], wWeak: PositionAuditItem[],
  bStr: PositionAuditItem[], bWeak: PositionAuditItem[],
) {
  // A real outpost requires: rank in enemy half + friendly pawn support +
  // no enemy pawn can challenge it. We don't just rubber-stamp every knight
  // on ranks 4-6.
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = (String.fromCharCode(97 + f) + (8 - r)) as Square;
      const p = board.get(sq);
      if (!p || p.type !== 'n') continue;
      const rank = 8 - r;
      const file = f;

      const color: 'w' | 'b' = p.color as any;
      const enemyColor = color === 'w' ? 'b' : 'w';

      // Must be on ranks 4-6 for White, 3-5 for Black
      const inEnemyHalf = color === 'w'
        ? rank >= 4 && rank <= 6
        : rank >= 3 && rank <= 5;
      if (!inEnemyHalf) continue;

      // Friendly pawn support?
      const supporters = board.attackers(sq, color).filter(s => {
        const sp = board.get(s);
        return sp && sp.type === 'p' && sp.color === color;
      });
      if (supporters.length === 0) continue;

      // Enemy pawn on adjacent file that could challenge?
      const enemyPawns = board.findPiece({ type: 'p', color: enemyColor as any });
      const isChallengable = enemyPawns.some(psq => {
        const pf = psq.charCodeAt(0) - 'a'.charCodeAt(0);
        const pr = parseInt(psq[1], 10) - 1;
        if (Math.abs(pf - file) !== 1) return false;
        // Enemy pawn can attack this square if it's "ahead" of the square
        // from its perspective. For White knights, enemy (Black) pawn must
        // be on a higher rank (closer to white's side). For Black knights,
        // enemy (White) pawn must be on a lower rank.
        return color === 'w' ? pr >= rank - 1 : pr <= rank + 1;
      });
      if (isChallengable) continue;

      // Real outpost
      const side: 'white' | 'black' = color === 'w' ? 'white' : 'black';
      const sideName = color === 'w' ? 'White' : 'Black';
      const item: PositionAuditItem = {
        concept: CONCEPT_TAXONOMY.KNIGHT_OUTPOST, scoreCp: 45,
        description: `${sideName} knight is anchored on an outpost at ${sq} — defended by a pawn and unchallengeable by enemy pawns.`,
        side,
      };
      if (color === 'w') wStr.push(item);
      else bStr.push(item);
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
          description: `White rook controls the open ${fileChar}-file.`,
          side: 'white',
        });
      }
      if (blackRooks > 0) {
        bStr.push({
          concept: CONCEPT_TAXONOMY.OPEN_FILE, scoreCp: 35,
          description: `Black rook controls the open ${fileChar}-file.`,
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
        break;
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

  // Currently in check?
  if (board.inCheck()) {
    const turn = board.turn();
    if (turn === 'w') {
      wWeak.push({
        concept: CONCEPT_TAXONOMY.KING_EXPOSURE, scoreCp: -80,
        description: `White king on ${wKingSq || 'board'} is currently in check!`,
        side: 'white',
      });
    } else {
      bWeak.push({
        concept: CONCEPT_TAXONOMY.KING_EXPOSURE, scoreCp: -80,
        description: `Black king on ${bKingSq || 'board'} is currently in check!`,
        side: 'black',
      });
    }
  }

  // Pawn shield only counts if king is castled (back rank)
  if (wKingSq) {
    const wRank = parseInt(wKingSq[1], 10);
    if (wRank === 1) {
      const shieldCount = countPawnShield(board, wKingSq, 'w');
      if (shieldCount >= 2) {
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
    } else if (wRank >= 3 && wRank <= 6) {
      // King has marched into the center — exposed
      wWeak.push({
        concept: CONCEPT_TAXONOMY.KING_EXPOSURE, scoreCp: -120,
        description: `White king on ${wKingSq} has marched into the center and is dangerously exposed.`,
        side: 'white',
      });
    }
  }
  if (bKingSq) {
    const bRank = parseInt(bKingSq[1], 10);
    if (bRank === 8) {
      const shieldCount = countPawnShield(board, bKingSq, 'b');
      if (shieldCount >= 2) {
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
    } else if (bRank >= 3 && bRank <= 6) {
      bWeak.push({
        concept: CONCEPT_TAXONOMY.KING_EXPOSURE, scoreCp: -120,
        description: `Black king on ${bKingSq} has marched into the center and is dangerously exposed.`,
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
