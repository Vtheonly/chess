// Root Cause Tracer ("Patient Zero") — scans backward through game history
// to pinpoint the exact earlier move where a positional weakness was
// introduced or the evaluation first dropped.
// Answers: "Where did the mistake actually start?"

import type { ChessMove } from '@/types/chess';

export interface RootCauseRecord {
  patientZeroPly: number;
  patientZeroMoveNumber: number;
  patientZeroMoveSan: string;
  patientZeroEvalDropCp: number;
  rootCauseRuleName: string;
  rootCauseExplanation: string;
  movesUntilBlunder: number;
}

export function traceRootCause(
  moveHistory: ChessMove[],
  currentPly: number,
): RootCauseRecord | null {
  if (currentPly <= 2 || moveHistory.length < 2) return null;

  const currentMove = moveHistory.find(m => m.ply === currentPly);
  if (!currentMove) return null;

  const playerColor = currentMove.turn;

  // Scan backward through game history up to 10 moves (20 plies)
  for (let i = currentPly - 2; i >= Math.max(0, currentPly - 20); i -= 2) {
    const pastMove = moveHistory.find(m => m.ply === i);
    const prevMove = moveHistory.find(m => m.ply === i - 2);

    if (pastMove && prevMove) {
      // Eval drop from the perspective of the player who played `pastMove`
      const drop = (prevMove.evalCp - pastMove.evalCp) * (playerColor === 'white' ? 1 : -1);

      if (drop >= 60) {
        const movesDifference = Math.floor((currentPly - i) / 2);
        return {
          patientZeroPly: i,
          patientZeroMoveNumber: pastMove.moveNumber,
          patientZeroMoveSan: pastMove.san,
          patientZeroEvalDropCp: Math.round(drop),
          rootCauseRuleName: pastMove.classification || 'Positional Weakness Introduced',
          rootCauseExplanation: `PATIENT ZERO FOUND: Move ${pastMove.moveNumber} (${pastMove.san}) is the root cause of the current downfall. It dropped the position by ${Math.round(drop)}cp, creating a positional weakness that matured ${movesDifference} move(s) later.`,
          movesUntilBlunder: movesDifference,
        };
      }
    }
  }

  return null;
}
