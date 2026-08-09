"""Null-Move Threat Detection (Section 7.2 of the spec).

Goal
----
Given a board *before* a move ``m`` and the move ``m`` itself, find every
*concrete tactical threat* that ``m`` creates.  A "concrete threat" is a
capture that the mover would be able to play if the opponent passed (made a
null-move).  Such captures reveal forks, pins-into-captures, and hanging
pieces — all the things a real commentator would point at.

Algorithm (spec §7.2, slightly tightened)
-----------------------------------------
1. Copy the board, push ``m``.
2. If the resulting position is check, **bail out** — null-moves are illegal
   when in check, and Stockfish itself would refuse one.
3. Push ``chess.Move.null()`` to pass the turn.
4. Enumerate every legal move.  For each *capture*, run ``calculate_see``.
5. If SEE ≥ 0 (capture wins or equalises), record a ``ConcreteThreatModel``.
6. Pop the null-move and the player move so the caller's board is unchanged.
7. Deduplicate by target square, keeping the highest net gain.

Edge cases
----------
* **In-check after m:** Step 2 returns an empty list.  This matches the
  spec's mandate: "If in check, return empty concrete threats list or
  evaluate check escapes explicitly."  We do the former because check
  escapes are already covered by Stockfish's PV.
* **Terminal position after m (checkmate/stalemate):** Return empty list.
* **En-passant captures:** ``board.is_capture()`` returns True for them
  and ``calculate_see`` handles them correctly.
"""

from __future__ import annotations

import chess

from .schemas import ConcreteThreatModel, PieceTypeEnum
from .see_calculator import calculate_see


# Mapping from python-chess piece-type ints to our schema enum.
_PIECE_TYPE_MAP: dict[int, PieceTypeEnum] = {
    chess.PAWN: PieceTypeEnum.PAWN,
    chess.KNIGHT: PieceTypeEnum.KNIGHT,
    chess.BISHOP: PieceTypeEnum.BISHOP,
    chess.ROOK: PieceTypeEnum.ROOK,
    chess.QUEEN: PieceTypeEnum.QUEEN,
    chess.KING: PieceTypeEnum.KING,
}


def detect_concrete_threats(
    board_before: chess.Board,
    move: chess.Move,
    *,
    min_see_cp: int = 0,
    max_threats: int = 20,
) -> list[ConcreteThreatModel]:
    """Enumerate the concrete threats created by playing ``move``.

    Parameters
    ----------
    board_before
        Position *before* ``move`` is played.  The board is **not** mutated.
    move
        The move just played by the side to move.  Must be legal in
        ``board_before``.
    min_see_cp
        Minimum SEE value for a capture to count as a threat.  Default 0
        (winning *or* equal).  Pass ``1`` to keep only winning captures.
    max_threats
        Safety cap on the number of threats returned.  Positions rarely
        produce more than 3–4, but a king walk into a windmill could in
        principle generate dozens.

    Returns
    -------
    list[ConcreteThreatModel]
        Deduplicated by target square (highest net gain kept), sorted by
        ``net_gain_cp`` descending.
    """
    # --- Validate preconditions -------------------------------------------------
    if move not in board_before.legal_moves:
        raise ValueError(
            f"Move {move.uci()} is not legal in position {board_before.fen()}"
        )

    # --- Copy the board and push the move --------------------------------------
    board = board_before.copy()
    try:
        board.push(move)
    except (AssertionError, ValueError) as exc:
        # python-chess occasionally raises on malformed castling rights, etc.
        raise ValueError(f"Failed to push move {move.uci()}: {exc}") from exc

    # --- Edge case 1: terminal position (checkmate / stalemate) ----------------
    if board.is_checkmate() or board.is_stalemate() or board.is_insufficient_material():
        return []

    # --- Edge case 2: in-check after our move means opponent is in check --------
    # The opponent cannot null-move out of check — so no "if-you-pass" threats.
    if board.is_check():
        return []

    # --- Push the null move ----------------------------------------------------
    try:
        board.push(chess.Move.null())
    except (AssertionError, ValueError):
        # Null move illegal (e.g. side to move is in check — already guarded
        # above) — defensive bail-out.
        return []

    # --- Enumerate captures ----------------------------------------------------
    threats_by_target: dict[int, ConcreteThreatModel] = {}

    for candidate in board.legal_moves:
        if not board.is_capture(candidate):
            continue

        see_result = calculate_see(board, candidate)
        if see_result.see_value < min_see_cp:
            continue

        target_sq: int = candidate.to_square
        target_piece_obj = board.piece_at(target_sq)

        # For en-passant, the "target piece" is the captured pawn on a
        # different square.  We still report the destination square because
        # that's what a commentator would name.
        if target_piece_obj is None:
            # En-passant capture: piece is the enemy pawn that just moved.
            target_piece_enum = PieceTypeEnum.PAWN
        else:
            target_piece_enum = _PIECE_TYPE_MAP[target_piece_obj.piece_type]

        # Generate SAN *before* we mutate the board further (the SAN function
        # needs the current board state with the move about to be played).
        try:
            san = board.san(candidate)
        except (AssertionError, ValueError):
            # Defensive: skip moves python-chess can't san-ify (shouldn't happen).
            continue

        threat = ConcreteThreatModel(
            threat_move_san=san,
            threat_move_uci=candidate.uci(),
            target_piece=target_piece_enum,
            target_square=chess.square_name(target_sq),
            net_gain_cp=see_result.see_value,
            is_winning_capture=see_result.see_value > 0,
        )

        # Deduplicate by target square, keeping the highest net gain.
        existing = threats_by_target.get(target_sq)
        if existing is None or threat.net_gain_cp > existing.net_gain_cp:
            threats_by_target[target_sq] = threat

        if len(threats_by_target) >= max_threats:
            break

    # Pop null-move and player move so the board copy is back to before-m
    # (caller's board was never touched, but popping keeps the local copy
    # consistent in case future code wants to inspect it).
    board.pop()  # null
    board.pop()  # player move

    # Sort by net_gain descending — the most damaging threats first.
    return sorted(threats_by_target.values(), key=lambda t: t.net_gain_cp, reverse=True)


__all__ = ["detect_concrete_threats"]
