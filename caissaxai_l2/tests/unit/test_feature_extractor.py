"""Tests/unit/test_feature_extractor.py

Validates the top-level orchestrator (``FeatureExtractor.extract``) which
combines all sub-detectors into a single ``FeatureExtractionResult``.

Tests cover:

* End-to-end extraction on a known tactical position (Nxf7 fork).
* Schema compliance (all fields populated).
* Edge cases: illegal move raises, terminal positions handled.
* Strategic features populated correctly (outpost flag, center delta, etc.).
"""

from __future__ import annotations

import chess
import pytest

from caissaxai.layer2_symbolic import extract_features, FeatureExtractor
from caissaxai.layer2_symbolic.schemas import (
    ColorEnum,
    ConcreteThreatModel,
    FeatureExtractionResult,
    MoveAnalysisRecord,
    PieceTypeEnum,
    StrategicFeaturesModel,
)


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------
class TestFeatureExtractorEndToEnd:

    def test_e4_development_features(self):
        """1.e4: not a capture, not an outpost, opens center control."""
        board = chess.Board()
        move = chess.Move.from_uci("e2e4")
        result = extract_features(board, move)

        assert isinstance(result, FeatureExtractionResult)
        assert result.move_san == "e4"
        assert result.move_uci == "e2e4"
        assert result.mover_color == ColorEnum.WHITE
        assert result.fen_before.startswith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w")
        assert "4P3" in result.fen_after

        # Move analysis
        assert result.move_analysis.is_capture is False
        assert result.move_analysis.see_score == 0
        assert result.move_analysis.concrete_threats == []

        # Strategic features
        assert result.strategic_features.center_control_delta == 1  # e4 attacks d5
        assert result.strategic_features.is_development is False  # pawn, not minor piece
        assert result.strategic_features.is_outpost is False
        assert result.strategic_features.mobility_delta >= 0  # opening up

    def test_ng5_creates_nxf7_threat_full_extraction(self):
        """4.Ng5 in the Italian Gambit creates the Nxf7 fork threat.

        Verify the full extraction result includes:
        - The Ng5 move SAN
        - At least one concrete threat (Nxf7)
        - Center control delta (Ng5 attacks e4, f7, h7 — none center)
        - Mover color is White
        """
        board = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1")
        move = chess.Move.from_uci("f3g5")
        result = extract_features(board, move)

        assert result.move_san == "Ng5"
        assert result.mover_color == ColorEnum.WHITE
        assert len(result.move_analysis.concrete_threats) >= 1
        nxf7_threat = next(
            (t for t in result.move_analysis.concrete_threats if t.threat_move_san == "Nxf7"),
            None,
        )
        assert nxf7_threat is not None
        assert nxf7_threat.net_gain_cp == 100
        assert nxf7_threat.target_square == "f7"
        assert nxf7_threat.target_piece == PieceTypeEnum.PAWN

    def test_knight_development_flagged(self):
        """2.Nf3 from the starting position develops a knight → is_development=True."""
        board = chess.Board()
        board.push(chess.Move.from_uci("e2e4"))
        board.push(chess.Move.from_uci("e7e5"))
        # Now 2.Nf3
        move = chess.Move.from_uci("g1f3")
        result = extract_features(board, move)
        assert result.strategic_features.is_development is True

    def test_outpost_move_flagged(self):
        """A knight jumping onto an outpost square sets is_outpost=True.

        Setup: White knight on d3, supported by c2 pawn, no enemy pawns on
        adjacent files.  Knight jumps to e4 (rank 4, supported by d3 pawn
        ... wait, d3 pawn attacks c4 and e4. So d3 supports e4.).
        Actually e4 is the destination — we need to ensure no enemy pawns
        can attack e4.
        """
        # Build a position where Ne4 (from d2 → e4? no, knight moves are L-shaped).
        # Use Nd2 → Ne4? No, d2 to e4 is a 1-file, 2-rank jump = L-shape, that's a knight move. Yes!
        # Setup: White knight on d2, white pawn on d3 (attacks c4, e4 — supports e4),
        # no black pawns on d/e/f files above rank 4.
        board = chess.Board("4k3/8/8/8/8/3P1N2/8/4K3 w - - 0 1")
        # Wait, knight on f3, not d2. Let me re-set.
        # We want knight to land on e4 (an outpost for White).
        # Knight on d2 → e4: legal? d2 to e4 is 1 file, 2 ranks → yes, knight move.
        # But d2 isn't where knights usually are. Let me use Nd2 directly.
        board = chess.Board("4k3/8/8/8/8/3P4/3N4/4K3 w - - 0 1")
        # Knight on d2, pawn on d3 (attacks c4 and e4). King on e1, black king on e8.
        # Knight move: d2 → e4.
        move = chess.Move.from_uci("d2e4")
        assert move in board.legal_moves
        result = extract_features(board, move)
        # e4 is rank 4 → in White's outpost range. Pawn on d3 supports e4.
        # No black pawns → no enemy attack potential.
        assert result.strategic_features.is_outpost is True

    def test_illegal_move_raises(self):
        board = chess.Board()
        bogus = chess.Move.from_uci("e2e5")  # pawn can't jump 3 squares
        with pytest.raises(ValueError):
            extract_features(board, bogus)


class TestFeatureExtractorSchemaCompliance:

    def test_all_fields_populated(self):
        """Every required field in the result model is non-None."""
        board = chess.Board()
        move = chess.Move.from_uci("e2e4")
        result = extract_features(board, move)

        # Top-level
        assert result.fen_before
        assert result.fen_after
        assert result.move_uci
        assert result.move_san
        assert result.mover_color in (ColorEnum.WHITE, ColorEnum.BLACK)

        # MoveAnalysisRecord
        ma: MoveAnalysisRecord = result.move_analysis
        assert isinstance(ma, MoveAnalysisRecord)
        assert isinstance(ma.is_capture, bool)
        assert isinstance(ma.see_score, int)
        assert isinstance(ma.is_winning_capture, bool)
        assert isinstance(ma.concrete_threats, list)
        for t in ma.concrete_threats:
            assert isinstance(t, ConcreteThreatModel)
            assert t.threat_move_san
            assert t.threat_move_uci
            assert t.target_piece in list(PieceTypeEnum)
            assert t.target_square

        # StrategicFeaturesModel
        sf: StrategicFeaturesModel = result.strategic_features
        assert isinstance(sf, StrategicFeaturesModel)
        assert isinstance(sf.is_outpost, bool)
        assert isinstance(sf.is_development, bool)
        assert isinstance(sf.occupies_open_file, bool)
        assert isinstance(sf.opens_open_file, bool)
        assert isinstance(sf.center_control_delta, int)
        assert isinstance(sf.isolated_pawn_delta_for_mover, int)
        assert isinstance(sf.passed_pawn_delta_for_mover, int)
        assert isinstance(sf.king_attackers_delta, int)
        assert isinstance(sf.mobility_delta, int)
        assert isinstance(sf.open_files, list)
        # Pawn structure reports should be populated for both colours before/after.
        assert sf.pawn_structure_before_white is not None
        assert sf.pawn_structure_before_black is not None
        assert sf.pawn_structure_after_white is not None
        assert sf.pawn_structure_after_black is not None

    def test_pydantic_serialisation_roundtrip(self):
        """The result must serialise to JSON and back without loss."""
        import json
        board = chess.Board()
        move = chess.Move.from_uci("e2e4")
        result = extract_features(board, move)
        as_json = result.model_dump_json()
        parsed = json.loads(as_json)
        assert parsed["move_san"] == "e4"
        assert parsed["mover_color"] == "white"
        assert "strategic_features" in parsed
        assert "move_analysis" in parsed


class TestFeatureExtractorClassForm:

    def test_class_form_works_same_as_function(self):
        board = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1")
        move = chess.Move.from_uci("f3g5")

        result_a = extract_features(board, move)
        result_b = FeatureExtractor().extract(board, move)
        assert result_a == result_b


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
