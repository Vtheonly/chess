"""Layer 2 orchestrator.

``FeatureExtractor.extract(board_before, move)`` is the single public entry
point.  It runs every sub-detector in the right order, builds the
``MoveAnalysisRecord`` and ``StrategicFeaturesModel``, and returns them
packaged in a single ``FeatureExtractionResult``.

The extractor is *stateless* — it does not maintain game history.  Layer 3
(Game Memory Stack) is responsible for tracking state across plies.
"""

from __future__ import annotations

from typing import Final

import chess

from .schemas import (
    ColorEnum,
    ConcreteThreatModel,
    FeatureExtractionResult,
    MoveAnalysisRecord,
    OutpostInfo,
    PieceTypeEnum,
    StrategicFeaturesModel,
)
from .see_calculator import calculate_see
from .null_move_threat import detect_concrete_threats
from .outpost_detector import find_outpost_squares, is_outpost_square
from .center_control import (
    compute_center_attack_count,
    compute_open_files,
    compute_mobility,
    compute_king_zone_attackers,
    file_is_open_for_color,
)
from .pawn_structure import analyze_pawn_structure

# Piece-type int → enum mapping (kept local to avoid circular imports).
_PIECE_TYPE_MAP: Final[dict[int, PieceTypeEnum]] = {
    chess.PAWN: PieceTypeEnum.PAWN,
    chess.KNIGHT: PieceTypeEnum.KNIGHT,
    chess.BISHOP: PieceTypeEnum.BISHOP,
    chess.ROOK: PieceTypeEnum.ROOK,
    chess.QUEEN: PieceTypeEnum.QUEEN,
    chess.KING: PieceTypeEnum.KING,
}


def _color_enum(c: chess.Color) -> ColorEnum:
    return ColorEnum.WHITE if c == chess.WHITE else ColorEnum.BLACK


def _mirror_color(c: chess.Color) -> chess.Color:
    return not c


# ---------------------------------------------------------------------------
# Stateless public function — preferred for one-off calls.
# ---------------------------------------------------------------------------
def extract_features(board_before: chess.Board, move: chess.Move) -> FeatureExtractionResult:
    """Convenience wrapper: instantiates a ``FeatureExtractor`` and runs it."""
    return FeatureExtractor().extract(board_before, move)


# ---------------------------------------------------------------------------
# Class form — useful if you want to override sub-detectors for testing.
# ---------------------------------------------------------------------------
class FeatureExtractor:
    """Stateless Layer-2 feature extractor.

    The class form exists purely so tests can monkey-patch individual
    sub-detectors (e.g. to inject a stub SEE that returns canned values).
    Production code should prefer the ``extract_features`` function above.
    """

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def extract(self, board_before: chess.Board, move: chess.Move) -> FeatureExtractionResult:
        if move not in board_before.legal_moves:
            raise ValueError(
                f"Move {move.uci()} is not legal in position {board_before.fen()}"
            )

        mover_color: chess.Color = board_before.turn
        fen_before: str = board_before.fen()
        move_san: str = board_before.san(move)
        move_uci: str = move.uci()

        # --- Build the "after" board once; reuse for every sub-detector -------
        board_after = board_before.copy()
        board_after.push(move)

        # --- Build MoveAnalysisRecord -----------------------------------------
        move_analysis = self._build_move_analysis(board_before, board_after, move)

        # --- Build StrategicFeaturesModel -------------------------------------
        strategic = self._build_strategic_features(board_before, board_after, move, mover_color)

        return FeatureExtractionResult(
            fen_before=fen_before,
            fen_after=board_after.fen(),
            move_uci=move_uci,
            move_san=move_san,
            mover_color=_color_enum(mover_color),
            move_analysis=move_analysis,
            strategic_features=strategic,
        )

    # ------------------------------------------------------------------
    # Sub-detector orchestration
    # ------------------------------------------------------------------
    def _build_move_analysis(
        self,
        board_before: chess.Board,
        board_after: chess.Board,
        move: chess.Move,
    ) -> MoveAnalysisRecord:
        is_capture = board_before.is_capture(move)
        captured_piece_enum: PieceTypeEnum | None = None

        if is_capture:
            if board_before.is_en_passant(move):
                captured_piece_enum = PieceTypeEnum.PAWN
            else:
                cap = board_before.piece_at(move.to_square)
                if cap is not None:
                    captured_piece_enum = _PIECE_TYPE_MAP[cap.piece_type]

        see_result = calculate_see(board_before, move)

        # Terminal-state flags.  ``board_after`` is the position *after* the
        # move was played, so ``is_checkmate``/``is_stalemate`` on it tell us
        # whether the move ended the game.
        is_check = board_after.is_check()
        is_checkmate = board_after.is_checkmate()
        is_stalemate = board_after.is_stalemate()

        # Concrete threats: skip if the move ends the game (no opponent reply).
        if is_checkmate or is_stalemate:
            threats: list[ConcreteThreatModel] = []
        else:
            threats = detect_concrete_threats(board_before, move)

        return MoveAnalysisRecord(
            move_uci=move.uci(),
            move_san=board_before.san(move),
            is_capture=is_capture,
            captured_piece=captured_piece_enum,
            is_check=is_check,
            is_checkmate=is_checkmate,
            is_stalemate=is_stalemate,
            see_score=see_result.see_value,
            is_winning_capture=see_result.is_winning_capture,
            is_sacrifice=see_result.is_sacrifice,
            concrete_threats=threats,
        )

    def _build_strategic_features(
        self,
        board_before: chess.Board,
        board_after: chess.Board,
        move: chess.Move,
        mover_color: chess.Color,
    ) -> StrategicFeaturesModel:
        enemy_color = _mirror_color(mover_color)

        # ----- Outpost detection -------------------------------------------
        outposts_before = find_outpost_squares(board_before, mover_color)
        outposts_after = find_outpost_squares(board_after, mover_color)
        is_outpost_move = False
        moved_piece = board_before.piece_at(move.from_square)
        if moved_piece is not None and moved_piece.piece_type in (chess.KNIGHT, chess.BISHOP):
            if is_outpost_square(board_after, move.to_square, mover_color):
                is_outpost_move = True

        # ----- Development --------------------------------------------------
        is_development = False
        if moved_piece is not None and moved_piece.piece_type in (chess.KNIGHT, chess.BISHOP):
            home_rank = 0 if mover_color == chess.WHITE else 7
            if chess.square_rank(move.from_square) == home_rank:
                # Moved off the back rank → developed (castling rook also
                # qualifies, but we restrict to minors per spec §7.4).
                is_development = True

        # ----- Open files --------------------------------------------------
        open_files_before = compute_open_files(board_before)
        open_files_after = compute_open_files(board_after)

        occupies_open_file = False
        for info in open_files_after:
            if not file_is_open_for_color(info, mover_color):
                continue
            # Did the *moved* piece land on this file?
            if chess.square_file(move.to_square) == chess.FILE_NAMES.index(info.file):
                if moved_piece is not None and moved_piece.piece_type in (chess.ROOK, chess.QUEEN):
                    occupies_open_file = True
                    break
            # Or did a *different* rook/queen already on this file gain
            # control because our pawn moved off it?
            if moved_piece is not None and moved_piece.piece_type == chess.PAWN:
                if chess.square_file(move.from_square) == chess.FILE_NAMES.index(info.file):
                    occupies_open_file = True
                    break

        opens_open_file = False
        if moved_piece is not None and moved_piece.piece_type == chess.PAWN:
            file_idx = chess.square_file(move.from_square)
            before_info = open_files_before[file_idx]
            after_info = open_files_after[file_idx]
            # Did our pawn leave and thereby open the file?
            if not file_is_open_for_color(before_info, mover_color) and \
               file_is_open_for_color(after_info, mover_color):
                opens_open_file = True

        # ----- Center control delta -----------------------------------------
        center_before = compute_center_attack_count(board_before, mover_color)
        center_after = compute_center_attack_count(board_after, mover_color)
        center_delta = center_after - center_before

        # ----- Pawn structure ----------------------------------------------
        psw_before = analyze_pawn_structure(board_before, chess.WHITE)
        psb_before = analyze_pawn_structure(board_before, chess.BLACK)
        psw_after = analyze_pawn_structure(board_after, chess.WHITE)
        psb_after = analyze_pawn_structure(board_after, chess.BLACK)

        if mover_color == chess.WHITE:
            isolated_delta = psw_after.isolated_pawn_count - psw_before.isolated_pawn_count
            passed_delta = psw_after.passed_pawn_count - psw_before.passed_pawn_count
        else:
            isolated_delta = psb_after.isolated_pawn_count - psb_before.isolated_pawn_count
            passed_delta = psb_after.passed_pawn_count - psb_before.passed_pawn_count

        # ----- King-zone attackers (mover → enemy king) ---------------------
        king_attackers_before = compute_king_zone_attackers(board_before, mover_color)
        king_attackers_after = compute_king_zone_attackers(board_after, mover_color)
        king_attackers_delta = king_attackers_after - king_attackers_before

        # ----- Mobility delta -----------------------------------------------
        # Mobility of the *mover* — i.e. how many moves does the side to
        # move have before vs after the move was played.
        mobility_before = compute_mobility(board_before)
        # After the move, the *opponent* is to move — we need the mover's
        # own mobility after, which means we count the opponent's move
        # count on board_after and then mirror.  Actually a cleaner
        # approach: the mover's mobility *after* their move is the number
        # of moves the *opponent* will have on board_after, which we read
        # directly via ``board_after.legal_moves.count()``.  But that's the
        # *opponent's* mobility, not the mover's.  The mover's mobility
        # after their own move = number of moves they would have if it
        # were still their turn — which we obtain by passing turn back.
        board_after_copy = board_after.copy()
        try:
            board_after_copy.push(chess.Move.null())
            mobility_after = compute_mobility(board_after_copy)
        except (AssertionError, ValueError):
            # Null move illegal (opponent in check) — fall back to "after"
            # count from the opponent's perspective, which is still a
            # reasonable proxy for the mover's residual piece activity.
            mobility_after = compute_mobility(board_after)
        mobility_delta = mobility_after - mobility_before

        return StrategicFeaturesModel(
            is_outpost=is_outpost_move,
            outpost_squares_before=outposts_before,
            outpost_squares_after=outposts_after,
            is_development=is_development,
            occupies_open_file=occupies_open_file,
            opens_open_file=opens_open_file,
            open_files=open_files_after,
            center_control_delta=center_delta,
            pawn_structure_before_white=psw_before,
            pawn_structure_before_black=psb_before,
            pawn_structure_after_white=psw_after,
            pawn_structure_after_black=psb_after,
            isolated_pawn_delta_for_mover=isolated_delta,
            passed_pawn_delta_for_mover=passed_delta,
            king_attackers_delta=king_attackers_delta,
            mobility_delta=mobility_delta,
        )


__all__ = ["FeatureExtractor", "extract_features"]
