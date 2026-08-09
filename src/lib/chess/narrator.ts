// Narrative generator — uses the z-ai-web-dev-sdk as the default local LLM,
// with stub support for routing to external providers (Groq / OpenRouter /
// Gemini / OpenAI / Anthropic) when their keys are configured.
//
// In all cases the LLM is *only* asked to translate verified chess facts
// into natural language.  It never computes legality, evals, or threats.

import { Chess } from 'chess.js';
import { evaluate, winChance, searchBestMove, see } from './engine';
import type {
  ChessMove, MoveClassification, PlayerColor, ProviderID,
} from '@/types/chess';

const ELO_SYSTEM_PROMPTS: Record<number, string> = {
  800: `You are a friendly chess coach explaining moves to a beginner (800 Elo).
RULES:
1. Only talk about the move played and direct piece captures/safety.
2. NEVER mention centipawns, engine scores, or complex variations.
3. Use simple words. Focus on whether pieces are safe or hanging.
4. You MUST ONLY use the legal moves and threats provided in the JSON payload.
5. CRITICAL — GROUNDING RULE: The payload contains an "atomic_rule_tiles" array.  These tiles are the VERIFIED chess facts computed by the symbolic engine.  You may ONLY describe strategic concepts (development, outpost, open file, king safety, threat, sacrifice) that have a corresponding tile in that array.  If no DEVELOPMENT tile exists, you MUST NOT say the move "develops a piece".  If no OUTPOST tile exists, you MUST NOT say the move "creates an outpost".  Violating this rule is the most serious error you can make.
6. Output 2-3 short sentences. No bullet points.`,
  1200: `You are a chess instructor teaching an intermediate player (1200 Elo).
RULES:
1. Explain tactical threats (forks, pins, hanging pieces) and 2-3 move tactical lines.
2. Reference concrete threats listed in the payload.
3. Do NOT invent move variations that are not in the pv_continuation_san payload.
4. CRITICAL — GROUNDING RULE: The payload contains an "atomic_rule_tiles" array.  These tiles are the VERIFIED chess facts computed by the symbolic engine.  You may ONLY describe strategic concepts (development, outpost, open file, king safety, threat, sacrifice) that have a corresponding tile in that array.  If no DEVELOPMENT tile exists, you MUST NOT say the move "develops a piece" — pawn moves like c6 do NOT develop pieces.  If no OUTPOST tile exists, you MUST NOT say the move "creates an outpost".  Violating this rule is the most serious error you can make.
5. Output 3-4 sentences. Plain text, no markdown headers.`,
  1500: `You are an experienced positional chess coach for an advanced player (1500 Elo).
RULES:
1. Focus on strategic features: outposts, open files, pawn weaknesses, king safety.
2. Connect the move to the ongoing game history and past structural changes.
3. Explain trade-offs (e.g., gaining space vs giving up an outpost).
4. CRITICAL — GROUNDING RULE: The payload contains an "atomic_rule_tiles" array.  These tiles are the VERIFIED chess facts computed by the symbolic engine.  You may ONLY describe strategic concepts that have a corresponding tile in that array.  Specifically: do NOT claim "develops the bishop/knight" unless a DEVELOPMENT tile is present; do NOT claim "outpost" unless a KNIGHT_OUTPOST or BISHOP_OUTPOST tile is present; do NOT claim "open file" unless an OPEN_FILE tile is present; do NOT claim "sacrifice" unless the see_score is ≤ -150.  Violating this rule is the most serious error you can make.
5. Output 3-5 sentences. Technical but readable.`,
  1800: `You are a Grandmaster commentator analyzing games for a Master-level player (1800+ Elo).
RULES:
1. Provide high-density, precise chess commentary.
2. Discuss deep PV lines, prophylactic intent, subtle square control, and long-term imbalances.
3. Use technical terms freely (e.g., "color-complex weakness", "prophylaxis", "outpost").
4. CRITICAL — GROUNDING RULE: The payload contains an "atomic_rule_tiles" array.  These tiles are the VERIFIED chess facts computed by the symbolic engine.  You may ONLY describe strategic concepts that have a corresponding tile in that array.  Specifically: do NOT claim "develops the bishop/knight" unless a DEVELOPMENT tile is present; do NOT claim "outpost" unless a KNIGHT_OUTPOST or BISHOP_OUTPOST tile is present; do NOT claim "open file" unless an OPEN_FILE tile is present; do NOT claim "sacrifice" unless the see_score is ≤ -150.  Violating this rule is the most serious error you can make.
5. Output 4-6 sentences. Dense, GM-level.`,
};

function systemPromptFor(elo: number): string {
  // Pick the closest tier
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
  // Delta from player perspective: positive = good for player
  const playerSign = playerColor === 'white' ? 1 : -1;
  const deltaW = (wcAfter - wcBefore) * playerSign;

  const best = searchBestMove(fenBefore, 1);  // shallow for speed
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

  // Detect concrete threats via null-move search (simplified)
  const threats: Array<{ san: string; gain_cp: number; target: string; piece: string }> = [];
  if (!isCheckmate && !chessAfter.isStalemate()) {
    try {
      const tmpBoard = new Chess(chessAfter.fen());
      // Try null-move (pass turn) — chess.js doesn't support null moves directly,
      // so we manually toggle the side-to-move bit via FEN.
      const fenParts = chessAfter.fen().split(' ');
      fenParts[1] = fenParts[1] === 'w' ? 'b' : 'w';
      fenParts[3] = '-';  // clear en-passant
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
// External providers route to /api/v1/llm/generate which forwards appropriately.
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
  // Otherwise, fall back to the z-ai-web-dev-sdk local LLM.
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
      // Fall through to local LLM
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

  // Last-resort: deterministic template
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

// ---------------------------------------------------------------------------
// Deterministic template-based narrative (last-resort fallback).
// Builds a readable explanation purely from the payload — no LLM required.
// ---------------------------------------------------------------------------
function templateNarrative(p: SynthesisPayload): string {
  const lines: string[] = [];
  const player = p.player_color === 'white' ? 'White' : 'Black';
  const evalDelta = p.eval_delta_cp * (p.player_color === 'white' ? 1 : -1);
  const sign = evalDelta >= 0 ? '+' : '';

  // Headline
  if (p.is_checkmate) {
    lines.push(`${player} delivers checkmate with ${p.move_san}.`);
  } else if (p.is_check) {
    lines.push(`${player} plays ${p.move_san}, giving check.`);
  } else if (p.is_capture) {
    lines.push(`${player} captures with ${p.move_san} (SEE = ${p.see_score >= 0 ? '+' : ''}${p.see_score} cp).`);
  } else {
    lines.push(`${player} plays ${p.move_san}.`);
  }

  // Eval shift
  if (Math.abs(evalDelta) >= 10) {
    const dir = evalDelta > 0 ? 'improves' : 'worsens';
    lines.push(`Evaluation ${dir} by ${sign}${evalDelta} cp (from ${p.eval_cp_before} to ${p.eval_cp_after}).`);
  }

  // Threats
  if (p.concrete_threats.length > 0) {
    const top = p.concrete_threats[0];
    lines.push(`Creates a concrete threat: ${top.san} winning ${top.gain_cp} cp on the ${top.piece} at ${top.target}.`);
  }

  // PV
  if (p.pv_continuation_san.length > 0) {
    const pv = p.pv_continuation_san.slice(0, 5).join(' ');
    lines.push(`Principal variation: ${pv}.`);
  }

  // Classification context
  const cls = p.classification.toLowerCase();
  if (cls === 'brilliant') {
    lines.push(`A brilliant sacrifice — objectively strong despite the material give-up.`);
  } else if (cls === 'blunder') {
    lines.push(`Marked as a blunder — a stronger continuation was available (${p.best_move_san}).`);
  } else if (cls === 'best') {
    lines.push(`This is the engine's top choice.`);
  }

  return lines.join(' ');
}
