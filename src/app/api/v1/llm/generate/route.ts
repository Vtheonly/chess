// Multi-provider LLM gateway route — dispatches to the configured external provider.
// Reads API key from custom headers (per spec §4.2).

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface RequestBody {
  payload: any;
  systemPrompt: string;
}

const PROVIDER_ENDPOINTS: Record<string, { url: string; authPrefix: string }> = {
  groq:          { url: 'https://api.groq.com/openai/v1/chat/completions',                                authPrefix: 'Bearer ' },
  openrouter:    { url: 'https://openrouter.ai/api/v1/chat/completions',                                 authPrefix: 'Bearer ' },
  openai:        { url: 'https://api.openai.com/v1/chat/completions',                                    authPrefix: 'Bearer ' },
  anthropic:     { url: 'https://api.anthropic.com/v1/messages',                                         authPrefix: 'x-api-key' },
  google_gemini: { url: '', authPrefix: '' },  // Gemini uses URL-embedded key
};

export async function POST(req: NextRequest) {
  try {
    const provider = req.headers.get('X-Caissa-Provider') as keyof typeof PROVIDER_ENDPOINTS | null;
    const model = req.headers.get('X-Caissa-Model') || '';
    const body: RequestBody = await req.json();

    if (!provider) {
      return NextResponse.json({ error: 'Missing X-Caissa-Provider header' }, { status: 400 });
    }

    // Extract the API key from the appropriate header
    const apiKey = extractApiKey(req, provider);
    if (!apiKey) {
      return NextResponse.json({ error: `Missing API key for ${provider}` }, { status: 401 });
    }

    const userContent = `${body.systemPrompt}\n\nCHESS PAYLOAD:\n${JSON.stringify(body.payload, null, 2)}\n\nGenerate commentary:`;
    const start = Date.now();

    let commentary: string;
    if (provider === 'google_gemini') {
      commentary = await callGemini(apiKey, model, userContent);
    } else if (provider === 'anthropic') {
      commentary = await callAnthropic(apiKey, model, userContent);
    } else {
      // OpenAI-compatible: groq, openrouter, openai
      commentary = await callOpenAICompatible(PROVIDER_ENDPOINTS[provider].url, apiKey, model, userContent, provider);
    }

    const latencyMs = Date.now() - start;
    return NextResponse.json({ commentary, latencyMs });
  } catch (err: any) {
    console.error('LLM gateway error:', err);
    const status = err.status || 500;
    return NextResponse.json(
      { error: err.message || 'LLM gateway failed' },
      { status },
    );
  }
}

function extractApiKey(req: NextRequest, provider: string): string | null {
  const suffix = provider === 'google_gemini' ? 'Gemini'
               : provider === 'openrouter'   ? 'OpenRouter'
               : provider === 'openai'       ? 'Openai'
               : provider.charAt(0).toUpperCase() + provider.slice(1);
  return req.headers.get(`X-Caissa-ApiKey-${suffix}`);
}

async function callOpenAICompatible(url: string, apiKey: string, model: string, userContent: string, provider: string): Promise<string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://caissaxai.com';
    headers['X-Title'] = 'CaissaXAI Chess Engine';
  }

  // Reasoning models (deepseek-r1, o1/o3/o4, gpt-oss, kimi, qwq, qwen3-*)
  // reject `response_format` and `temperature != 1`, and need higher
  // max_tokens for their thinking phase.
  const isReasoningModel =
    /deepseek-r1|deepseek-v3\.2|o1|o3|o4|gpt-oss|kimi|qwq|qwen3-coder|qwen3-|reasoning/i.test(model);

  const reqBody: Record<string, any> = {
    model,
    messages: [
      { role: 'system', content: 'You are a chess commentary generator. Output ONLY natural-language commentary text, no JSON, no thinking tags.' },
      { role: 'user', content: userContent },
    ],
    max_tokens: isReasoningModel ? 2048 : 600,
  };
  if (!isReasoningModel) {
    reqBody.temperature = 0.4;
    reqBody.response_format = { type: 'text' };
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(reqBody),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    const err: any = new Error(`${provider} API ${resp.status}: ${errText.slice(0, 400)}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  // Reasoning models may put their final answer in message.content (OpenAI style)
  // or in message.reasoning (some providers). Discard thinking.
  const choice = data.choices?.[0];
  return choice?.message?.content?.trim() ||
         choice?.message?.reasoning?.trim() ||
         choice?.text?.trim() ||
         '';
}

async function callAnthropic(apiKey: string, model: string, userContent: string): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system: 'You are a chess commentary generator. Output ONLY natural-language commentary text.',
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    const err: any = new Error(`Anthropic API ${resp.status}: ${errText.slice(0, 400)}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  // Anthropic returns content as an array of blocks (text, thinking, etc).
  // Concatenate all text blocks and discard thinking.
  const textBlocks = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text);
  return textBlocks.join(' ').trim();
}

async function callGemini(apiKey: string, model: string, userContent: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: userContent }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 600, responseMimeType: 'text/plain' },
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    const err: any = new Error(`Gemini API ${resp.status}: ${errText.slice(0, 400)}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}
