// Contrastive Move Analyzer — side-by-side comparison of Played Move vs
// Engine Best Move. Answers: "Why was the move made, and why was it correct
// or incorrect compared to the best choice?"

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
  const search = searchBestMove(boardBeforeFen, 2);
  const bestMoveSan = search.bestMoveSan || playedMoveSan;
  const bestMoveUci = search.bestMoveUci || playedMoveUci;
  const isPlayedMoveBest = playedMoveSan === bestMoveSan || playedMoveUci === bestMoveUci;

  let bestEvalCp = playedEvalCp;
  try {
    const tmpBoard = new Chess(boardBeforeFen);
    tmpBoard.move(bestMoveUci);
    bestEvalCp = evaluate(tmpBoard.fen()).cp;
  } catch { /* keep playedEvalCp */ }

  const evalDiff = Math.abs(bestEvalCp - playedEvalCp);

  const playedBoard = new Chess(boardBeforeFen);
  let playedMoveResult;
  try { playedMoveResult = playedBoard.move(playedMoveUci); } catch { playedMoveResult = null; }
  const playedFenAfter = playedBoard.fen();
  const playedSee = playedMoveResult ? see(boardBeforeFen, playedMoveUci) : 0;
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

  // Strip the bare rule name + principle, not raw centipawn math
  const whatPlayedMoveAchieved = playedResult.tiles.map(t =>
    `${t.ruleName}: ${t.principleSummary}`
  );
  const whatBestMoveAchieved = bestResult.tiles.map(t =>
    `${t.ruleName}: ${t.principleSummary}`
  );

  let whyPlayedMoveFailed: string | null = null;
  let coreVerdict = '';

  if (isPlayedMoveBest) {
    coreVerdict = `${playedMoveSan} is the engine's top recommendation for this position.`;
  } else if (evalDiff <= 25) {
    coreVerdict = `${playedMoveSan} is a solid move, nearly on par with the top choice ${bestMoveSan}.`;
  } else if (evalDiff <= 70) {
    whyPlayedMoveFailed = `${playedMoveSan} is an inaccuracy (${(evalDiff / 100).toFixed(2)} pawn drop). The top line ${bestMoveSan} offered stronger piece activity: ${bestResult.tiles[0]?.principleSummary || 'a more precise tactical/positional result'}.`;
    coreVerdict = `${playedMoveSan} misses the stronger alternative ${bestMoveSan}.`;
  } else {
    whyPlayedMoveFailed = `${playedMoveSan} loses ${(evalDiff / 100).toFixed(2)} pawns in evaluation compared to ${bestMoveSan}. ${bestMoveSan} was necessary because: ${bestResult.tiles[0]?.principleSummary || 'it prevents tactical vulnerabilities or captures material'}.`;
    coreVerdict = `${playedMoveSan} allows significant counterplay compared to the best line ${bestMoveSan}.`;
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
