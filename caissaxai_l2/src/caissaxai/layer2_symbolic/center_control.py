"""Center Control, Open Files, Mobility & King-Zone Attackers.

Implements Section 7.4 of the spec plus the auxiliary metrics referenced
by ``StrategicFeaturesModel``:

* ``compute_center_attack_count`` — number of attacks a colour lands on the
  four center squares (d4, d5, e4, e5).  The *delta* of this count before
  vs. after a move is what Layer 2 reports as ``center_control_delta``.
* ``compute_open_files`` — for each file a/b/.../h, classify it as open /
  semi-open-for-white / semi-open-for-black, and count the rooks & queens
  of each colour that occupy it.
* ``compute_mobility`` — number of legal moves available to a side.  The
  delta across a move is the canonical "did this move improve activity?"
  signal.
* ``compute_king_zone_attackers`` — number of *mover* pieces attacking
  squares in the enemy king's 3×3 zone.  This is a lightweight king-safety
  proxy that mirrors Stockfish's ``king_attackers`` counter (without the
  weighted sum — Layer 5 LLM only needs the count, the weight table lives
  in evaluate.cpp).
"""

from __future__ import annotations

import chess

from ..core import CENTER_SQUARES
from .schemas import ColorEnum, OpenFileInfo


# ---------------------------------------------------------------------------
# Version-agnostic popcount helper.
# python-chess 1.10 returned raw ``int`` bitmasks from ``board.pieces(...)``;
# 1.11+ returns ``SquareSet`` objects.  Both support ``int(x)`` and ``len(x)``,
# so we normalise here once and call ``_popcount`` everywhere instead of
# ``chess.popcount``.
# ---------------------------------------------------------------------------
def _popcount(x) -> int:
    """Count set bits in either an int or a ``chess.SquareSet``."""
    if isinstance(x, int):
        return chess.popcount(x)
    # SquareSet implements __len__ → number of set bits.
    return len(x)


# ---------------------------------------------------------------------------
# Center control
# ---------------------------------------------------------------------------
def compute_center_attack_count(board: chess.Board, color: chess.Color) -> int:
    """How many of the 4 center squares does ``color`` attack?

    Counts each square once even if attacked by multiple pieces — we want
    a *coverage* number, not a piece-attack count, so that adding a second
    attacker to an already-covered square doesn't artificially inflate the
    delta.
    """
    return sum(1 for sq in CENTER_SQUARES if board.is_attacked_by(color, sq))


# ---------------------------------------------------------------------------
# Open files
# ---------------------------------------------------------------------------
def compute_open_files(board: chess.Board) -> list[OpenFileInfo]:
    """Classify all 8 files and count the heavy pieces on each."""
    infos: list[OpenFileInfo] = []

    for file_idx in range(8):
        file_mask = chess.BB_FILES[file_idx]
        white_pawns = board.pieces(chess.PAWN, chess.WHITE) & file_mask
        black_pawns = board.pieces(chess.PAWN, chess.BLACK) & file_mask
        white_rooks = board.pieces(chess.ROOK, chess.WHITE) & file_mask
        black_rooks = board.pieces(chess.ROOK, chess.BLACK) & file_mask
        white_queens = board.pieces(chess.QUEEN, chess.WHITE) & file_mask
        black_queens = board.pieces(chess.QUEEN, chess.BLACK) & file_mask

        is_open = (white_pawns == 0) and (black_pawns == 0)
        is_semi_white = (white_pawns == 0) and bool(black_pawns)
        is_semi_black = (black_pawns == 0) and bool(white_pawns)

        infos.append(OpenFileInfo(
            file=chess.FILE_NAMES[file_idx],
            is_open=is_open,
            is_semi_open_for_white=is_semi_white,
            is_semi_open_for_black=is_semi_black,
            white_rook_count=_popcount(white_rooks),
            black_rook_count=_popcount(black_rooks),
            white_queen_count=_popcount(white_queens),
            black_queen_count=_popcount(black_queens),
        ))
    return infos


def file_is_open_for_color(info: OpenFileInfo, color: chess.Color) -> bool:
    """Convenience: a file is "open for color" if it's fully open or
    semi-open (no friendly pawns)."""
    if info.is_open:
        return True
    if color == chess.WHITE:
        return info.is_semi_open_for_white
    return info.is_semi_open_for_black


# ---------------------------------------------------------------------------
# Mobility
# ---------------------------------------------------------------------------
def compute_mobility(board: chess.Board) -> int:
    """Number of legal moves available to the side to move.

    Mirrors Stockfish's mobility counter — a side with more legal moves
    has, in aggregate, more active pieces.  We compute it on the *current*
    side to move; pass ``board.mirror()``-style copies if you need the
    other side's count.
    """
    return board.legal_moves.count()


# ---------------------------------------------------------------------------
# King-zone attackers
# ---------------------------------------------------------------------------
def _king_zone_squares(board: chess.Board, color: chess.Color) -> list[int]:
    """Return the 3×3 zone around ``color``'s king.

    The king is the center; the zone extends one square in every
    direction.  Edge cases (king on the a/h/1/8 borders) are handled
    naturally by clipping to the board.
    """
    king_sq = board.king(color)
    if king_sq is None:
        return []
    file_idx = chess.square_file(king_sq)
    rank_idx = chess.square_rank(king_sq)
    squares: list[int] = []
    for df in (-1, 0, 1):
        for dr in (-1, 0, 1):
            f, r = file_idx + df, rank_idx + dr
            if 0 <= f <= 7 and 0 <= r <= 7:
                squares.append(chess.square(f, r))
    return squares


def compute_king_zone_attackers(board: chess.Board, attacker_color: chess.Color) -> int:
    """Number of distinct squares in the enemy king's 3×3 zone attacked
    by ``attacker_color``.

    Counts squares, not pieces — same rationale as the center-control
    counter: doubling up on one square is less scary than covering many.
    """
    defender_color = not attacker_color
    zone = _king_zone_squares(board, defender_color)
    return sum(1 for sq in zone if board.is_attacked_by(attacker_color, sq))


__all__ = [
    "compute_center_attack_count",
    "compute_open_files",
    "file_is_open_for_color",
    "compute_mobility",
    "compute_king_zone_attackers",
]
