"""Outpost Detection (Section 7.3 of the spec).

A square ``S`` is an **outpost** for colour ``C`` iff:

1. ``S`` sits deep in enemy territory:
       * White: ranks 4–6  (0-indexed ranks 3, 4, 5)
       * Black: ranks 3–5  (0-indexed ranks 2, 3, 4)
2. ``S`` is defended by at least one friendly pawn.
3. No enemy pawn can ever attack ``S`` — i.e. no enemy pawn sits on a
   file adjacent to ``S`` and *in front of* ``S`` (relative to ``C``'s
   direction of advance).

Outposts are the classical home for knights and bishops (especially the
"blockading" knight on d5 in front of an enemy isolated pawn).
"""

from __future__ import annotations

import chess

from .schemas import ColorEnum, OutpostInfo, PieceTypeEnum


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
_PIECE_TYPE_MAP: dict[int, PieceTypeEnum] = {
    chess.PAWN: PieceTypeEnum.PAWN,
    chess.KNIGHT: PieceTypeEnum.KNIGHT,
    chess.BISHOP: PieceTypeEnum.BISHOP,
    chess.ROOK: PieceTypeEnum.ROOK,
    chess.QUEEN: PieceTypeEnum.QUEEN,
    chess.KING: PieceTypeEnum.KING,
}


def _rank_range_for(color: chess.Color) -> tuple[int, int]:
    """Return the inclusive 0-indexed rank range that qualifies as outpost
    territory for ``color``.

    White outposts sit on ranks 4, 5, 6  → 0-indexed (3, 4, 5)
    Black outposts sit on ranks 3, 4, 5  → 0-indexed (2, 3, 4)
    """
    if color == chess.WHITE:
        return (3, 5)
    return (2, 4)


def _pawn_defends_square(board: chess.Board, square: int, color: chess.Color) -> bool:
    """True iff at least one friendly pawn attacks ``square``."""
    pawn_attackers = board.attackers(color, square) & board.pieces(chess.PAWN, color)
    return bool(pawn_attackers)


def _enemy_pawn_can_attack(board: chess.Board, square: int, color: chess.Color) -> bool:
    """True iff any enemy pawn could ever attack ``square``.

    A pawn on file ``f`` attacks file ``f±1``.  For ``square`` of rank ``r``
    (0-indexed), an enemy pawn attacks it iff the enemy pawn is on file
    ``f±1`` and on rank ``r - 1`` (white perspective) or ``r + 1`` (black
    perspective).

    But the spec's stronger requirement is "no enemy pawn can attack it
    *now or on adjacent files in the future*" — meaning we must also
    consider enemy pawns that are *behind* the square but will eventually
    march up to attack it.  In Stockfish's actual outpost code, the rule
    simplifies to: "no enemy pawn on the adjacent files whose rank is
    ≥ the outpost rank (white) / ≤ the outpost rank (black)".  We mirror
    that.
    """
    file_idx = chess.square_file(square)
    rank_idx = chess.square_rank(square)
    enemy_color = not color

    enemy_pawns = board.pieces(chess.PAWN, enemy_color)
    adjacent_files: list[int] = []
    if file_idx > 0:
        adjacent_files.append(file_idx - 1)
    if file_idx < 7:
        adjacent_files.append(file_idx + 1)

    for pawn_sq in enemy_pawns:
        if chess.square_file(pawn_sq) not in adjacent_files:
            continue
        pawn_rank = chess.square_rank(pawn_sq)
        if color == chess.WHITE:
            # Enemy (black) pawns advance *down* the board (rank 7 → 0).
            # A black pawn on file f±1 can attack our outpost on rank r iff
            # its rank is >= r (i.e. it's still "above" us and will reach us).
            if pawn_rank >= rank_idx:
                return True
        else:
            # Enemy (white) pawns advance *up* the board (rank 0 → 7).
            # A white pawn on file f±1 can attack our outpost on rank r iff
            # its rank is <= r.
            if pawn_rank <= rank_idx:
                return True
    return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def is_outpost_square(board: chess.Board, square: int, color: chess.Color) -> bool:
    """Return True iff ``square`` is an outpost for ``color``."""
    rank_idx = chess.square_rank(square)
    rank_lo, rank_hi = _rank_range_for(color)
    if not (rank_lo <= rank_idx <= rank_hi):
        return False
    if not _pawn_defends_square(board, square, color):
        return False
    if _enemy_pawn_can_attack(board, square, color):
        return False
    return True


def find_outpost_squares(
    board: chess.Board,
    color: chess.Color,
    *,
    occupied_only: bool = False,
) -> list[OutpostInfo]:
    """Enumerate every outpost square for ``color`` on ``board``.

    Parameters
    ----------
    board
        The position to inspect.
    color
        The side for which outposts are sought.
    occupied_only
        If True, only return outposts currently occupied by a friendly
        piece (typically a knight or bishop).  If False (default), also
        include "potential" outposts — empty squares that satisfy the
        outpost criterion and could be jumped onto.
    """
    outposts: list[OutpostInfo] = []
    rank_lo, rank_hi = _rank_range_for(color)
    color_enum = ColorEnum.WHITE if color == chess.WHITE else ColorEnum.BLACK

    for rank in range(rank_lo, rank_hi + 1):
        for file in range(8):
            square = chess.square(file, rank)
            if not is_outpost_square(board, square, color):
                continue

            piece = board.piece_at(square)
            if occupied_only and (
                piece is None
                or piece.color != color
                or piece.piece_type not in (chess.KNIGHT, chess.BISHOP)
            ):
                continue

            outposts.append(OutpostInfo(
                square=chess.square_name(square),
                color=color_enum,
                occupant_piece=_PIECE_TYPE_MAP[piece.piece_type] if piece else None,
                supported_by_pawn=True,
                no_enemy_pawn_can_attack=True,
            ))
    return outposts


__all__ = ["is_outpost_square", "find_outpost_squares"]
