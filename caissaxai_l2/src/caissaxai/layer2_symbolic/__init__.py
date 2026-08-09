"""Layer 2 — Symbolic Feature & Threat Extractor.

Public entry point: :func:`feature_extractor.extract`.
"""

from .schemas import (
    ColorEnum,
    ConcreteThreatModel,
    FeatureExtractionResult,
    MoveAnalysisRecord,
    OpenFileInfo,
    OutpostInfo,
    PawnStructureReport,
    PieceTypeEnum,
    StrategicFeaturesModel,
)
from .see_calculator import calculate_see, SEEResult
from .null_move_threat import detect_concrete_threats
from .outpost_detector import find_outpost_squares, is_outpost_square
from .center_control import (
    compute_center_attack_count,
    compute_open_files,
    compute_mobility,
    compute_king_zone_attackers,
)
from .pawn_structure import analyze_pawn_structure
from .feature_extractor import FeatureExtractor, extract_features

__all__ = [
    # Schemas
    "ColorEnum", "ConcreteThreatModel", "FeatureExtractionResult",
    "MoveAnalysisRecord", "OpenFileInfo", "OutpostInfo",
    "PawnStructureReport", "PieceTypeEnum", "StrategicFeaturesModel",
    # Sub-detectors
    "calculate_see", "SEEResult",
    "detect_concrete_threats",
    "find_outpost_squares", "is_outpost_square",
    "compute_center_attack_count", "compute_open_files",
    "compute_mobility", "compute_king_zone_attackers",
    "analyze_pawn_structure",
    # Orchestrator
    "FeatureExtractor", "extract_features",
]
