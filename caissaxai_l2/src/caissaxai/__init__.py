"""CaissaXAI — Symbolic Feature Extractor (Layer 2 focus).

This package implements the deterministic symbolic feature extraction layer
described in the CaissaXAI master engineering specification, Section 7.

Layer 2 modules:
    - see_calculator     : Static Exchange Evaluation (net material gain)
    - null_move_threat   : Concrete threat detection via null-move search
    - outpost_detector   : Outpost square detection for knights/bishops
    - center_control     : Center (d4/d5/e4/e5) attack deltas + open files
    - pawn_structure     : Isolated, doubled, backward, passed, phalanx, chains
    - feature_extractor  : Top-level orchestrator returning Pydantic models
"""

__version__ = "0.1.0"
__all__ = ["__version__"]
