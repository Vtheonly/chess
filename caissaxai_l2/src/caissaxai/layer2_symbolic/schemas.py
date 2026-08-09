"""Pydantic v2 schemas that define the data interchange contract for Layer 2.

These models are the *only* objects Layer 2 ever returns to higher layers
(Layer 3 memory stack, Layer 4 synthesizer, Layer 5 LLM narrator).  Keeping
the contract strict guarantees the LLM never sees an unstructured dict.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, ConfigDict


# ---------------------------------------------------------------------------
# Enums (mirror Section 4.1 of the spec)
# ---------------------------------------------------------------------------
class PieceTypeEnum(str, Enum):
    PAWN = "pawn"
    KNIGHT = "knight"
    BISHOP = "bishop"
    ROOK = "rook"
    QUEEN = "queen"
    KING = "king"


class ColorEnum(str, Enum):
    WHITE = "white"
    BLACK = "black"


# ---------------------------------------------------------------------------
# Layer-2 atomic models
# ---------------------------------------------------------------------------
class ConcreteThreatModel(BaseModel):
    """A single concrete tactical threat discovered by the null-move search.

    A threat is any legal capture whose Static Exchange Evaluation is
    non-negative (i.e. the capturer wins or breaks even on the exchange)
    after the player-to-move passes (null-move).
    """

    model_config = ConfigDict(frozen=True)

    threat_move_san: str = Field(..., description="SAN of the threatening move")
    threat_move_uci: str = Field(..., description="UCI engine notation")
    target_piece: PieceTypeEnum = Field(..., description="Piece type being attacked")
    target_square: str = Field(..., description="Square of the threatened piece, e.g. 'f7'")
    net_gain_cp: int = Field(..., description="SEE net gain in centipawns (>=0 for a real threat)")
    is_winning_capture: bool = Field(..., description="True iff net_gain_cp > 0")


class MoveAnalysisRecord(BaseModel):
    """Per-move tactical analysis: capture info, SEE, and concrete threats."""

    model_config = ConfigDict(frozen=True)

    move_uci: str
    move_san: str
    is_capture: bool
    captured_piece: Optional[PieceTypeEnum] = None
    is_check: bool = Field(False, description="True iff the move gives check")
    is_checkmate: bool = Field(False, description="True iff the move delivers mate")
    is_stalemate: bool = Field(False, description="True iff the move draws by stalemate")
    see_score: int = Field(..., description="SEE in centipawns from the mover's perspective")
    is_winning_capture: bool = Field(..., description="True iff see_score >= 0 and is_capture")
    is_sacrifice: bool = Field(False, description="True iff see_score <= -150 (material given up)")
    concrete_threats: list[ConcreteThreatModel] = Field(
        default_factory=list,
        description="Concrete tactical threats created by this move (via null-move search)",
    )


class OpenFileInfo(BaseModel):
    """Information about a single file's openness for one side."""

    model_config = ConfigDict(frozen=True)

    file: str = Field(..., description="File letter a–h")
    is_open: bool = Field(..., description="True iff no pawns of either colour on the file")
    is_semi_open_for_white: bool = Field(..., description="No white pawns, ≥1 black pawn")
    is_semi_open_for_black: bool = Field(..., description="No black pawns, ≥1 white pawn")
    white_rook_count: int = Field(0, description="White rooks on this file")
    black_rook_count: int = Field(0, description="Black rooks on this file")
    white_queen_count: int = Field(0)
    black_queen_count: int = Field(0)


class PawnStructureReport(BaseModel):
    """Pawn-structure breakdown for one colour."""

    model_config = ConfigDict(frozen=True)

    color: ColorEnum
    isolated_pawn_files: list[str] = Field(default_factory=list)
    isolated_pawn_count: int = 0
    doubled_pawn_files: list[str] = Field(default_factory=list)
    doubled_pawn_count: int = 0  # total excess pawns on doubled files
    backward_pawn_squares: list[str] = Field(default_factory=list)
    backward_pawn_count: int = 0
    passed_pawn_squares: list[str] = Field(default_factory=list)
    passed_pawn_count: int = 0
    phalanx_squares: list[str] = Field(default_factory=list,
        description="Pawns side-by-side on the same rank with no enemy pawns ahead")
    pawn_chain_squares: list[str] = Field(default_factory=list,
        description="Pawns defending another friendly pawn")
    pawn_island_count: int = Field(0, description="Number of separated pawn groups")
    total_pawns: int = 0


class OutpostInfo(BaseModel):
    """An outpost square occupied (or occupiable) by a piece."""

    model_config = ConfigDict(frozen=True)

    square: str
    color: ColorEnum
    occupant_piece: Optional[PieceTypeEnum] = None  # knight or bishop typically
    supported_by_pawn: bool
    no_enemy_pawn_can_attack: bool


class StrategicFeaturesModel(BaseModel):
    """Composite positional snapshot computed by Layer 2 for a single position."""

    model_config = ConfigDict(frozen=True)

    # --- Square / file features ------------------------------------------------
    is_outpost: bool = Field(..., description="Move lands a piece on an outpost square")
    outpost_squares_before: list[OutpostInfo] = Field(default_factory=list)
    outpost_squares_after: list[OutpostInfo] = Field(default_factory=list)
    is_development: bool = Field(..., description="Move develops a minor piece from its home rank")
    occupies_open_file: bool = Field(..., description="After move, mover has a rook/queen on an open file")
    opens_open_file: bool = Field(..., description="Move clears a pawn off a file, opening it")
    open_files: list[OpenFileInfo] = Field(default_factory=list)

    # --- Center control --------------------------------------------------------
    center_control_delta: int = Field(...,
        description="Net change in attacks on d4/d5/e4/e5 (mover perspective)")

    # --- Pawn structure deltas (mover perspective) -----------------------------
    pawn_structure_before_white: Optional[PawnStructureReport] = None
    pawn_structure_before_black: Optional[PawnStructureReport] = None
    pawn_structure_after_white: Optional[PawnStructureReport] = None
    pawn_structure_after_black: Optional[PawnStructureReport] = None
    isolated_pawn_delta_for_mover: int = Field(0,
        description="(Mover's isolated count after) - (before); negative = improvement")
    passed_pawn_delta_for_mover: int = Field(0,
        description="Mover's passed-pawn count delta; positive = progress made")

    # --- King safety (lightweight proxy; full king-safety lives in evaluate.cpp) -
    king_attackers_delta: int = Field(0,
        description="Change in number of mover's pieces attacking the enemy king zone")

    # --- Mobility (mover perspective) -----------------------------------------
    mobility_delta: int = Field(0,
        description="(Mover legal-move count after) - (mover legal-move count before)")


class FeatureExtractionResult(BaseModel):
    """Top-level Layer-2 result returned by ``feature_extractor.extract(...)``.

    Combines the per-move tactical analysis (``MoveAnalysisRecord``) with the
    positional snapshot (``StrategicFeaturesModel``), plus the FENs that
    bracket the move so downstream layers (3, 4) can correlate state.
    """

    model_config = ConfigDict(frozen=True)

    fen_before: str
    fen_after: str
    move_uci: str
    move_san: str
    mover_color: ColorEnum
    move_analysis: MoveAnalysisRecord
    strategic_features: StrategicFeaturesModel


__all__ = [
    "PieceTypeEnum",
    "ColorEnum",
    "ConcreteThreatModel",
    "MoveAnalysisRecord",
    "OpenFileInfo",
    "PawnStructureReport",
    "OutpostInfo",
    "StrategicFeaturesModel",
    "FeatureExtractionResult",
]
