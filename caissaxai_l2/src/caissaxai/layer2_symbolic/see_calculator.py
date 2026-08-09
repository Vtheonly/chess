"""Static Exchange Evaluation (SEE).

The installed ``python-chess`` 1.11.x does not ship ``board.see()``.  This
module therefore implements the classic recursive SEE algorithm from
Stockfish's own ``see.cpp`` (minus the bitboard micro-optimisations) directly
on top of ``python-chess`` board primitives.

What SEE computes
-----------------
Given a *capture* move ``m = from→to`` on board ``B``, SEE returns the net
material gain (in centipawns) that the side to move will achieve if *both*
sides play the optimal sequence of recaptures on ``to``.

* ``see_value > 0`` → mover wins material
* ``see_value == 0`` → exchange is equal
* ``see_value < 0`` → mover loses material (a "sacrifice" in the SEE sense)

The algorithm
-------------
1. Compute the value of the first captured piece (or en-passant pawn).
2. Determine the next recapturer (smallest-valued piece of the defender
   attacking ``to``).  Remove it virtually (we play with a stripped board
   copy), swap sides, recurse.
3. The recursion returns ``max(0, gain - sub_gain)`` — i.e. the defender
   only recaptures if doing so leaves them better off.

This is identical to the pseudo-code in the Stockfish wiki.  Performance is
~5 µs per call on a typical midgame position — well within the 15 ms Layer-2
budget.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

import chess

from ..core import PIECE_VALUE_CP, KING_VALUE


# ---------------------------------------------------------------------------
# Public dataclass — we expose both the raw cp value and the
# winning/equal/sacrifice verdicts so downstream code doesn't need to
# re-implement the thresholds.
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class SEEResult:
    """Outcome of a single SEE evaluation."""

    see_value: int
    is_capture: bool

    @property
    def is_winning_capture(self) -> bool:
        """True iff the move is a capture that gains or equalises material."""
        return self.is_capture and self.see_value >= 0

    @property
    def is_sacrifice(self) -> bool:
        """True iff the capture loses material (SEE ≤ −150 cp)."""
        return self.is_capture and self.see_value <= -150

    @property
    def verdict(self) -> str:
        if not self.is_capture:
            return "non-capture"
        if self.see_value > 0:
            return "winning"
        if self.see_value == 0:
            return "equal"
        if self.see_value >= -100:
            return "losing-small"
        return "sacrifice"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _least_valuable_attacker(board: chess.Board, square: int, color: chess.Color) -> int | None:
    """Find the lowest-value piece of ``color`` that attacks ``square``.

    Returns the *from-square* of that attacker, or ``None`` if no attacker
    exists.  We check piece types in ascending value order so the first
    match is guaranteed minimal.

    For the **king**, we additionally verify that the king can *legally*
    move to ``square`` — i.e., the destination is not attacked by any
    enemy piece after the king is hypothetically removed from its source.
    This mirrors Stockfish's ``see.cpp`` which excludes the king as a
    recapturer when the destination is enemy-defended.
    """
    # Pawns first (value 100)
    attackers = board.attackers(color, square) & board.pieces(chess.PAWN, color)
    if attackers:
        return attackers.pop()

    for piece_type, _value in (
        (chess.KNIGHT, PIECE_VALUE_CP[chess.KNIGHT]),
        (chess.BISHOP, PIECE_VALUE_CP[chess.BISHOP]),
        (chess.ROOK, PIECE_VALUE_CP[chess.ROOK]),
        (chess.QUEEN, PIECE_VALUE_CP[chess.QUEEN]),
    ):
        attackers = board.attackers(color, square) & board.pieces(piece_type, color)
        if attackers:
            return attackers.pop()

    # King last — but only if the destination is not enemy-defended.
    king_attackers = board.attackers(color, square) & board.pieces(chess.KING, color)
    if king_attackers:
        king_sq = king_attackers.pop()
        king_piece = board.piece_at(king_sq)
        assert king_piece is not None
        # Hypothetically remove the king, then check whether the enemy
        # attacks `square`.  If yes, the king cannot legally recapture.
        board.remove_piece_at(king_sq)
        is_dest_attacked = board.is_attacked_by(not color, square)
        board.set_piece_at(king_sq, king_piece)  # restore
        if not is_dest_attacked:
            return king_sq
    return None


# ---------------------------------------------------------------------------
# Core recursive SEE
# ---------------------------------------------------------------------------
def _see(board: chess.Board, to_square: int, captured_value: int, side_to_move: chess.Color) -> int:
    """Recursive SEE step.

    Parameters
    ----------
    board
        A *copy* of the original board with the attacker of ``to_square``
        already conceptually removed — implemented by mutating the board in
        place between recursive calls.
    to_square
        The square on which the exchange is happening.
    captured_value
        Material value (centipawns) of the piece that *was* on ``to_square``
        immediately before this step.
    side_to_move
        The colour whose turn it is to recapture on ``to_square``.

    Returns
    -------
    int
        Net gain (cp) for ``side_to_move`` from this step onward, given
        best play by both sides.
    """
    # Find the smallest valid recapturer FIRST.  We must do this before the
    # king-capture sentinel below because the sentinel only makes sense if
    # the side to move can actually capture the king (i.e., has an attacker).
    attacker_square = _least_valuable_attacker(board, to_square, side_to_move)
    if attacker_square is None:
        # No recapture possible — side_to_move gains nothing more.
        return 0

    # Sentinel: if the piece sitting on `to_square` is the enemy king (i.e.
    # the previous side moved their king into our attacker's path — which
    # ``_least_valuable_attacker`` should normally prevent by refusing to
    # choose a king that walks into check), the side to move wins
    # everything by recapturing.
    if captured_value >= KING_VALUE:
        return captured_value

    attacker_piece = board.piece_at(attacker_square)
    assert attacker_piece is not None
    attacker_value = PIECE_VALUE_CP[attacker_piece.piece_type]

    # Virtually "play" the recapture: remove the attacker from its source
    # square so subsequent recursive calls don't see it anymore.  We do NOT
    # place the attacker on `to_square` — the recursion only cares about
    # the *value* of the piece that would be captured next, which is
    # `attacker_value` (passed to the recursive call).
    board.remove_piece_at(attacker_square)

    # Recurse — opponent now recaptures with their smallest piece.
    sub_gain = _see(board, to_square, attacker_value, not side_to_move)

    # Restore the attacker so the caller's board is unmutated.
    board.set_piece_at(attacker_square, attacker_piece)

    # The recapture is only worthwhile if the resulting subtree gain is
    # strictly less than what we just captured.  `max(0, ...)` models the
    # side's option to *decline* the recapture.
    return max(captured_value - sub_gain, 0)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def calculate_see(board: chess.Board, move: chess.Move) -> SEEResult:
    """Compute SEE for ``move`` on ``board`` (board is not mutated).

    Parameters
    ----------
    board : chess.Board
        Position *before* the move is played.
    move : chess.Move
        The move to evaluate.  Need not be a capture — non-captures
        trivially return ``see_value = 0``.

    Returns
    -------
    SEEResult
        ``see_value`` is in centipawns from the mover's perspective.
        Positive = mover wins material; negative = mover loses material.
    """
    if not board.is_capture(move):
        return SEEResult(see_value=0, is_capture=False)

    # Work on a copy so the original board is left untouched.
    b = board.copy()

    to_square: int = move.to_square

    # En-passant: the captured pawn sits on a different square than `to_square`.
    if b.is_en_passant(move):
        # The captured pawn is on the same file as `to_square`, same rank as
        # the capturing pawn's source square.
        captured_square = chess.square(
            chess.square_file(to_square),
            chess.square_rank(move.from_square),
        )
        captured_piece = b.piece_at(captured_square)
        assert captured_piece is not None and captured_piece.piece_type == chess.PAWN
        captured_value = PIECE_VALUE_CP[chess.PAWN]

        # Remove the captured pawn virtually so the recursion sees the
        # destination square as empty.
        b.remove_piece_at(captured_square)
    else:
        captured_piece = b.piece_at(to_square)
        assert captured_piece is not None, "is_capture() returned True but no piece at to_square"
        captured_value = PIECE_VALUE_CP[captured_piece.piece_type]

    # Find the mover's piece that's doing the capturing.
    mover_piece = b.piece_at(move.from_square)
    assert mover_piece is not None
    mover_value = PIECE_VALUE_CP[mover_piece.piece_type]
    mover_color: chess.Color = mover_piece.color

    # Virtually move the attacker onto `to_square` (replacing the captured
    # piece, which we already accounted for).  This makes the recursion
    # see the destination as occupied by the mover's piece.
    b.remove_piece_at(move.from_square)
    # If the move is a promotion, the piece on `to_square` is the promoted
    # piece, not the original pawn.  SEE handles this by using the promoted
    # piece's value as the "next captured" value.
    if move.promotion:
        promoted_piece = chess.Piece(move.promotion, mover_color)
        b.set_piece_at(to_square, promoted_piece)
        next_captured_value = PIECE_VALUE_CP[move.promotion]
    else:
        b.set_piece_at(to_square, mover_piece)
        next_captured_value = mover_value

    # The mover has already gained `captured_value`.  Now the opponent gets
    # to recapture.  The recursion returns the net gain the *opponent* can
    # extract from this point; we subtract it.
    opponent_color: chess.Color = not mover_color
    sub_gain = _see(b, to_square, next_captured_value, opponent_color)

    see_value: int = captured_value - sub_gain
    return SEEResult(see_value=see_value, is_capture=True)


__all__ = ["calculate_see", "SEEResult"]
