"""Core constants and exceptions used across the Symbolic Feature Extractor."""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Piece values (centipawns).  Mirror Stockfish's internal material table so
# that SEE / threat scoring lines up with engine conventions.
# ---------------------------------------------------------------------------
PIECE_VALUE_CP: dict[int, int] = {
    # chess.PAWN == 1, KNIGHT == 2, BISHOP == 3, ROOK == 4, QUEEN == 5, KING == 6
    1: 100,
    2: 320,
    3: 330,
    4: 500,
    5: 900,
    6: 20_000,  # King is effectively invaluable; used only as a sentinel.
}

# Convenience exports (chess module uses lowercase enum names).
PAWN_VALUE = PIECE_VALUE_CP[1]
KNIGHT_VALUE = PIECE_VALUE_CP[2]
BISHOP_VALUE = PIECE_VALUE_CP[3]
ROOK_VALUE = PIECE_VALUE_CP[4]
QUEEN_VALUE = PIECE_VALUE_CP[5]
KING_VALUE = PIECE_VALUE_CP[6]

# ---------------------------------------------------------------------------
# Thresholds (centipawns).  Tuned to match the spec's narratives.
# ---------------------------------------------------------------------------
SEE_WINNING_THRESHOLD_CP = 0          # see_value >= 0  → "winning/equal"
SACRIFICE_SEE_THRESHOLD_CP = -150     # see_value <= -150 AND eval stable → sacrifice
EVAL_SPIKE_ABS_CP = 100               # |Δeval| >= 100cp → major spike
DELTA_SPIKE_ABS_CP = 50               # |Δeval| >= 50cp  → tracked in memory stack

# Center squares (chess.Square integers for d4, d5, e4, e5)
import chess  # noqa: E402  (local import to keep module lightweight)

CENTER_SQUARES: frozenset[int] = frozenset(
    {chess.D4, chess.D5, chess.E4, chess.E5}
)

# Files (as bitmasks) — used by the open-file / semi-open file logic.
BB_FILE: list[int] = [
    chess.BB_FILE_A, chess.BB_FILE_B, chess.BB_FILE_C, chess.BB_FILE_D,
    chess.BB_FILE_E, chess.BB_FILE_F, chess.BB_FILE_G, chess.BB_FILE_H,
]


class SymbolicExtractionError(Exception):
    """Base exception for the symbolic feature extractor layer."""


class InvalidBoardStateError(SymbolicExtractionError):
    """Raised when the board passed in is in an unusable state."""


class NullMoveIllegalError(SymbolicExtractionError):
    """Raised when a null-move would be illegal (king in check)."""


__all__ = [
    "PIECE_VALUE_CP",
    "PAWN_VALUE", "KNIGHT_VALUE", "BISHOP_VALUE",
    "ROOK_VALUE", "QUEEN_VALUE", "KING_VALUE",
    "SEE_WINNING_THRESHOLD_CP",
    "SACRIFICE_SEE_THRESHOLD_CP",
    "EVAL_SPIKE_ABS_CP",
    "DELTA_SPIKE_ABS_CP",
    "CENTER_SQUARES",
    "BB_FILE",
    "SymbolicExtractionError",
    "InvalidBoardStateError",
    "NullMoveIllegalError",
]
