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
  isGeneratingCommentary?: boolean;
  arrows?: Array<[string, string, string]>; // [from, to, color]
  highlights?: Array<[string, string]>;      // [square, color]
  seeScore?: number;
  isCapture?: boolean;
  isCheck?: boolean;
  isCheckmate?: boolean;
  concreteThreats?: Array<{ san: string; gainCp: number; target: string; piece: string }>;
  // ─── Dual-View payload (spec §1) ──────────────────────────────────────────
  atomicRuleTiles?: AtomicRuleTile[];
  calculationBreakdown?: CalculationBreakdown;
}

// ─── Dual-View types (spec §1.1, §1.2) ────────────────────────────────────────

export type RuleCategory =
  | 'material'
  | 'tactics'
  | 'piece_activity'
  | 'pawn_structure'
  | 'king_safety'
  | 'space_center'
  | 'prophylaxis';

export type ImportanceTier = 'PRIMARY' | 'SECONDARY' | 'MINOR';

export interface AtomicRuleTile {
  ruleId: string;                       // e.g. "KNIGHT_OUTPOST"
  ruleName: string;                     // e.g. "Knight Outpost"
  category: RuleCategory;
  rawDeltaCp: number;                   // pre-phase-weight centipawns
  weightedPointsCp: number;             // final points added to eval
  principleSummary: string;             // one-sentence chess principle
  highlightSquares: string[];           // e.g. ["e5", "d4"]
  arrowVectors: Array<[string, string, string]>; // [from, to, color]
  importanceTier: ImportanceTier;
}

export interface RulePointCalculationItem {
  ruleName: string;
  baseScoreCp: number;
  phaseWeightMultiplier: number;        // e.g. 0.85 for late-middlegame
  finalPointsCp: number;
}

export interface CalculationBreakdown {
  startEvalCp: number;
  endEvalCp: number;
  netChangeCp: number;
  gamePhaseFactor: number;              // 1.0 = pure MG, 0.0 = pure EG
  whitePositivePoints: number;          // sum of positive rule points
  blackPositivePoints: number;          // sum of negative rule points
  ruleCalculations: RulePointCalculationItem[];
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
  // Groq production models — verified live on console.groq.com/docs/models (Aug 2026).
  // Removed deprecated: mixtral-8x7b-32768, llama-3.1-70b-versatile (sunset), all
  // llama-3.2-* previews, deepseek-r1-distill-* (sunset Sep 2025), qwen-qwq-32b.
  // Current production text models only.
  groq: {
    label: 'Groq',
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3-32b',
    ],
    placeholder: 'gsk_••••••••••••••••••••••••',
    emoji: '',
  },
  // OpenRouter models — verified live via GET https://openrouter.ai/api/v1/models (Aug 2026).
  // Removed: anthropic/claude-3.5-sonnet (no longer in catalog), meta-llama/llama-3.1-70b-instruct
  // (superseded). Current top-tier models from each provider.
  openrouter: {
    label: 'OpenRouter',
    models: [
      'anthropic/claude-sonnet-5',
      'anthropic/claude-opus-5',
      'deepseek/deepseek-v3.2',
      'deepseek/deepseek-r1',
      'meta-llama/llama-3.3-70b-instruct',
      'google/gemini-2.5-flash',
      'qwen/qwen3-coder',
    ],
    placeholder: 'sk-or-v1-••••••••••••••••••',
    emoji: '',
  },
  google_gemini: {
    label: 'Google AI Studio',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    placeholder: 'AIzaSy••••••••••••••••••••',
    emoji: '',
  },
  openai: {
    label: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
    placeholder: 'sk-••••••••••••••••••••••',
    emoji: '',
  },
  anthropic: {
    label: 'Anthropic',
    models: ['claude-sonnet-5-20250514', 'claude-opus-5-20250805', 'claude-3-5-haiku-20241022'],
    placeholder: 'sk-ant-••••••••••••••••••',
    emoji: '',
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
  BEST:         { label: 'Best',         color: '#22C55E', bg: 'rgba(34,197,94,0.15)',  symbol: ''  },
  EXCELLENT:    { label: 'Excellent',    color: '#22C55E', bg: 'rgba(34,197,94,0.10)',  symbol: ''  },
  GOOD:         { label: 'Good',         color: '#84CC16', bg: 'rgba(132,204,22,0.10)', symbol: ''  },
  BOOK:         { label: 'Book',         color: '#A3A3A3', bg: 'rgba(163,163,163,0.15)', symbol: 'éc' },
  INACCURACY:   { label: 'Inaccuracy',   color: '#F59E0B', bg: 'rgba(245,158,11,0.15)', symbol: '?!' },
  MISTAKE:      { label: 'Mistake',      color: '#F97316', bg: 'rgba(249,115,22,0.15)', symbol: '?'  },
  BLUNDER:      { label: 'Blunder',      color: '#EF4444', bg: 'rgba(239,68,68,0.15)',  symbol: '??' },
  MISS:         { label: 'Miss',         color: '#EF4444', bg: 'rgba(239,68,68,0.10)',  symbol: '×'  },
};

// ─── Rule tile metadata (spec §3.1 RULE_METADATA) ────────────────────────────
export const RULE_CATEGORY_META: Record<RuleCategory, { label: string; icon: string; color: string; bg: string }> = {
  material:       { label: 'Material',       icon: '',  color: '#A78BFA', bg: 'rgba(167,139,250,0.15)' },
  tactics:        { label: 'Tactics',        icon: '', color: '#F87171', bg: 'rgba(248,113,113,0.15)' },
  piece_activity: { label: 'Piece Activity', icon: '',  color: '#60A5FA', bg: 'rgba(96,165,250,0.15)' },
  pawn_structure: { label: 'Pawn Structure', icon: '',  color: '#FBBF24', bg: 'rgba(251,191,36,0.15)' },
  king_safety:    { label: 'King Safety',    icon: '',  color: '#FB7185', bg: 'rgba(251,113,133,0.15)' },
  space_center:   { label: 'Space / Center', icon: '', color: '#34D399', bg: 'rgba(52,211,153,0.15)' },
  prophylaxis:    { label: 'Prophylaxis',    icon: '', color: '#C084FC', bg: 'rgba(192,132,252,0.15)' },
};

export const TIER_META: Record<ImportanceTier, { label: string; glow: string; weight: string }> = {
  PRIMARY:   { label: 'Primary',   glow: 'rgba(251, 191, 36, 0.55)', weight: 'bold' },
  SECONDARY: { label: 'Secondary', glow: 'rgba(148, 163, 184, 0.30)', weight: 'normal' },
  MINOR:     { label: 'Minor',     glow: 'rgba(100, 116, 139, 0.15)', weight: 'normal' },
};
