// CaissaXAI chess type system — mirrors the spec's TypeScript interfaces
// (§3.2 GameStoreState, §9.1 WebSocket messages, §4.2 MoveClassification)

export type GameMode = 'HUMAN_VS_AI' | 'SIMULATE' | 'IMPORT_REVIEW';

export type PlayerColor = 'white' | 'black';

export type MoveClassification =
  | 'BRILLIANT'
  | 'GREAT'
  | 'BEST'
  | 'EXCELLENT'
  | 'GOOD'
  | 'BOOK'
  | 'INACCURACY'
  | 'MISTAKE'
  | 'BLUNDER'
  | 'MISS';

export type EvalType = 'cp' | 'mate';

export interface ChessMove {
  ply: number;
  moveNumber: number;
  turn: PlayerColor;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  evalCp: number;        // normalized centipawns from White's perspective
  evalType: EvalType;
  winChance: number;     // [0,1] from White's perspective
  bestMoveSan?: string;
  classification?: MoveClassification;
  commentary?: string;
  arrows?: Array<[string, string, string]>; // [from, to, color]
  highlights?: Array<[string, string]>;      // [square, color]
  seeScore?: number;
  isCapture?: boolean;
  isCheck?: boolean;
  isCheckmate?: boolean;
  concreteThreats?: Array<{ san: string; gainCp: number; target: string; piece: string }>;
}

export interface GameReviewSummary {
  whiteAccuracy: number;
  blackAccuracy: number;
  totalPlies: number;
  counts: Record<MoveClassification, number>;
}

export type ProviderID = 'groq' | 'openrouter' | 'google_gemini' | 'openai' | 'anthropic';

export interface ProviderConfig {
  apiKey: string;
  selectedModel: string;
  status: 'UNTESTED' | 'TESTING' | 'HEALTHY' | 'ERROR';
  latencyMs?: number;
  errorMessage?: string;
}

export interface ProviderHealthResult {
  providerId: ProviderID;
  modelName: string;
  status: 'SUCCESS' | 'INVALID_KEY' | 'RATE_LIMITED' | 'SCHEMA_ERROR' | 'HALLUCINATION_DETECTED' | 'TIMEOUT';
  latencyMs: number;
  errorMessage?: string;
  sampleNarrative?: string;
  testedAt: string;
}

export const PROVIDER_META: Record<ProviderID, { label: string; models: string[]; placeholder: string; emoji: string }> = {
  groq: {
    label: 'Groq',
    models: ['llama-3.1-70b-versatile', 'mixtral-8x7b-32768', 'llama-3.3-70b-versatile'],
    placeholder: 'gsk_••••••••••••••••••••••••',
    emoji: '⚡',
  },
  openrouter: {
    label: 'OpenRouter',
    models: ['anthropic/claude-3.5-sonnet', 'deepseek/deepseek-r1', 'meta-llama/llama-3.1-70b-instruct'],
    placeholder: 'sk-or-v1-••••••••••••••••••',
    emoji: '🌐',
  },
  google_gemini: {
    label: 'Google AI Studio',
    models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'],
    placeholder: 'AIzaSy••••••••••••••••••••',
    emoji: '💎',
  },
  openai: {
    label: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    placeholder: 'sk-••••••••••••••••••••••',
    emoji: '🧠',
  },
  anthropic: {
    label: 'Anthropic',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
    placeholder: 'sk-ant-••••••••••••••••••',
    emoji: '🎭',
  },
};

export const ARROW_COLORS = {
  BEST_MOVE: 'rgba(34, 197, 94, 0.85)',     // green
  CONCRETE_THREAT: 'rgba(239, 68, 68, 0.85)', // red
  ALT_VARIATION: 'rgba(245, 158, 11, 0.75)', // amber
  PROPHYLAXIS: 'rgba(168, 85, 247, 0.80)',   // purple
} as const;

export const CLASSIFICATION_META: Record<MoveClassification, { label: string; color: string; bg: string; symbol: string }> = {
  BRILLIANT:    { label: 'Brilliant',    color: '#10B981', bg: 'rgba(16,185,129,0.15)', symbol: '!!' },
  GREAT:        { label: 'Great',        color: '#3B82F6', bg: 'rgba(59,130,246,0.15)', symbol: '!'  },
  BEST:         { label: 'Best',         color: '#22C55E', bg: 'rgba(34,197,94,0.15)',  symbol: '★'  },
  EXCELLENT:    { label: 'Excellent',    color: '#22C55E', bg: 'rgba(34,197,94,0.10)',  symbol: '✓'  },
  GOOD:         { label: 'Good',         color: '#84CC16', bg: 'rgba(132,204,22,0.10)', symbol: '✓'  },
  BOOK:         { label: 'Book',         color: '#A3A3A3', bg: 'rgba(163,163,163,0.15)', symbol: 'éc' },
  INACCURACY:   { label: 'Inaccuracy',   color: '#F59E0B', bg: 'rgba(245,158,11,0.15)', symbol: '?!' },
  MISTAKE:      { label: 'Mistake',      color: '#F97316', bg: 'rgba(249,115,22,0.15)', symbol: '?'  },
  BLUNDER:      { label: 'Blunder',      color: '#EF4444', bg: 'rgba(239,68,68,0.15)',  symbol: '??' },
  MISS:         { label: 'Miss',         color: '#EF4444', bg: 'rgba(239,68,68,0.10)',  symbol: '×'  },
};
