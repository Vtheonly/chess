// Local LLM route — uses z-ai-web-dev-sdk as a default always-available narrator.
//
// Design:
//   • Tries the ZAI chat-completion with a tile-grounded prompt.
//   • On ANY failure (network, rate-limit, malformed response, empty content),
//     returns HTTP 200 with { commentary: '', fallback: true } so the client
//     silently falls through to the chess-literate templateNarrative in
//     narrator.ts. We intentionally never return 500 here, because a 500
//     would surface as a console error and break the UX even though the
//     fallback is perfectly good.

import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface RequestBody {
  payload: any;
  systemPrompt: string;
}

export async function POST(req: NextRequest) {
  const { payload, systemPrompt }: RequestBody = await req.json().catch(() => ({ payload: {}, systemPrompt: '' }));

  try {
    // Build a concise summary of the atomic rule tiles so the LLM can see,
    // at a glance, which strategic concepts are verified true vs. false.
    // This is the grounding context the LLM uses to produce chess-accurate
    // commentary instead of hallucinating.
    const tiles: any[] = (payload as any).atomic_rule_tiles || [];
    const tileSummary = tiles.length === 0
      ? 'NO atomic rule tiles fired for this move. This means: NO development, NO outpost, NO open file, NO sacrifice, NO concrete threat. Do NOT claim any of those concepts in your commentary.'
      : `VERIFIED atomic rule tiles (you may ONLY reference these strategic concepts):\n${
          tiles.map((t: any) => `  • ${t.ruleName}: ${t.weightedPointsCp >= 0 ? '+' : ''}${t.weightedPointsCp}cp — ${t.principleSummary}`).join('\n')
        }\n\nCONSTRAINTS:\n  • Do NOT mention "develops the bishop/knight" unless a "DEVELOPMENT" tile is listed above.\n  • Do NOT mention "outpost" unless a "KNIGHT_OUTPOST" or "BISHOP_OUTPOST" tile is listed above.\n  • Do NOT mention "open file" unless an "OPEN_FILE" tile is listed above.\n  • Do NOT mention "sacrifice" unless see_score ≤ -150.\n  • Pawn moves (e.g. c6, d5, e6) NEVER develop pieces.\n  • Do NOT use robotic phrases like "Evaluation worsens by X cp", "Initiates X", "PV-Driven", or any raw centipawn number.\n  • Do NOT repeat the same boilerplate text across sentences.`;

    // Describe the move in human terms (piece type, squares, capture/check status)
    const moveSan = (payload as any).move_san || '';
    const moveUci = (payload as any).move_uci || '';
    const toSq = moveUci.slice(2, 4);
    const fromSq = moveUci.slice(0, 2);
    const isCapture = (payload as any).is_capture;
    const isCheck = (payload as any).is_check;
    const isCheckmate = (payload as any).is_checkmate;
    const pieceChar = /^[NBRQK]/.test(moveSan) ? moveSan[0] : 'P';

    const moveDescription = `Move context:
  • SAN: ${moveSan}
  • UCI: ${moveUci} (from ${fromSq} to ${toSq})
  • Piece: ${pieceChar === 'P' ? 'pawn' : pieceChar === 'N' ? 'knight' : pieceChar === 'B' ? 'bishop' : pieceChar === 'R' ? 'rook' : pieceChar === 'Q' ? 'queen' : 'king'}
  • Capture: ${isCapture ? 'yes' : 'no'}
  • Check: ${isCheck ? 'yes' : 'no'}
  • Checkmate: ${isCheckmate ? 'yes' : 'no'}`;

    const userContent = `You are generating chess commentary for a single move.

SYSTEM PROMPT:
${systemPrompt}

${moveDescription}

CHESS PAYLOAD (JSON):
${JSON.stringify({
  move_san: moveSan,
  player_color: (payload as any).player_color,
  eval_cp_before: (payload as any).eval_cp_before,
  eval_cp_after: (payload as any).eval_cp_after,
  see_score: (payload as any).see_score,
  best_move_san: (payload as any).best_move_san,
  pv_continuation_san: (payload as any).pv_continuation_san,
  concrete_threats: (payload as any).concrete_threats,
  classification: (payload as any).classification,
}, null, 2)}

${tileSummary}

Generate natural-language commentary following the system prompt rules. Output ONLY the commentary text, no JSON wrapping, no markdown headers. Sound like a human chess coach, not a regex template.`;

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You are a chess commentary generator. Output ONLY natural-language commentary text, no JSON. You MUST ground every strategic claim in the verified atomic rule tiles listed in the user message. Never invent chess facts. Never use robotic template phrases like "Evaluation worsens by" or "Initiates". Sound like a knowledgeable human chess coach.',
        },
        { role: 'user', content: userContent },
      ],
      temperature: 0.5,
      max_tokens: 400,
    });

    const commentary = completion.choices?.[0]?.message?.content?.trim() || '';

    // Empty commentary is a soft-failure: signal the client to fall back
    // to templateNarrative rather than displaying nothing.
    if (!commentary) {
      return NextResponse.json({ commentary: '', fallback: true });
    }

    return NextResponse.json({ commentary });
  } catch (err: any) {
    // NEVER return 500 — the client's templateNarrative fallback is good
    // enough. Log the error server-side for debugging but return 200 with
    // an empty commentary + fallback flag so the client silently falls through.
    console.warn('[local-llm] ZAI call failed, falling back to templateNarrative:', err?.message || err);
    return NextResponse.json({ commentary: '', fallback: true, error: err?.message || 'LLM generation failed' });
  }
}
