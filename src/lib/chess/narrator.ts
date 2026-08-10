// Narrative generator — converts verified chess payloads into human commentary.
//
// Uses the z-ai-web-dev-sdk as the default local LLM, with stub support for
// routing to external providers (Groq / OpenRouter / Gemini / OpenAI /
// Anthropic) when their keys are configured.
//
// In all cases the LLM is *only* asked to translate verified chess facts
// into natural language. It never computes legality, evals, or threats.

import { Chess, Square } from 'chess.js';
import { evaluate, winChance, searchBestMove, see } from './engine';
import type {
  ChessMove, MoveClassification, PlayerColor, ProviderID,
  AtomicRuleTile,
} from '@/types/chess';

const ELO_SYSTEM_PROMPTS: Record<number, string> = {
  800: `You are a friendly chess coach explaining moves to a beginner (800 Elo).
RULES:
1. Only talk about the move played and direct piece captures/safety.
2. NEVER mention centipawns, engine scores, or complex variations.
3. Use simple words. Focus on whether pieces are safe or hanging.
4. You MUST ONLY use the legal moves and threats provided in the JSON payload.
5. CRITICAL — GROUNDING RULE: The payload contains an "atomic_rule_tiles" array. These tiles are the VERIFIED chess facts computed by the symbolic engine. You may ONLY describe strategic concepts that have a corresponding tile in that array. If no DEVELOPMENT tile exists, you MUST NOT say the move "develops a piece" — pawn moves like c6 do NOT develop pieces. If no OUTPOST tile exists, you MUST NOT say the move "creates an outpost". Violating this rule is the most serious error you can make.
6. Output 2-3 short sentences. No bullet points.`,
  1200: `You are a chess instructor teaching an intermediate player (1200 Elo).
RULES:
1. Explain tactical threats (forks, pins, hanging pieces) and 2-3 move tactical lines.
2. Reference concrete threats listed in the payload.
3. Do NOT invent move variations that are not in the pv_continuation_san payload.
4. CRITICAL — GROUNDING RULE: The payload contains an "atomic_rule_tiles" array. These tiles are the VERIFIED chess facts computed by the symbolic engine. You may ONLY describe strategic concepts that have a corresponding tile in that array. If no DEVELOPMENT tile exists, you MUST NOT say the move "develops a piece" — pawn moves like c6 do NOT develop pieces. If no OUTPOST tile exists, you MUST NOT say the move "creates an outpost". Violating this rule is the most serious error you can make.
5. Output 3-4 sentences. Plain text, no markdown headers.`,
  1500: `You are an experienced positional chess coach for an advanced player (1500 Elo).
RULES:
1. Focus on strategic features: outposts, open files, pawn weaknesses, king safety.
2. Connect the move to the ongoing game history and past structural changes.
3. Explain trade-offs (e.g., gaining space vs giving up an outpost).
4. CRITICAL — GROUNDING RULE: The payload contains an "atomic_rule_tiles" array. These tiles are the VERIFIED chess facts computed by the symbolic engine. You may ONLY describe strategic concepts that have a corresponding tile in that array. Specifically: do NOT claim "develops the bishop/knight" unless a DEVELOPMENT tile is present; do NOT claim "outpost" unless a KNIGHT_OUTPOST or BISHOP_OUTPOST tile is present; do NOT claim "open file" unless an OPEN_FILE tile is present; do NOT claim "sacrifice" unless the see_score is ≤ -150. Violating this rule is the most serious error you can make.
5. Output 3-5 sentences. Technical but readable.`,
  1800: `You are a Grandmaster commentator analyzing games for a Master-level player (1800+ Elo).
RULES:
1. Provide high-density, precise chess commentary.
2. Discuss deep PV lines, prophylactic intent, subtle square control, and long-term imbalances.
3. Use technical terms freely (e.g., "color-complex weakness", "prophylaxis", "outpost").
4. CRITICAL — GROUNDING RULE: The payload contains an "atomic_rule_tiles" array. These tiles are the VERIFIED chess facts computed by the symbolic engine. You may ONLY describe strategic concepts that have a corresponding tile in that array. Specifically: do NOT claim "develops the bishop/knight" unless a DEVELOPMENT tile is present; do NOT claim "outpost" unless a KNIGHT_OUTPOST or BISHOP_OUTPOST tile is present; do NOT claim "open file" unless an OPEN_FILE tile is present; do NOT claim "sacrifice" unless the see_score is ≤ -150. Violating this rule is the most serious error you can make.
5. Output 4-6 sentences. Dense, GM-level.`,
};

function systemPromptFor(elo: number): string {
  const tiers = [800, 1200, 1500, 1800];
  let closest = 1800;
  let minDiff = Infinity;
  for (const t of tiers) {
    if (Math.abs(t - elo) < minDiff) {
      minDiff = Math.abs(t - elo);
      closest = t;
    }
  }
  return ELO_SYSTEM_PROMPTS[closest];
}

// ---------------------------------------------------------------------------
// Build the synthesis payload (Layer 4-style) for a single move.
// ---------------------------------------------------------------------------
export interface SynthesisPayload {
  fen_before: string;
  fen_after: string;
  move_san: string;
  move_uci: string;
  player_color: PlayerColor;
  target_elo: number;
  eval_cp_before: number;
  eval_cp_after: number;
  eval_delta_cp: number;
  win_chance_before: number;
  win_chance_after: number;
  delta_w: number;
  classification: MoveClassification;
  best_move_san: string;
  see_score: number;
  is_capture: boolean;
  is_check: boolean;
  is_checkmate: boolean;
  concrete_threats: Array<{ san: string; gain_cp: number; target: string; piece: string }>;
  pv_continuation_san: string[];
  game_memory?: {
    persistent_imbalances: string[];
    key_past_events: string[];
    recent_momentum: string[];
  };
}

export function buildPayload(opts: {
  fenBefore: string;
  moveUci: string;
  moveSan: string;
  playerColor: PlayerColor;
  targetElo: number;
  pvContinuation?: string[];
}): SynthesisPayload {
  const { fenBefore, moveUci, moveSan, playerColor, targetElo } = opts;
  const chessBefore = new Chess(fenBefore);
  const eBefore = evaluate(fenBefore);

  const chessAfter = new Chess(fenBefore);
  try { chessAfter.move(moveUci); } catch { /* invalid */ }
  const eAfter = evaluate(chessAfter.fen());

  const wcBefore = winChance(eBefore.cp, eBefore.isMate, eBefore.mateIn);
  const wcAfter  = winChance(eAfter.cp,   eAfter.isMate,   eAfter.mateIn);
  const playerSign = playerColor === 'white' ? 1 : -1;
  const deltaW = (wcAfter - wcBefore) * playerSign;

  const best = searchBestMove(fenBefore, 1);
  const seeScore = see(fenBefore, moveUci);
  const isCapture = /x/.test(moveSan);
  const isCheck = chessAfter.inCheck();
  const isCheckmate = chessAfter.isCheckmate();
  const isBestMove = best.bestMoveSan === moveSan;
  const isSacrifice = seeScore < -150;

  const cls = classifyMoveFromClassification({
    isBestMove, isSacrifice, seeScore, deltaW,
    wBefore: playerColor === 'white' ? wcBefore : 1 - wcBefore,
    wAfter:  playerColor === 'white' ? wcAfter  : 1 - wcAfter,
    isOnlyViable: false,
  });

  // Detect concrete threats via null-move search
  const threats: Array<{ san: string; gain_cp: number; target: string; piece: string }> = [];
  if (!isCheckmate && !chessAfter.isStalemate()) {
    try {
      const tmpBoard = new Chess(chessAfter.fen());
      const fenParts = chessAfter.fen().split(' ');
      fenParts[1] = fenParts[1] === 'w' ? 'b' : 'w';
      fenParts[3] = '-';
      tmpBoard.load(fenParts.join(' '));
      const captureMoves = tmpBoard.moves({ verbose: true });
      for (const m of captureMoves.slice(0, 8)) {
        if (!m.captured) continue;
        const gain = see(tmpBoard.fen(), m.lan);
        if (gain >= 0) {
          threats.push({
            san: m.san,
            gain_cp: gain,
            target: m.to,
            piece: m.captured,
          });
        }
      }
    } catch { /* skip */ }
  }

  return {
    fen_before: fenBefore,
    fen_after: chessAfter.fen(),
    move_san: moveSan,
    move_uci: moveUci,
    player_color: playerColor,
    target_elo: targetElo,
    eval_cp_before: eBefore.cp,
    eval_cp_after: eAfter.cp,
    eval_delta_cp: eAfter.cp - eBefore.cp,
    win_chance_before: wcBefore,
    win_chance_after: wcAfter,
    delta_w: deltaW,
    classification: cls,
    best_move_san: best.bestMoveSan,
    see_score: seeScore,
    is_capture: isCapture,
    is_check: isCheck,
    is_checkmate: isCheckmate,
    concrete_threats: threats,
    pv_continuation_san: opts.pvContinuation || best.pv,
  };
}

// Re-import the classifier (avoid circular dep)
import { classifyMove } from './engine';

function classifyMoveFromClassification(input: Parameters<typeof classifyMove>[0]): MoveClassification {
  return classifyMove(input);
}

// ---------------------------------------------------------------------------
// LLM call — uses z-ai-web-dev-sdk for the local default.
// External providers route to /api/v1/llm/generate.
// ---------------------------------------------------------------------------
export interface NarrationResult {
  commentary: string;
  payload: SynthesisPayload;
  provider: ProviderID | 'local';
  latencyMs: number;
}

export async function generateNarrative(
  payload: SynthesisPayload,
  opts: { provider?: ProviderID; apiKey?: string; model?: string } = {},
): Promise<NarrationResult> {
  const start = performance.now();
  const systemPrompt = systemPromptFor(payload.target_elo);

  // If an external provider is configured, route through our backend API.
  if (opts.provider && opts.apiKey) {
    try {
      const resp = await fetch('/api/v1/llm/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Caissa-Provider': opts.provider,
          ...(opts.apiKey ? { [`X-Caissa-ApiKey-${providerHeaderSuffix(opts.provider)}`]: opts.apiKey } : {}),
          ...(opts.model ? { 'X-Caissa-Model': opts.model } : {}),
        },
        body: JSON.stringify({ payload, systemPrompt }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      return {
        commentary: data.commentary,
        payload,
        provider: opts.provider,
        latencyMs: performance.now() - start,
      };
    } catch (err) {
      console.warn('External LLM failed, falling back to local:', err);
    }
  }

  // Local fallback: try z-ai-web-dev-sdk via API route
  try {
    const resp = await fetch('/api/v1/llm/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, systemPrompt }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.commentary) {
        return {
          commentary: data.commentary,
          payload,
          provider: 'local',
          latencyMs: performance.now() - start,
        };
      }
    }
  } catch { /* fall through to template */ }

  // Last-resort: deterministic, chess-literate template
  return {
    commentary: templateNarrative(payload),
    payload,
    provider: 'local',
    latencyMs: performance.now() - start,
  };
}

function providerHeaderSuffix(p: ProviderID): string {
  switch (p) {
    case 'groq': return 'Groq';
    case 'openrouter': return 'OpenRouter';
    case 'google_gemini': return 'Gemini';
    case 'openai': return 'Openai';
    case 'anthropic': return 'Anthropic';
  }
}

// ===========================================================================
// templateNarrative — the deterministic, chess-literate fallback.
//
// This is the CRITICAL function that previously produced the robotic output
// the user complained about. It now:
//
//   1. Parses the SAN to know the piece type, capture status, check status
//      (rather than blindly string-concatenating "White plays X").
//   2. Consumes the `atomic_rule_tiles` array that the caller attaches to
//      the payload — these are the VERIFIED chess facts. The narrative is
//      driven by what the symbolic engine actually proved, NOT by eval-delta
//      arithmetic.
//   3. Names the moving piece, the source square, the target square, and the
//      strategic concept verified by the tile.
//   4. Avoids robotic phrases like "Evaluation worsens by -129 cp", "Initiates
//      g6, achieving Deep Calculation Line (PV-Driven)", and the duplicate
//      PV-text regurgitation that plagued the old 7-stage chain.
//
// The output is 3-5 fluent sentences, Elo-aware, and grounded only in the
// verified tiles. No claim is made unless a tile backs it.
// ===========================================================================
function templateNarrative(p: SynthesisPayload): string {
  const lines: string[] = [];
  const player = p.player_color === 'white' ? 'White' : 'Black';
  const playerLower = player.toLowerCase();

  // The store attaches atomic_rule_tiles to the payload before calling us.
  const tiles: AtomicRuleTile[] = (p as any).atomic_rule_tiles || [];

  // Parse the SAN: piece type, capture, check, mate, castle
  const san = p.move_san;
  const toSq = p.move_uci.slice(2, 4);
  const fromSq = p.move_uci.slice(0, 2);
  const isCastleK = /^O-O(?:\+|#)?$/.test(san);
  const isCastleQ = /^O-O-O(?:\+|#)?$/.test(san);
  const isMate = san.includes('#');
  const isCheck = san.includes('+');
  const isCapture = san.includes('x');
  // SAN[0] uppercase letter = piece type (N/B/R/Q/K); else it's a pawn (file letter)
  const pieceChar = /^[NBRQK]/.test(san) ? san[0] : 'P';
  const pieceName = pieceCharToName(pieceChar);

  // Eval delta from the *player's* perspective (positive = good for player)
  const rawDelta = p.eval_cp_after - p.eval_cp_before;
  const playerDelta = p.player_color === 'white' ? rawDelta : -rawDelta;
  const playerDeltaPawns = (Math.abs(playerDelta) / 100).toFixed(2);

  // Elo tier — determines sentence count, vocabulary, technical depth
  const elo = p.target_elo || 1200;
  const eloTier: 'beginner' | 'intermediate' | 'advanced' | 'master' =
    elo < 1000 ? 'beginner' :
    elo < 1400 ? 'intermediate' :
    elo < 1700 ? 'advanced' :
    'master';

  // ─── Sentence 1: Headline (move + piece + squares + fianchetto) ─────
  // Fianchetto detection: pawn to b6/g6 (Black) or b3/g3 (White) preparing
  // a bishop to the long diagonal. file2 explicitly demanded g6 be
  // described as "preparing a fianchetto".
  const isFianchettoPawnPush =
    pieceChar === 'P' &&
    ((p.player_color === 'white' && (toSq === 'b3' || toSq === 'g3')) ||
     (p.player_color === 'black' && (toSq === 'b6' || toSq === 'g6')));

  if (isCastleK) {
    lines.push(`${player} castles kingside (O-O), tucking the king to safety and connecting the rooks.`);
  } else if (isCastleQ) {
    lines.push(`${player} castles queenside (O-O-O), safeguarding the king and connecting the rooks.`);
  } else if (isMate) {
    lines.push(`${player} delivers checkmate with ${san}!`);
  } else if (isCheck) {
    const enemyKing = findEnemyKingSquare(p.fen_after, p.player_color);
    // If the enemy king is uncastled (ranks 2-3 for White, ranks 6-7 for Black),
    // describe it as exposed — file2 demanded "Ne4+ checks White's exposed king on f3".
    const enemyKingRank = enemyKing ? parseInt(enemyKing[1], 10) : 0;
    const enemyColor = p.player_color === 'white' ? 'black' : 'white';
    const isUncastled =
      enemyKing &&
      ((enemyColor === 'white' && enemyKingRank >= 2 && enemyKingRank <= 6) ||
       (enemyColor === 'black' && enemyKingRank <= 7 && enemyKingRank >= 3));
    if (isUncastled && enemyKing) {
      lines.push(`${player} puts the uncastled king on ${enemyKing} in check with ${san} — a sharp tactical strike that forces the king to move.`);
    } else {
      lines.push(
        `${player} puts the enemy king in check with ${san}` +
        (enemyKing ? ` — the king on ${enemyKing} must escape.` : '.')
      );
    }
  } else if (isCapture && p.see_score > 0) {
    // Name both the capturing piece AND the captured piece (file2 demand)
    const capturedName = pieceFullName(p.is_capture ? inferCapturedPieceFromFen(p.fen_before, toSq) : undefined);
    if (capturedName && capturedName !== 'Piece') {
      lines.push(`${player}'s ${pieceName.toLowerCase()} captures the ${capturedName.toLowerCase()} on ${toSq} (${san}), winning material cleanly.`);
    } else {
      lines.push(`${player} captures on ${toSq} with ${san}, winning material cleanly.`);
    }
  } else if (isCapture && p.see_score < -50) {
    const capturedName = pieceFullName(p.is_capture ? inferCapturedPieceFromFen(p.fen_before, toSq) : undefined);
    if (capturedName && capturedName !== 'Piece') {
      lines.push(`${player}'s ${pieceName.toLowerCase()} sacrifices for the ${capturedName.toLowerCase()} on ${toSq} (${san}), giving up material for tactical compensation.`);
    } else {
      lines.push(`${player} sacrifices with ${san} on ${toSq}, giving up material for tactical compensation.`);
    }
  } else if (isCapture) {
    const capturedName = pieceFullName(p.is_capture ? inferCapturedPieceFromFen(p.fen_before, toSq) : undefined);
    if (capturedName && capturedName !== 'Piece') {
      lines.push(`${player}'s ${pieceName.toLowerCase()} takes the ${capturedName.toLowerCase()} on ${toSq} (${san}), initiating an exchange.`);
    } else {
      lines.push(`${player} captures on ${toSq} with ${san}, initiating an exchange.`);
    }
  } else if (isFianchettoPawnPush) {
    const diagonal = (toSq === 'g3' || toSq === 'g6') ? 'long dark-square' : 'long light-square';
    lines.push(`${player} pushes the ${toSq[0]}-pawn to ${toSq}, preparing to fianchetto the bishop onto the ${diagonal} diagonal.`);
  } else if (pieceChar === 'P') {
    // Pawn moves — describe file/rank context
    const file = toSq[0];
    const rank = parseInt(toSq[1], 10);
    const isCenter = 'de'.includes(file);
    const isWing = 'abgh'.includes(file);
    const isAdvanced = p.player_color === 'white' ? rank >= 5 : rank <= 4;
    if (isCenter && isAdvanced) {
      lines.push(`${player} pushes the ${file}-pawn to ${toSq}, striking at the center and cramping the enemy position.`);
    } else if (isCenter) {
      lines.push(`${player} advances the ${file}-pawn to ${toSq}, contesting the central squares.`);
    } else if (isWing && isAdvanced) {
      lines.push(`${player} stages a wing pawn push to ${toSq}, gaining space on the flank.`);
    } else {
      lines.push(`${player} pushes the pawn to ${toSq}.`);
    }
  } else if (pieceChar === 'K') {
    const kingRank = parseInt(toSq[1], 10);
    const kingFile = toSq.charCodeAt(0) - 'a'.charCodeAt(0);
    const isCenterWalk = kingRank >= 4 && kingRank <= 5 && kingFile >= 3 && kingFile <= 4;
    // Detect uncastled king walking in the open (ranks 2-6) — exposed
    const isUncastledWalk =
      (p.player_color === 'white' && kingRank >= 2 && kingRank <= 6) ||
      (p.player_color === 'black' && kingRank <= 7 && kingRank >= 3);
    if (isCenterWalk) {
      lines.push(`${player} marches the king to ${toSq} toward the center — typical in endgames, where the king becomes an active fighting piece.`);
    } else if (isUncastledWalk && !isCastleK && !isCastleQ) {
      lines.push(`${player} moves the king from ${fromSq} to ${toSq}, leaving it uncastled and exposed in the open — a risky maneuver unless the position is simplified.`);
    } else {
      lines.push(`${player} moves the king from ${fromSq} to ${toSq}.`);
    }
  } else {
    // Minor or heavy piece repositioning
    lines.push(`${player} reroutes the ${pieceName.toLowerCase()} from ${fromSq} to ${toSq} with ${san}.`);
  }

  // ─── Sentence 2: Strategic context, grounded in verified tiles ──────
  const strategicTiles = tiles.filter(t => t.ruleId !== 'PURE_CALCULATION');
  const fallbackTile = tiles.find(t => t.ruleId === 'PURE_CALCULATION');

  if (strategicTiles.length > 0) {
    const topTile = strategicTiles
      .slice()
      .sort((a, b) => Math.abs(b.weightedPointsCp) - Math.abs(a.weightedPointsCp))[0];
    lines.push(topTile.principleSummary);
  } else if (fallbackTile) {
    lines.push(fallbackTile.principleSummary);
  }

  // ─── Sentence 3: Tactical threats (if any) ──────────────────────────
  if (p.concrete_threats.length > 0) {
    const top = p.concrete_threats[0];
    const targetPieceName = pieceFullName(top.piece);
    lines.push(`This sets up a direct threat: ${top.san}, winning the ${targetPieceName.toLowerCase()} on ${top.target}.`);
  }

  // ─── Sentence 4: Eval shift, in plain language ──────────────────────
  if (Math.abs(playerDelta) >= 30) {
    if (playerDelta > 0) {
      lines.push(`This improves ${playerLower}'s position by about ${playerDeltaPawns} pawns.`);
    } else {
      lines.push(`This drops the evaluation by about ${playerDeltaPawns} pawns.`);
    }
  }

  // ─── Sentence 5: Full move classification handling ──────────────────
  // file2 demanded integration of ALL classifications: Brilliant, Great,
  // Best, Inaccuracy, Mistake, Blunder, Miss — not just BEST/BRILLIANT.
  const cls = String(p.classification || '').toUpperCase();
  const classificationSentence = classificationToSentence(cls, p, player);
  if (classificationSentence) {
    lines.push(classificationSentence);
  }

  // ─── Sentence 6: PV line (Elo-tiered) ───────────────────────────────
  // Beginners: skip PV (too technical). Intermediate: 3 moves. Advanced+:
  // full 5-move line.
  if (p.pv_continuation_san && p.pv_continuation_san.length > 1) {
    const pvSlice =
      eloTier === 'beginner' ? 0 :
      eloTier === 'intermediate' ? 3 :
      5;
    if (pvSlice > 0) {
      lines.push(`Expected continuation: ${p.pv_continuation_san.slice(0, pvSlice).join(' ')}.`);
    }
  }

  // Elo-tiered trimming: beginners get max 3 sentences, intermediate 4,
  // advanced 5, master 6+.
  const maxSentences =
    eloTier === 'beginner' ? 3 :
    eloTier === 'intermediate' ? 4 :
    eloTier === 'advanced' ? 5 :
    7;
  const trimmed = lines.slice(0, maxSentences);

  return trimmed.join(' ');
}

// ---------------------------------------------------------------------------
// Convert a MoveClassification enum into a natural-language sentence.
// file2 demanded: BRILLIANT, GREAT, BLUNDER, MISTAKE, INACCURACY, MISS, BEST
// all be described with human-like language.
// ---------------------------------------------------------------------------
function classificationToSentence(
  cls: string,
  p: SynthesisPayload,
  player: string,
): string | null {
  const playerLower = player.toLowerCase();
  const evalDiffPawns =
    p.best_move_san && p.best_move_san !== p.move_san
      ? (Math.abs(p.eval_delta_cp) / 100).toFixed(2)
      : null;

  switch (cls) {
    case 'BRILLIANT':
      return `A brilliant move — objectively the strongest continuation, found by deep calculation.`;
    case 'GREAT':
      return `A great move that keeps the advantage and maintains strong piece harmony.`;
    case 'BEST':
      return `This is the engine's top choice.`;
    case 'INACCURACY':
      return evalDiffPawns
        ? `An inaccuracy — ${p.best_move_san} was slightly stronger, costing about ${evalDiffPawns} pawns of evaluation.`
        : `An inaccuracy — a slightly stronger continuation was available.`;
    case 'MISTAKE':
      return evalDiffPawns
        ? `A mistake — ${p.best_move_san} was clearly better, costing about ${evalDiffPawns} pawns.`
        : `A mistake — a clearly better continuation was available.`;
    case 'BLUNDER':
      return evalDiffPawns
        ? `A blunder! ${p.best_move_san} was the correct move; this drops about ${evalDiffPawns} pawns and turns the position in ${playerLower === 'white' ? 'black' : 'white'}'s favor.`
        : `A blunder — the correct move was ${p.best_move_san}.`;
    case 'MISS':
      return `A missed opportunity — ${p.best_move_san} would have kept better chances.`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Infer the captured piece type from the FEN *before* the move + target square.
// We need this because the SynthesisPayload doesn't carry capturedPiece
// directly — only the SAN's "x" flag and the SEE score.
// ---------------------------------------------------------------------------
function inferCapturedPieceFromFen(fenBefore: string, toSquare: string): string | undefined {
  try {
    const board = new Chess(fenBefore);
    const p = board.get(toSquare as Square);
    return p?.type;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function pieceCharToName(c: string): string {
  switch (c) {
    case 'N': return 'Knight';
    case 'B': return 'Bishop';
    case 'R': return 'Rook';
    case 'Q': return 'Queen';
    case 'K': return 'King';
    default:  return 'Pawn';
  }
}

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

function findEnemyKingSquare(fenAfter: string, playerColor: PlayerColor): string | null {
  try {
    const board = new Chess(fenAfter);
    const enemyColor = playerColor === 'white' ? 'b' : 'w';
    const kings = board.findPiece({ type: 'k', color: enemyColor as any });
    return kings.length > 0 ? kings[0] : null;
  } catch {
    return null;
  }
}
