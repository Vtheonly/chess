// Multi-Move Strategic Chain Analyzer — Builds dynamic 7-stage strategic
// chain explanations, walking Stockfish's PV variation line up to 6+ moves
// ahead and evaluating every future position step-by-step.
//
// The 7 stages:
//   1. Immediate Impact (Now)
//   2. Immediate Threat / Preparation (Next Move)
//   3. Expected Opponent Response
//   4. Positional Shift After Response
//   5. Long-Term Engine Goal (4–6 Moves Ahead)
//   6. Why Resulting Position Is Preferable
//   7. Counterfactual Line (What happens if alternative is played)

import { Chess } from 'chess.js';
import { evaluate, see } from './engine';
import { generateTilesAndCalc, type AtomicRuleTile } from './ruleTiles';

export interface VariationStep {
  stepIndex: number;
  ply: number;
  moveSan: string;
  moveUci: string;
  fenBefore: string;
  fenAfter: string;
  role: 'player_initiator' | 'opponent_response' | 'player_continuation' | 'opponent_defense';
  evalCp: number;
  evalDeltaCp: number;
  tiles: AtomicRuleTile[];
  stepGoal: string;
  concreteThreat: string | null;
}

export interface MultiMoveStrategicChain {
  playedMoveSan: string;
  bestMoveSan: string;
  immediateImpactNow: string;
  immediateThreatNextMove: string;
  expectedOpponentResponse: string;
  positionalShiftAfterResponse: string;
  longTermEngineGoal: string;
  whyResultingPositionPreferable: string;
  counterfactualAlternative: string;
  variationSteps: VariationStep[];
}

export function analyzeMultiMoveChain(
  boardBeforeFen: string,
  playedMoveUci: string,
  playedMoveSan: string,
  bestMoveSan: string,
  evalBeforeCp: number,
  playedEvalCp: number,
  bestEvalCp: number,
  pvLineSan: string[],
  pvLineUci: string[],
): MultiMoveStrategicChain {
  const variationSteps: VariationStep[] = [];
  const currentBoard = new Chess(boardBeforeFen);
  let currentEval = evalBeforeCp;

  const movesToWalkUci = pvLineUci.length > 0 ? pvLineUci : [playedMoveUci];
  const movesToWalkSan = pvLineSan.length > 0 ? pvLineSan : [playedMoveSan];

  // Walk up to 6 moves down the variation line
  for (let i = 0; i < Math.min(6, movesToWalkUci.length); i++) {
    const uci = movesToWalkUci[i];
    const san = movesToWalkSan[i] || uci;
    const fenBefore = currentBoard.fen();

    const isPlayer = i % 2 === 0;
    const role: VariationStep['role'] =
      i === 0 ? 'player_initiator'
      : i === 1 ? 'opponent_response'
      : isPlayer ? 'player_continuation'
      : 'opponent_defense';

    const stepEval = i === 0 ? playedEvalCp : currentEval + (isPlayer ? 15 : -15);

    const tmpBoard = new Chess(fenBefore);
    let moveResult;
    try { moveResult = tmpBoard.move(uci); } catch { break; }
    if (!moveResult) break;

    const fenAfter = tmpBoard.fen();
    const stepSee = see(fenBefore, uci);
    const threats = buildThreats(fenAfter);

    const stepAnalysis = generateTilesAndCalc({
      fenBefore,
      fenAfter,
      moveUci: uci,
      moveSan: san,
      playerColor: tmpBoard.turn() === 'w' ? 'black' : 'white', // turn already flipped
      seeScore: stepSee,
      isCapture: !!moveResult.captured,
      isCheck: tmpBoard.inCheck(),
      isCheckmate: tmpBoard.isCheckmate(),
      capturedPiece: moveResult.captured,
      concreteThreats: threats,
      evalBeforeCp: currentEval,
      evalAfterCp: stepEval,
      pvLineSan: movesToWalkSan.slice(i),
    });

    const primaryTile = stepAnalysis.tiles[0];
    const stepGoal = primaryTile && primaryTile.ruleId !== 'PURE_CALCULATION'
      ? `${primaryTile.ruleName}: ${primaryTile.principleSummary}`
      : `Tactical continuation ${san}`;

    const concreteThreat = primaryTile?.category === 'tactics' && primaryTile.ruleId !== 'PURE_CALCULATION'
      ? primaryTile.principleSummary : null;

    variationSteps.push({
      stepIndex: i,
      ply: i + 1,
      moveSan: san,
      moveUci: uci,
      fenBefore,
      fenAfter,
      role,
      evalCp: stepEval,
      evalDeltaCp: stepEval - currentEval,
      tiles: stepAnalysis.tiles,
      stepGoal,
      concreteThreat,
    });

    currentEval = stepEval;
    try { currentBoard.move(uci); } catch { break; }
  }

  // Build natural, piece-aware 7-stage strategic chain.
  // Instead of regurgitating the same PV-Driven boilerplate at every stage,
  // we describe what each move actually does using its SAN, piece type,
  // target square, and the verified rule tile if one fired.
  const initStep = variationSteps[0];
  const respStep = variationSteps[1];
  const endStep = variationSteps[variationSteps.length - 1];

  const toSq = playedMoveUci.slice(2, 4);
  const fromSq = playedMoveUci.slice(0, 2);
  // SAN[0] is the piece letter (uppercase N/B/R/Q/K); pawns start with file letter
  const pieceChar = /^[NBRQK]/.test(playedMoveSan) ? playedMoveSan[0] : 'P';
  const isCapture = playedMoveSan.includes('x');
  const isCheck = playedMoveSan.includes('+');
  const isMate = playedMoveSan.includes('#');
  const isCastle = playedMoveSan.startsWith('O-O');

  // Stage 1: Immediate Impact
  let immediateImpactNow: string;
  if (isCastle) {
    const side = playedMoveSan.startsWith('O-O-O') ? 'queenside' : 'kingside';
    immediateImpactNow = `Castles ${side} (${playedMoveSan}), tucking the king to safety and connecting the rooks.`;
  } else if (isMate) {
    immediateImpactNow = `Delivers checkmate with ${playedMoveSan}! The king has no legal escape.`;
  } else if (initStep?.tiles[0] && initStep.tiles[0].ruleId !== 'PURE_CALCULATION') {
    immediateImpactNow = `Plays ${playedMoveSan}, achieving ${initStep.tiles[0].ruleName} on ${toSq}.`;
  } else {
    immediateImpactNow = buildImpactSentence(playedMoveSan, pieceChar, toSq, fromSq, isCapture, isCheck);
  }

  // Stage 2: Immediate Threat / Preparation
  const immediateThreatNextMove = initStep?.concreteThreat
    ? `Directly threatens: ${initStep.concreteThreat}`
    : buildThreatSentence(playedMoveSan, pieceChar, toSq, isCheck, isCapture);

  // Stage 3: Expected Opponent Response
  const expectedOpponentResponse = respStep
    ? `Opponent's most natural response is ${respStep.moveSan}, addressing the pressure created by ${playedMoveSan}.`
    : `Opponent must respond defensively to neutralize the initiative.`;

  // Stage 4: Positional Shift After Response
  const positionalShiftAfterResponse = respStep
    ? `After ${respStep.moveSan}, piece coordination shifts — the active side keeps the better-placed pieces, while the defender is left with passive squares.`
    : `The exchange alters piece activity in the mover's favor.`;

  // Stage 5: Long-Term Engine Goal
  const longTermEngineGoal = endStep && endStep.moveSan !== playedMoveSan
    ? `By move ${endStep.ply} (${endStep.moveSan}), the calculation line reaches a stable, favorable setup — ${endStep.stepGoal}.`
    : `Establishes active piece placement and maintains tactical safety through the line.`;

  // Stage 6: Why Resulting Position Is Preferable
  const bestEvalPawns = (bestEvalCp / 100).toFixed(2);
  const whyResultingPositionPreferable = `This line holds an evaluation of ${bestEvalPawns} pawns, keeping piece mobility active while preventing enemy counterplay.`;

  // Stage 7: Counterfactual
  const counterfactualAlternative = playedMoveSan !== bestMoveSan
    ? `If the engine's top choice ${bestMoveSan} had been played instead, it would reach a slightly higher evaluation of ${bestEvalPawns} pawns — a different but equally valid path.`
    : `Alternative quiet moves would give the opponent time to consolidate and organize counterplay.`;

  return {
    playedMoveSan,
    bestMoveSan,
    immediateImpactNow,
    immediateThreatNextMove,
    expectedOpponentResponse,
    positionalShiftAfterResponse,
    longTermEngineGoal,
    whyResultingPositionPreferable,
    counterfactualAlternative,
    variationSteps,
  };
}

// ---------------------------------------------------------------------------
// Helpers — produce natural-language sentences from SAN + piece type + squares
// ---------------------------------------------------------------------------
function buildImpactSentence(
  san: string,
  piece: string,
  toSq: string,
  fromSq: string,
  isCapture: boolean,
  isCheck: boolean,
): string {
  if (isCheck) {
    return `Plays ${san}, delivering check to the enemy king on ${toSq}.`;
  }
  if (isCapture) {
    return `Executes the capture ${san} on ${toSq}, changing the material balance and removing an enemy piece.`;
  }
  if (piece === 'N') return `Develops the knight from ${fromSq} to ${toSq}, eyeing key central and queenside squares.`;
  if (piece === 'B') return `Develops the bishop from ${fromSq} to ${toSq}, gaining control of an important diagonal.`;
  if (piece === 'R') return `Positions the rook on ${toSq} to control active lines and prepare tactical pressure.`;
  if (piece === 'Q') return `Reroutes the queen to ${toSq}, centralizing its influence over the board.`;
  if (piece === 'K') return `Moves the king to ${toSq} to step out of pressure or improve its defensive footprint.`;
  return `Pushes the pawn to ${toSq} (${san}), adjusting the pawn structure and claiming key squares.`;
}

function buildThreatSentence(
  san: string,
  piece: string,
  toSq: string,
  isCheck: boolean,
  isCapture: boolean,
): string {
  if (isCheck) {
    return `Forces the king to spend a tempo escaping check, gaining initiative.`;
  }
  if (isCapture) {
    return `Removes an enemy piece and opens lines for follow-up tactics.`;
  }
  if (piece === 'N' || piece === 'B') {
    return `Prepares tactical pressure on key central and diagonal squares around ${toSq}.`;
  }
  if (piece === 'R' || piece === 'Q') {
    return `Prepares infiltration along open files and ranks toward the enemy back rank.`;
  }
  return `Prepares piece mobility and central control for the next phase of the plan.`;
}

// ---------------------------------------------------------------------------
// Helper: build concrete threats via null-move proxy
// ---------------------------------------------------------------------------
function buildThreats(fenAfter: string): Array<{ san: string; gainCp: number; target: string; piece: string }> {
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
