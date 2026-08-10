// Comprehensive 50+ Concept Taxonomy for Deep Chess Analysis.
// This catalog covers tactical motifs, positional principles, pawn structure,
// king safety, piece harmony, space/center, material, and calculation.
//
// Used by:
//   • positionAssessor.ts — to label strengths/weaknesses on the board
//   • contrastiveAnalyzer.ts — to compare played vs best move
//   • The UI — to render concept icons and descriptions

export type ConceptCategory =
  | 'tactics'
  | 'positional'
  | 'pawn_structure'
  | 'king_safety'
  | 'piece_harmony'
  | 'material'
  | 'endgame'
  | 'calculation';

export interface ConceptDefinition {
  id: string;
  name: string;
  category: ConceptCategory;
  icon: string;
  description: string;
  weightCp: number;
}

export const CONCEPT_TAXONOMY: Record<string, ConceptDefinition> = {
  // ─── TACTICAL MOTIFS ───────────────────────────────────────────────────
  FORK: {
    id: 'FORK', name: 'Fork (Double Attack)', category: 'tactics', icon: '⚔️',
    description: 'A single piece attacks two or more enemy pieces simultaneously.',
    weightCp: 80,
  },
  PIN: {
    id: 'PIN', name: 'Pin', category: 'tactics', icon: '📍',
    description: 'An attacked piece cannot move without exposing a more valuable piece behind it.',
    weightCp: 60,
  },
  SKEWER: {
    id: 'SKEWER', name: 'Skewer', category: 'tactics', icon: '🗡️',
    description: 'A valuable piece is forced to move, exposing a lesser piece behind it to capture.',
    weightCp: 70,
  },
  DISCOVERED_ATTACK: {
    id: 'DISCOVERED_ATTACK', name: 'Discovered Attack', category: 'tactics', icon: '👁️',
    description: 'Moving a piece reveals a hidden attack from a long-range slider behind it.',
    weightCp: 75,
  },
  DOUBLE_CHECK: {
    id: 'DOUBLE_CHECK', name: 'Double Check', category: 'tactics', icon: '⚡',
    description: 'The enemy king is attacked by two pieces at once; only a king move can escape.',
    weightCp: 100,
  },
  DEFLECTION: {
    id: 'DEFLECTION', name: 'Deflection / Decoy', category: 'tactics', icon: '🪤',
    description: 'Luring an enemy defender away from a critical square or piece.',
    weightCp: 65,
  },
  OVERLOADED_DEFENDER: {
    id: 'OVERLOADED_DEFENDER', name: 'Overloaded Defender', category: 'tactics', icon: '⚖️',
    description: 'A piece is forced to defend two targets at once and cannot maintain both.',
    weightCp: 55,
  },
  INTERFERENCE: {
    id: 'INTERFERENCE', name: 'Interference', category: 'tactics', icon: '🚧',
    description: 'Placing a piece between two enemy pieces to break their line of communication.',
    weightCp: 50,
  },
  X_RAY_ATTACK: {
    id: 'X_RAY_ATTACK', name: 'X-Ray Control', category: 'tactics', icon: '🔬',
    description: 'A long-range piece attacks a square or piece through an intervening piece.',
    weightCp: 40,
  },
  TRAPPED_PIECE: {
    id: 'TRAPPED_PIECE', name: 'Trapped Piece', category: 'tactics', icon: '🪤',
    description: 'A piece has no safe escape squares and can be targeted and won.',
    weightCp: 90,
  },
  BACK_RANK_WEAKNESS: {
    id: 'BACK_RANK_WEAKNESS', name: 'Back Rank Mate Vulnerability', category: 'tactics', icon: '👑',
    description: 'The king is trapped on its home rank by its own pawns without a flight square.',
    weightCp: 85,
  },
  HANGING_PIECE: {
    id: 'HANGING_PIECE', name: 'Hanging (Undefended) Piece', category: 'tactics', icon: '🎯',
    description: 'A piece is completely undefended and subject to immediate capture.',
    weightCp: 100,
  },

  // ─── POSITIONAL & STRATEGIC PRINCIPLES ─────────────────────────────────
  KNIGHT_OUTPOST: {
    id: 'KNIGHT_OUTPOST', name: 'Knight Outpost', category: 'positional', icon: '♞',
    description: 'A knight stationed on a central square defended by a pawn and unchallengeable by enemy pawns.',
    weightCp: 45,
  },
  BISHOP_OUTPOST: {
    id: 'BISHOP_OUTPOST', name: 'Bishop Outpost', category: 'positional', icon: '♝',
    description: 'A bishop anchored on an advanced square, exerting long-range diagonal pressure.',
    weightCp: 35,
  },
  BAD_BISHOP: {
    id: 'BAD_BISHOP', name: 'Bad Bishop', category: 'positional', icon: '♝',
    description: 'A bishop hemmed in by its own pawns fixed on the same color complex.',
    weightCp: -35,
  },
  BISHOP_PAIR: {
    id: 'BISHOP_PAIR', name: 'Bishop Pair Advantage', category: 'positional', icon: '♝♝',
    description: 'Possessing both bishops allows control of all light and dark squares across the board.',
    weightCp: 50,
  },
  ROOK_ON_7TH: {
    id: 'ROOK_ON_7TH', name: 'Rook on 7th Rank', category: 'positional', icon: '♜',
    description: 'A rook on the 7th rank (2nd for Black) cuts off the enemy king and sweeps unadvanced pawns.',
    weightCp: 50,
  },
  OPEN_FILE: {
    id: 'OPEN_FILE', name: 'Open File Control', category: 'positional', icon: '♜',
    description: 'Occupying a file with no pawns of either color gives rooks unrestricted mobility.',
    weightCp: 35,
  },
  SEMI_OPEN_FILE: {
    id: 'SEMI_OPEN_FILE', name: 'Semi-Open File Control', category: 'positional', icon: '♜',
    description: 'A file with no friendly pawns allows rooks to pressure enemy pawns directly.',
    weightCp: 20,
  },
  WEAK_SQUARE_COMPLEX: {
    id: 'WEAK_SQUARE_COMPLEX', name: 'Weak Square Complex', category: 'positional', icon: '⬛',
    description: 'A color complex (light or dark) lacking pawn protection, creating invadable holes.',
    weightCp: -40,
  },
  PROPHYLAXIS: {
    id: 'PROPHYLAXIS', name: 'Prophylaxis (Preventive Defense)', category: 'positional', icon: '🛑',
    description: 'A move made specifically to prevent an active plan or break by the opponent.',
    weightCp: 30,
  },
  PIECE_COORDINATION: {
    id: 'PIECE_COORDINATION', name: 'Piece Coordination & Battery', category: 'piece_harmony', icon: '🔋',
    description: 'Two or more pieces lined up on the same file or diagonal working together.',
    weightCp: 40,
  },
  DEVELOPMENT_LEAD: {
    id: 'DEVELOPMENT_LEAD', name: 'Development Lead', category: 'piece_harmony', icon: '🚀',
    description: 'Having more minor and major pieces active in the opening phase than the opponent.',
    weightCp: 30,
  },

  // ─── PAWN STRUCTURE ────────────────────────────────────────────────────
  PASSED_PAWN: {
    id: 'PASSED_PAWN', name: 'Passed Pawn', category: 'pawn_structure', icon: '♟',
    description: 'A pawn with no opposing pawns ahead on its file or adjacent files.',
    weightCp: 55,
  },
  ISOLATED_PAWN: {
    id: 'ISOLATED_PAWN', name: 'Isolated Pawn', category: 'pawn_structure', icon: '♟',
    description: 'A pawn with no friendly pawns on adjacent files to defend it.',
    weightCp: -25,
  },
  DOUBLED_PAWNS: {
    id: 'DOUBLED_PAWNS', name: 'Doubled Pawns', category: 'pawn_structure', icon: '♟♟',
    description: 'Two pawns of the same color on the same file blocking each other.',
    weightCp: -20,
  },
  BACKWARD_PAWN: {
    id: 'BACKWARD_PAWN', name: 'Backward Pawn', category: 'pawn_structure', icon: '♟',
    description: 'A pawn behind its neighbor pawns that cannot advance safely.',
    weightCp: -30,
  },
  PAWN_ISLANDS: {
    id: 'PAWN_ISLANDS', name: 'Pawn Island Multiplicity', category: 'pawn_structure', icon: '🏝️',
    description: 'Having multiple separate groups of pawns creates more targets to defend.',
    weightCp: -15,
  },
  PAWN_CHAIN_BASE: {
    id: 'PAWN_CHAIN_BASE', name: 'Pawn Chain Base', category: 'pawn_structure', icon: '🔗',
    description: 'The root pawn in a diagonal pawn chain; attacking the base destroys the whole structure.',
    weightCp: -35,
  },
  PAWN_BREAK: {
    id: 'PAWN_BREAK', name: 'Pawn Break Executed', category: 'pawn_structure', icon: '💥',
    description: 'Advancing a pawn to challenge the enemy pawn center and open lines.',
    weightCp: 35,
  },

  // ─── KING SAFETY ───────────────────────────────────────────────────────
  KING_PAWN_SHIELD: {
    id: 'KING_PAWN_SHIELD', name: 'King Pawn Shield', category: 'king_safety', icon: '🛡️',
    description: 'Pawns directly in front of the castled king providing a protective wall.',
    weightCp: 50,
  },
  KING_PAWN_STORM: {
    id: 'KING_PAWN_STORM', name: 'Pawn Storm Underway', category: 'king_safety', icon: '🌪️',
    description: 'Enemy pawns advancing aggressively toward the king zone to rip open files.',
    weightCp: -60,
  },
  KING_EXPOSURE: {
    id: 'KING_EXPOSURE', name: 'Exposed King', category: 'king_safety', icon: '♚',
    description: 'A king lacking pawn protection or stuck in the center during the middlegame.',
    weightCp: -70,
  },
  KING_TROPISM: {
    id: 'KING_TROPISM', name: 'Enemy Piece Proximity (Tropism)', category: 'king_safety', icon: '🎯',
    description: 'Enemy heavy pieces concentrated in close proximity to the king zone.',
    weightCp: -50,
  },

  // ─── SPACE & CENTER ────────────────────────────────────────────────────
  CENTER_CONTROL: {
    id: 'CENTER_CONTROL', name: 'Center Control', category: 'positional', icon: '🌐',
    description: 'Control and influence over the key central squares d4, d5, e4, e5.',
    weightCp: 30,
  },
  SPACE_ADVANTAGE: {
    id: 'SPACE_ADVANTAGE', name: 'Space Advantage', category: 'positional', icon: '📐',
    description: 'Controlling more squares behind enemy lines restricts their piece coordination.',
    weightCp: 25,
  },

  // ─── MATERIAL & CALCULATION ────────────────────────────────────────────
  MATERIAL_ADVANTAGE: {
    id: 'MATERIAL_ADVANTAGE', name: 'Material Advantage', category: 'material', icon: '💎',
    description: 'Possessing a net surplus of piece or pawn value.',
    weightCp: 100,
  },
  PURE_CALCULATION: {
    id: 'PURE_CALCULATION', name: 'Deep Calculation Line (PV-Driven)', category: 'calculation', icon: '🧮',
    description: 'Driven by Stockfish concrete tactical calculation rather than a static rule.',
    weightCp: 50,
  },
};

export const CONCEPT_CATEGORY_META: Record<ConceptCategory, { label: string; color: string }> = {
  tactics:         { label: 'Tactics',         color: '#F87171' },
  positional:      { label: 'Positional',      color: '#60A5FA' },
  pawn_structure:  { label: 'Pawn Structure',  color: '#FBBF24' },
  king_safety:     { label: 'King Safety',     color: '#FB7185' },
  piece_harmony:   { label: 'Piece Harmony',   color: '#A78BFA' },
  material:        { label: 'Material',        color: '#34D399' },
  endgame:         { label: 'Endgame',         color: '#94A3B8' },
  calculation:     { label: 'Calculation',     color: '#C084FC' },
};
