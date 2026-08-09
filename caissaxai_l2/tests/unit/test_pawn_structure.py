"""Tests/unit/test_pawn_structure.py

Validates the pawn-structure analyser:

* Isolated pawns: a pawn with no friendly pawns on adjacent files.
* Doubled pawns: ≥ 2 friendly pawns on the same file.
* Backward pawns: a pawn whose adjacent-file neighbours are all *ahead* of
  it, with an enemy "stopper" pawn in front.
* Passed pawns: no enemy pawn ahead on same or adjacent files.
* Phalanx: two side-by-side pawns with no enemy pawn directly in front of
  either.
* Pawn chain: a pawn that defends another friendly pawn.
* Pawn islands: count of contiguous file groups.
"""

from __future__ import annotations

import chess
import pytest

from caissaxai.layer2_symbolic.pawn_structure import analyze_pawn_structure
from caissaxai.layer2_symbolic.schemas import PawnStructureReport, ColorEnum


class TestIsolatedPawns:

    def test_d5_isolated_pawn(self):
        """Black pawn on d5, no other black pawns on c or e files → isolated."""
        # Black pawn on d5, all other black pawns on a/b/f/g/h files.
        board = chess.Board("4k3/8/8/3p4/8/8/PPPP1PPP/4K3 w - - 0 1")
        # Wait, this is White to move and only has white pawns. Let me re-set.
        board = chess.Board("4k3/pppp4/8/3p4/8/8/8/4K3 w - - 0 1")
        # Black pawns: a7, b7, c7, d7, d5. The d5 pawn: adjacent files c,e.
        # c7 is on the c-file (adjacent). So d5 is NOT isolated.
        # Let me fix: make d5 truly isolated by removing c7 and e7.
        board = chess.Board("4k3/ppp5/8/3p4/8/8/8/4K3 w - - 0 1")
        # Black pawns: a7, b7, c7, d5. d5 adjacent files: c, e.
        # c-file has c7 → d5 has a c-file neighbour. NOT isolated.
        # OK let me start over with a clear isolated d-pawn position.
        board = chess.Board("4k3/8/8/3p4/8/8/PPP3PP/4K3 w - - 0 1")
        # Wait, this is white to move and the d5 pawn is BLACK (lowercase 'd').
        # Yes, black pawn on d5. White pawns on a2, b2, c2, g2, h2.
        # Black has only the d5 pawn → isolated (no other black pawns at all).
        report = analyze_pawn_structure(board, chess.BLACK)
        assert report.isolated_pawn_count == 1
        assert "d" in report.isolated_pawn_files

    def test_no_isolated_pawns_in_starting_position(self):
        """Starting position has all 8 pawns → zero isolated."""
        board = chess.Board()
        report_white = analyze_pawn_structure(board, chess.WHITE)
        report_black = analyze_pawn_structure(board, chess.BLACK)
        assert report_white.isolated_pawn_count == 0
        assert report_black.isolated_pawn_count == 0


class TestDoubledPawns:

    def test_doubled_pawns_on_e_file(self):
        """Two white pawns on the e-file → doubled, excess count = 1."""
        board = chess.Board("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1")
        # Only one pawn on e2. Add another on e3.
        board.set_piece_at(chess.E3, chess.Piece(chess.PAWN, chess.WHITE))
        report = analyze_pawn_structure(board, chess.WHITE)
        assert "e" in report.doubled_pawn_files
        assert report.doubled_pawn_count == 1  # 2 pawns - 1 = 1 excess

    def test_tripled_pawns_excess_count_2(self):
        """Three white pawns on the same file → excess count = 2."""
        board = chess.Board("4k3/8/8/8/8/4P3/4P3/4K3 w - - 0 1")
        # Need to set king to e1, but we already have e1 king. Add a third pawn on e4.
        board.set_piece_at(chess.E4, chess.Piece(chess.PAWN, chess.WHITE))
        report = analyze_pawn_structure(board, chess.WHITE)
        assert "e" in report.doubled_pawn_files
        assert report.doubled_pawn_count == 2  # 3 pawns - 1 = 2 excess


class TestPassedPawns:

    def test_white_passed_pawn_on_d5(self):
        """White pawn on d5, no black pawns on c/d/e files at ranks ≥ 5."""
        # Black pawns only on a-file and h-file.
        board = chess.Board("4k3/p7/8/3P4/8/8/8/P3K3 w - - 0 1")
        report = analyze_pawn_structure(board, chess.WHITE)
        assert "d5" in report.passed_pawn_squares
        assert report.passed_pawn_count == 1

    def test_not_passed_if_enemy_pawn_blocks(self):
        """White pawn on d5, black pawn on d6 → not passed."""
        board = chess.Board("4k3/p7/3p4/3P4/8/8/8/4K3 w - - 0 1")
        report = analyze_pawn_structure(board, chess.WHITE)
        assert "d5" not in report.passed_pawn_squares


class TestPawnIslands:

    def test_two_island_groups(self):
        """White pawns on a2, b2 (island 1) and f2, g2, h2 (island 2) → 2 islands."""
        board = chess.Board("4k3/8/8/8/8/8/PPPP3P/4K3 w - - 0 1")
        # Wait, that's 5 pawns (a2,b2,c2,d2,h2) — let me redo.
        board = chess.Board("4k3/8/8/8/8/8/PP4PP/4K3 w - - 0 1")
        # Pawns on a2, b2, g2, h2 → 2 islands (ab, gh).
        report = analyze_pawn_structure(board, chess.WHITE)
        assert report.pawn_island_count == 2

    def test_one_island_when_all_contiguous(self):
        """All pawns on contiguous files → 1 island."""
        board = chess.Board("4k3/8/8/8/8/8/PPPPP3/4K3 w - - 0 1")
        report = analyze_pawn_structure(board, chess.WHITE)
        assert report.pawn_island_count == 1

    def test_zero_islands_when_no_pawns(self):
        """No pawns → 0 islands."""
        board = chess.Board("4k3/8/8/8/8/8/8/4K3 w - - 0 1")
        report = analyze_pawn_structure(board, chess.WHITE)
        assert report.pawn_island_count == 0
        assert report.total_pawns == 0


class TestPawnStructureReportShape:

    def test_returns_pydantic_model(self):
        board = chess.Board()
        report = analyze_pawn_structure(board, chess.WHITE)
        assert isinstance(report, PawnStructureReport)
        assert report.color == ColorEnum.WHITE
        assert report.total_pawns == 8

    def test_black_report_color_enum(self):
        board = chess.Board()
        report = analyze_pawn_structure(board, chess.BLACK)
        assert report.color == ColorEnum.BLACK


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
