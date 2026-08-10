// Contrastive Move Analyzer — evaluates the Played Move AND the engine's
// Best Move in parallel, comparing what was gained vs. missed.
// Answers: "Why was the move made, and why was it correct or incorrect
// compared to the best choice?"

import { Chess } from 'chess.js';
import { evaluate, see, searchBestMove } from './engine';
import { generateTilesAndCalc, type AtomicRuleTile } from './ruleTiles';

export interface MoveContrastComparison {
  playedMoveSan: string;
  bestMoveSan: string;
  isPlayedMoveBest: boolean;
  playedMoveEvalCp: number;
  bestMoveEvalCp: number;
  evalDifferenceCp: number;
  playedMoveTiles: AtomicRuleTile[];
  bestMoveTiles: AtomicRuleTile[];
  whatPlayedMoveAchieved: string[];
  whatBestMoveAchieved: string[];
  whyPlayedMoveFailed: string | null;
  coreVerdict: string;
}

export function analyzeMoveContrast(
  boardBeforeFen: string,
  playedMoveUci: string,
  playedMoveSan: string,
  evalBeforeCp: number,
  playedEvalCp: number,
  pvLineSan?: string[],
): MoveContrastComparison {
  // Search for the engine's best move
  const search = searchBestMove(boardBeforeFen, 2);
  const bestMoveSan = search.bestMoveSan || playedMoveSan;
  const bestMoveUci = search.bestMoveUci || playedMoveUci;
  const isPlayedMoveBest = playedMoveSan === bestMoveSan || playedMoveUci === bestMoveUci;

  // Compute best move's eval
  let bestEvalCp = playedEvalCp;
  try {
    const tmpBoard = new Chess(boardBeforeFen);
    tmpBoard.move(bestMoveUci);
    bestEvalCp = evaluate(tmpBoard.fen()).cp;
  } catch { /* keep playedEvalCp */ }

  const evalDiff = Math.abs(bestEvalCp - playedEvalCp);

  // Analyze played move tiles
  const playedBoard = new Chess(boardBeforeFen);
  let playedMoveResult;
  try { playedMoveResult = playedBoard.move(playedMoveUci); } catch { playedMoveResult = null; }
  const playedFenAfter = playedBoard.fen();
  const playedSee = playedMoveResult ? see(boardBeforeFen, playedMoveUci) : 0;

  // Build concrete threats for played move
  const playedThreats = buildConcreteThreats(playedFenAfter);

  const playedResult = generateTilesAndCalc({
    fenBefore: boardBeforeFen,
    fenAfter: playedFenAfter,
    moveUci: playedMoveUci,
    moveSan: playedMoveSan,
    playerColor: new Chess(boardBeforeFen).turn() === 'w' ? 'white' : 'black',
    seeScore: playedSee,
    isCapture: !!playedMoveResult?.captured,
    isCheck: playedBoard.inCheck(),
    isCheckmate: playedBoard.isCheckmate(),
    capturedPiece: playedMoveResult?.captured,
    concreteThreats: playedThreats,
    evalBeforeCp,
    evalAfterCp: playedEvalCp,
    pvLineSan,
  });

  // Analyze best move tiles (if different from played)
  let bestResult = playedResult;
  if (!isPlayedMoveBest) {
    const bestBoard = new Chess(boardBeforeFen);
    let bestMoveResult;
    try { bestMoveResult = bestBoard.move(bestMoveUci); } catch { bestMoveResult = null; }
    if (bestMoveResult) {
      const bestFenAfter = bestBoard.fen();
      const bestSee = see(boardBeforeFen, bestMoveUci);
      const bestThreats = buildConcreteThreats(bestFenAfter);
      bestResult = generateTilesAndCalc({
        fenBefore: boardBeforeFen,
        fenAfter: bestFenAfter,
        moveUci: bestMoveUci,
        moveSan: bestMoveSan,
        playerColor: new Chess(boardBeforeFen).turn() === 'w' ? 'white' : 'black',
        seeScore: bestSee,
        isCapture: !!bestMoveResult.captured,
        isCheck: bestBoard.inCheck(),
        isCheckmate: bestBoard.isCheckmate(),
        capturedPiece: bestMoveResult.captured,
        concreteThreats: bestThreats,
        evalBeforeCp,
        evalAfterCp: bestEvalCp,
        pvLineSan: search.pv,
      });
    }
  }

  const whatPlayedMoveAchieved = playedResult.tiles.map(t =>
    `${t.ruleName} (${t.weightedPointsCp > 0 ? '+' : ''}${t.weightedPointsCp}cp): ${t.principleSummary}`
  );
  const whatBestMoveAchieved = bestResult.tiles.map(t =>
    `${t.ruleName} (${t.weightedPointsCp > 0 ? '+' : ''}${t.weightedPointsCp}cp): ${t.principleSummary}`
  );

  let whyPlayedMoveFailed: string | null = null;
  let coreVerdict = '';

  if (isPlayedMoveBest) {
    coreVerdict = `EXCELLENT MOVE! ${playedMoveSan} is the engine's top recommendation, maximizing positional assets and tactical safety.`;
  } else if (evalDiff <= 20) {
    coreVerdict = `GOOD MOVE. ${playedMoveSan} is a strong alternative (only ${evalDiff}cp behind top choice ${bestMoveSan}).`;
  } else if (evalDiff <= 70) {
    whyPlayedMoveFailed = `${playedMoveSan} is an inaccuracy (${evalDiff}cp drop). While it attempts ${playedResult.tiles[0]?.ruleName || 'a plan'}, the best move ${bestMoveSan} was stronger because it achieves: ${bestResult.tiles[0]?.principleSummary || 'a superior tactical/positional result'}.`;
    coreVerdict = `INACCURACY. ${playedMoveSan} misses the higher-impact alternative ${bestMoveSan}.`;
  } else {
    whyPlayedMoveFailed = `MISTAKE / BLUNDER (${evalDiff}cp drop). ${playedMoveSan} fails to match ${bestMoveSan}, which was necessary because: ${bestResult.tiles[0]?.principleSummary || 'it prevents tactical vulnerabilities or captures material'}.`;
    coreVerdict = `MISTAKE. ${playedMoveSan} allows significant counterplay compared to ${bestMoveSan}.`;
  }

  return {
    playedMoveSan,
    bestMoveSan,
    isPlayedMoveBest,
    playedMoveEvalCp: playedEvalCp,
    bestMoveEvalCp: bestEvalCp,
    evalDifferenceCp: evalDiff,
    playedMoveTiles: playedResult.tiles,
    bestMoveTiles: bestResult.tiles,
    whatPlayedMoveAchieved,
    whatBestMoveAchieved,
    whyPlayedMoveFailed,
    coreVerdict,
  };
}

// ---------------------------------------------------------------------------
// Helper: build concrete threats via null-move proxy
// ---------------------------------------------------------------------------
function buildConcreteThreats(fenAfter: string): Array<{ san: string; gainCp: number; target: string; piece: string }> {
  const threats: Array<{ san: string; gainCp: number; target: string; piece: string }> = [];
  try {
    const fenParts = fenAfter.split(' ');
    fenParts[1] = fenParts[1] === 'w' ? 'b' : 'w';
    fenParts[3] = '-';
    const tmp = new Chess();
    tmp.load(fenParts.join(' '));
    const caps = tmp.moves({ verbose: true }) as any[];
    for (const m of caps.slice(0, 12)) {
      if (!m.captured) continue;
      const gain = see(tmp.fen(), m.lan);
      if (gain >= 0) {
        threats.push({ san: m.san, gainCp: gain, target: m.to, piece: m.captured });
      }
    }
  } catch { /* skip */ }
  return threats;
}
