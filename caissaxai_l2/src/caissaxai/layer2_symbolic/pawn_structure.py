"""Pawn Structure Analysis (Section 7.4 of the spec, expanded).

A self-contained port of the classical ``pawns.cpp`` evaluation logic.
For each colour we report:

* **Isolated pawns** — no friendly pawn on either adjacent file.
* **Doubled pawns** — ≥ 2 friendly pawns on the same file.
* **Backward pawns** — a pawn that cannot be supported by a friendly pawn
  coming from behind, AND that has an enemy pawn in front of it capable
  of capturing its advance square.
* **Passed pawns** — no enemy pawn on the same file or adjacent files
  that is *ahead* of it (relative to the mover's direction).
* **Phalanx** — two friendly pawns side-by-side on the same rank with no
  enemy pawns directly in front of either.
* **Pawn chains** — pawns that defend another friendly pawn.
* **Pawn islands** — number of contiguous friendly-pawn file groups.

All metrics are computed deterministically from the bitboards exposed by
``python-chess``.  No evaluation score is assigned here — that's
``material.cpp``'s job.  Layer 2 only reports the *counts*; Layer 4's
synthesizer weights them by Elo tier.
"""

from __future__ import annotations

import chess

from .schemas import ColorEnum, PawnStructureReport


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _square_name(sq: int) -> str:
    return chess.square_name(sq)


def _pawns_on_file(board: chess.Board, color: chess.Color, file_idx: int) -> int:
    """Number of friendly pawns on file ``file_idx`` (0..7)."""
    mask = board.pieces(chess.PAWN, color) & chess.BB_FILES[file_idx]
    # python-chess 1.11 returns SquareSet — both int() and len() work.
    return len(mask) if hasattr(mask, "__len__") else chess.popcount(mask)


def _pawns_on_adjacent_files(board: chess.Board, color: chess.Color, file_idx: int) -> int:
    """Number of friendly pawns on files immediately left/right of ``file_idx``."""
    mask = chess.BB_EMPTY
    if file_idx > 0:
        mask |= chess.BB_FILES[file_idx - 1]
    if file_idx < 7:
        mask |= chess.BB_FILES[file_idx + 1]
    pawns_masked = board.pieces(chess.PAWN, color) & mask
    return len(pawns_masked) if hasattr(pawns_masked, "__len__") else chess.popcount(pawns_masked)


def _is_isolated(board: chess.Board, square: int, color: chess.Color) -> bool:
    """A pawn is isolated iff no friendly pawn sits on either adjacent file."""
    file_idx = chess.square_file(square)
    return _pawns_on_adjacent_files(board, color, file_idx) == 0


def _is_passed(board: chess.Board, square: int, color: chess.Color) -> bool:
    """A pawn is passed iff no enemy pawn is on the same file or either
    adjacent file *ahead* of it (in its direction of advance)."""
    file_idx = chess.square_file(square)
    rank_idx = chess.square_rank(square)

    # Build the "forward mask" — the squares in front of our pawn on the
    # same file and the two adjacent files.
    forward_mask = chess.BB_EMPTY
    if color == chess.WHITE:
        rank_range = range(rank_idx + 1, 8)
    else:
        rank_range = range(0, rank_idx)

    for r in rank_range:
        forward_mask |= chess.BB_SQUARES[chess.square(file_idx, r)]
        if file_idx > 0:
            forward_mask |= chess.BB_SQUARES[chess.square(file_idx - 1, r)]
        if file_idx < 7:
            forward_mask |= chess.BB_SQUARES[chess.square(file_idx + 1, r)]

    enemy_pawns = board.pieces(chess.PAWN, not color)
    return (enemy_pawns & forward_mask) == 0


def _is_backward(board: chess.Board, square: int, color: chess.Color) -> bool:
    """A pawn is backward iff:

    1. It is *not* isolated (has friendly pawns on adjacent files).
    2. Those friendly pawns are all *ahead* of it (so they cannot support
       its advance).
    3. There is an enemy pawn that could capture it on its advance square
       (i.e. the enemy pawn is on an adjacent file at the rank immediately
       in front of our pawn's advance square — this is the famous
       "stopper" pawn).
    """
    file_idx = chess.square_file(square)
    rank_idx = chess.square_rank(square)

    # --- Condition 1 ----------------------------------------------------------
    if _pawns_on_adjacent_files(board, color, file_idx) == 0:
        return False  # Isolated, not backward.

    # --- Condition 2: friendly adjacent pawns are all *ahead* ------------------
    # White pawns advance up (rank increases); Black down (rank decreases).
    if color == chess.WHITE:
        behind_rank = rank_idx - 1
        ahead_rank = rank_idx + 1
    else:
        behind_rank = rank_idx + 1
        ahead_rank = rank_idx - 1

    # Are there any friendly pawns *behind* us on adjacent files? If yes,
    # they can march up and support us → not backward.
    friendly_behind_mask = chess.BB_EMPTY
    for adj_f in (file_idx - 1, file_idx + 1):
        if 0 <= adj_f <= 7:
            friendly_behind_mask |= chess.BB_SQUARES[chess.square(adj_f, behind_rank)]
    if board.pieces(chess.PAWN, color) & friendly_behind_mask:
        return False

    # --- Condition 3: enemy stopper pawn --------------------------------------
    # The "stopper" is an enemy pawn that sits on an adjacent file at the
    # rank immediately ahead of our advance square, *and* that pawn is not
    # itself blocked from advancing to attack our advance square.
    #
    # Concretely, for a White pawn on (f, r):
    #   - advance square is (f, r+1)
    #   - enemy stopper candidates are on (f-1, r+2) and (f+1, r+2)
    # because a black pawn on (f±1, r+2) attacks (f, r+1) and could
    # eventually capture our pawn if it advanced.
    #
    # Actually the classical definition is simpler: the enemy pawn just
    # needs to be on an adjacent file and *ahead* of us.  We use the
    # stricter Stockfish-style definition.
    stopper_mask = chess.BB_EMPTY
    for adj_f in (file_idx - 1, file_idx + 1):
        if 0 <= adj_f <= 7:
            stopper_mask |= chess.BB_SQUARES[chess.square(adj_f, ahead_rank)]
    enemy_pawns = board.pieces(chess.PAWN, not color)
    if not (enemy_pawns & stopper_mask):
        return False

    # All three conditions met → backward pawn.
    return True


def _is_phalanx(board: chess.Board, square: int, color: chess.Color) -> bool:
    """A pawn is in a "phalanx" iff it has a friendly pawn on an adjacent
    file on the *same rank*, and neither pawn has an enemy pawn directly
    in front of it.

    Phalanxes are powerful — they advance together and control the squares
    in front of them as a unit.
    """
    file_idx = chess.square_file(square)
    rank_idx = chess.square_rank(square)

    # Advance direction
    if color == chess.WHITE:
        front_rank = rank_idx + 1
    else:
        front_rank = rank_idx - 1
    if not (0 <= front_rank <= 7):
        return False  # Pawn about to promote — phalanx concept doesn't apply.

    friendly_pawns = board.pieces(chess.PAWN, color)
    enemy_pawns = board.pieces(chess.PAWN, not color)

    for adj_f in (file_idx - 1, file_idx + 1):
        if not (0 <= adj_f <= 7):
            continue
        adj_sq = chess.square(adj_f, rank_idx)
        # Friendly pawn on adjacent same rank?
        if adj_sq not in friendly_pawns:
            continue
        # No enemy pawn directly in front of either pawn?
        front_self = chess.square(file_idx, front_rank)
        front_adj = chess.square(adj_f, front_rank)
        if (enemy_pawns & (chess.BB_SQUARES[front_self] | chess.BB_SQUARES[front_adj])):
            continue
        return True
    return False


def _is_in_chain(board: chess.Board, square: int, color: chess.Color) -> bool:
    """A pawn is in a chain iff it *defends* another friendly pawn.

    For White: a pawn on (f, r) defends pawns on (f-1, r+1) and (f+1, r+1).
    For Black: a pawn on (f, r) defends pawns on (f-1, r-1) and (f+1, r-1).
    """
    file_idx = chess.square_file(square)
    rank_idx = chess.square_rank(square)
    if color == chess.WHITE:
        defend_rank = rank_idx + 1
    else:
        defend_rank = rank_idx - 1
    if not (0 <= defend_rank <= 7):
        return False

    friendly_pawns = board.pieces(chess.PAWN, color)
    for adj_f in (file_idx - 1, file_idx + 1):
        if 0 <= adj_f <= 7:
            defend_sq = chess.square(adj_f, defend_rank)
            if defend_sq in friendly_pawns:
                return True
    return False


def _count_pawn_islands(board: chess.Board, color: chess.Color) -> int:
    """Number of contiguous file groups that contain at least one friendly
    pawn.  E.g. pawns on a, b, d, e, h → 3 islands (ab, de, h)."""
    pawns = board.pieces(chess.PAWN, color)
    island_count = 0
    in_island = False
    for file_idx in range(8):
        file_has_pawn = bool(pawns & chess.BB_FILES[file_idx])
        if file_has_pawn and not in_island:
            island_count += 1
            in_island = True
        elif not file_has_pawn:
            in_island = False
    return island_count


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def analyze_pawn_structure(board: chess.Board, color: chess.Color) -> PawnStructureReport:
    """Compute the full pawn-structure breakdown for ``color``."""
    color_enum = ColorEnum.WHITE if color == chess.WHITE else ColorEnum.BLACK
    pawns = board.pieces(chess.PAWN, color)

    isolated_files: set[str] = set()
    doubled_files: set[str] = set()
    doubled_excess = 0
    backward_squares: list[str] = []
    passed_squares: list[str] = []
    phalanx_squares: list[str] = []
    chain_squares: list[str] = []

    for pawn_sq in pawns:
        file_idx = chess.square_file(pawn_sq)
        file_letter = chess.FILE_NAMES[file_idx]

        if _is_isolated(board, pawn_sq, color):
            isolated_files.add(file_letter)

        if _is_passed(board, pawn_sq, color):
            passed_squares.append(_square_name(pawn_sq))

        if _is_backward(board, pawn_sq, color):
            backward_squares.append(_square_name(pawn_sq))

        if _is_phalanx(board, pawn_sq, color):
            phalanx_squares.append(_square_name(pawn_sq))

        if _is_in_chain(board, pawn_sq, color):
            chain_squares.append(_square_name(pawn_sq))

    # Doubled pawns: any file with ≥ 2 friendly pawns.
    for file_idx in range(8):
        n = _pawns_on_file(board, color, file_idx)
        if n >= 2:
            doubled_files.add(chess.FILE_NAMES[file_idx])
            doubled_excess += (n - 1)

    return PawnStructureReport(
        color=color_enum,
        isolated_pawn_files=sorted(isolated_files),
        isolated_pawn_count=len(isolated_files),
        doubled_pawn_files=sorted(doubled_files),
        doubled_pawn_count=doubled_excess,
        backward_pawn_squares=sorted(backward_squares),
        backward_pawn_count=len(backward_squares),
        passed_pawn_squares=sorted(passed_squares),
        passed_pawn_count=len(passed_squares),
        phalanx_squares=sorted(phalanx_squares),
        pawn_chain_squares=sorted(chain_squares),
        pawn_island_count=_count_pawn_islands(board, color),
        total_pawns=len(pawns) if hasattr(pawns, "__len__") else chess.popcount(pawns),
    )


__all__ = ["analyze_pawn_structure"]
