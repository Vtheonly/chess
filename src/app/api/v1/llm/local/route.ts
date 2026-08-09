// Local LLM route — uses z-ai-web-dev-sdk as a default always-available narrator.

import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface RequestBody {
  payload: any;
  systemPrompt: string;
}

export async function POST(req: NextRequest) {
  try {
    const { payload, systemPrompt }: RequestBody = await req.json();

    // Build a concise summary of the atomic rule tiles so the LLM can see,
    // at a glance, which strategic concepts are verified true vs. false.
    const tiles = (payload as any).atomic_rule_tiles || [];
    const tileSummary = tiles.length === 0
      ? 'NO atomic rule tiles fired for this move. This means: NO development, NO outpost, NO open file, NO sacrifice, NO concrete threat. Do NOT claim any of those concepts in your commentary.'
      : `VERIFIED atomic rule tiles (you may ONLY reference these strategic concepts):\n${
          tiles.map((t: any) => `  • ${t.ruleName}: ${t.weightedPointsCp >= 0 ? '+' : ''}${t.weightedPointsCp}cp — ${t.principleSummary}`).join('\n')
        }\n\nCONSTRAINTS:\n  • Do NOT mention "develops the bishop/knight" unless a "DEVELOPMENT" tile is listed above.\n  • Do NOT mention "outpost" unless a "KNIGHT_OUTPOST" or "BISHOP_OUTPOST" tile is listed above.\n  • Do NOT mention "open file" unless an "OPEN_FILE" tile is listed above.\n  • Do NOT mention "sacrifice" unless see_score ≤ -150.\n  • Pawn moves (e.g. c6, d5, e6) NEVER develop pieces.`;

    const userContent = `You are generating chess commentary for a single move.

SYSTEM PROMPT:
${systemPrompt}

CHESS PAYLOAD (JSON):
${JSON.stringify({
  move_san: (payload as any).move_san,
  move_uci: (payload as any).move_uci,
  player_color: (payload as any).player_color,
  eval_cp_before: (payload as any).eval_cp_before,
  eval_cp_after: (payload as any).eval_cp_after,
  see_score: (payload as any).see_score,
  is_capture: (payload as any).is_capture,
  is_check: (payload as any).is_check,
  is_checkmate: (payload as any).is_checkmate,
  best_move_san: (payload as any).best_move_san,
  pv_continuation_san: (payload as any).pv_continuation_san,
  concrete_threats: (payload as any).concrete_threats,
}, null, 2)}

${tileSummary}

Generate natural-language commentary following the system prompt rules. Output ONLY the commentary text, no JSON wrapping, no markdown headers.`;

    // Use the z-ai-web-dev-sdk to generate commentary
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a chess commentary generator. Output ONLY natural-language commentary text, no JSON. You MUST ground every strategic claim in the verified atomic rule tiles listed in the user message. Never invent chess facts.' },
        { role: 'user', content: userContent },
      ],
      temperature: 0.4,
      max_tokens: 400,
    });

    const commentary = completion.choices?.[0]?.message?.content?.trim() || '';
    return NextResponse.json({ commentary });
  } catch (err: any) {
    console.error('Local LLM error:', err);
    return NextResponse.json(
      { error: err.message || 'LLM generation failed' },
      { status: 500 },
    );
  }
}
