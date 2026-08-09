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

    const userContent = `You are generating chess commentary for a single move.

SYSTEM PROMPT:
${systemPrompt}

CHESS PAYLOAD (JSON):
${JSON.stringify(payload, null, 2)}

Generate natural-language commentary following the system prompt rules. Output ONLY the commentary text, no JSON wrapping, no markdown headers.`;

    // Use the z-ai-web-dev-sdk to generate commentary
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a chess commentary generator. Output ONLY natural-language commentary text, no JSON.' },
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
