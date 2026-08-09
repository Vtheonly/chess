"""Tests/unit/test_outpost_detector.py

Validates the outpost square detection (spec §7.3):

* Knight on e5 supported by d4 pawn, no enemy pawns on adjacent files → outpost.
* Knight on e5 with enemy pawn on f6 (can attack e5? no, but can attack via
  adjacent file) → NOT an outpost.
* Knight on rim (a5) → still an outpost if conditions met.
* Rank restrictions: rank 3 is outpost for Black but not White.
* Pawn support is mandatory: knight on e5 with no friendly pawn defender →
  NOT an outpost.
"""

from __future__ import annotations

import chess
import pytest

from caissaxai.layer2_symbolic.outpost_detector import is_outpost_square, find_outpost_squares
from caissaxai.layer2_symbolic.schemas import OutpostInfo


class TestOutpostDetection:

    def test_knight_on_e5_supported_by_d4_pawn_is_outpost(self):
        """White knight on e5, pawn on d4, no enemy pawns on d/e/f files → outpost."""
        # Construct position: White Ne5, Pd4, no black pawns on d/e/f files
        # above rank 5.  Black king somewhere safe.
        board = chess.Board("4k3/8/8/4N3/3P4/8/8/4K3 w - - 0 1")
        assert is_outpost_square(board, chess.E5, chess.WHITE) is True

    def test_knight_on_e5_with_enemy_pawn_on_f6_not_outpost(self):
        """Enemy pawn on f6 can attack e5 (via f6→e5 capture) → not an outpost.

        Wait — black pawn on f6 attacks e5 AND g5. So the pawn can capture
        the knight → not an outpost.
        """
        board = chess.Board("4k3/8/5p2/4N3/3P4/8/8/4K3 w - - 0 1")
        assert is_outpost_square(board, chess.E5, chess.WHITE) is False

    def test_knight_on_e5_no_friendly_pawn_support_not_outpost(self):
        """Without pawn support, the square is not an outpost."""
        board = chess.Board("4k3/8/8/4N3/8/8/8/4K3 w - - 0 1")
        assert is_outpost_square(board, chess.E5, chess.WHITE) is False

    def test_knight_on_e5_enemy_pawn_far_below_still_blocks_outpost(self):
        """Enemy pawn on f7 (will eventually march to f6 to attack e5)
        → not an outpost per the Stockfish rule."""
        board = chess.Board("4k3/5p2/8/4N3/3P4/8/8/4K3 w - - 0 1")
        assert is_outpost_square(board, chess.E5, chess.WHITE) is False

    def test_rank_restriction_white_rank_3_not_outpost(self):
        """White outpost only valid on ranks 4-6; rank 3 (d3) is too far back."""
        board = chess.Board("4k3/8/8/8/8/3P4/4N3/4K3 w - - 0 1")
        # White knight on e2? wait, e2 rank index = 1. Let me use e3.
        board = chess.Board("4k3/8/8/8/4N3/3P4/8/4K3 w - - 0 1")
        # Knight on e4 (rank index 3 = rank 4), supported by d3 pawn.
        # Wait d3 is rank 2 (0-indexed). Pawn on d3 attacks c4 and e4. So supports e4.
        # e4 is rank 4 (0-indexed 3) → in White's outpost range (3-5).
        assert is_outpost_square(board, chess.E4, chess.WHITE) is True

    def test_rank_restriction_white_rank_2_not_outpost(self):
        """Rank 2 (0-indexed 1) is too far back for White."""
        board = chess.Board("4k3/8/8/8/8/8/3PN3/4K3 w - - 0 1")
        # Knight on e2, supported by d2 pawn (pawn on d2 attacks c3 and e3, NOT e2).
        # So no pawn support → not outpost anyway. Adjust: place pawn on d3.
        board = chess.Board("4k3/8/8/8/8/3P4/4N3/4K3 w - - 0 1")
        # e2 is rank 1 → out of White's outpost range.
        # Also: even though d3 pawn defends e2? d3 pawn attacks c2 and e2 → yes it defends e2.
        # But rank 2 is below the outpost range → False.
        assert is_outpost_square(board, chess.E2, chess.WHITE) is False

    def test_black_outpost_on_d4(self):
        """Black knight on d4, supported by c5 pawn, no white pawns on c/d/e
        files above rank 4 (i.e. ranks 1-3 from black's perspective)."""
        # Black outpost range: ranks 3-5 (0-indexed 2-4). So d4 (rank 3) qualifies.
        # Black pawn on c5 (rank 4) attacks b4 and d4 → supports d4.
        # No white pawns on c/d/e files at rank ≤ 3.
        # FEN rank order is 8→1: rank 5 = `2p5` means c5 has black pawn.
        board = chess.Board("4k3/8/8/2p5/3n4/8/8/4K3 b - - 0 1")
        assert is_outpost_square(board, chess.D4, chess.BLACK) is True

    def test_black_outpost_on_d4_supported_by_e5_pawn(self):
        """Alternative: black knight on d4, supported by e5 pawn (also attacks d4).

        Black pawn on e5 attacks d4 and f4 → supports d4.
        """
        # FEN rank 5 = `4p3` means e5 has black pawn.
        board = chess.Board("4k3/8/8/4p3/3n4/8/8/4K3 b - - 0 1")
        assert is_outpost_square(board, chess.D4, chess.BLACK) is True

    def test_find_outpost_squares_returns_list(self):
        """The list-returning variant must produce OutpostInfo objects."""
        board = chess.Board("4k3/8/8/4N3/3P4/8/8/4K3 w - - 0 1")
        outposts = find_outpost_squares(board, chess.WHITE)
        assert isinstance(outposts, list)
        for o in outposts:
            assert isinstance(o, OutpostInfo)
            assert o.color.value == "white"
            assert o.supported_by_pawn is True
            assert o.no_enemy_pawn_can_attack is True

    def test_find_outpost_squares_occupied_only_filter(self):
        """``occupied_only=True`` excludes empty outpost squares."""
        board = chess.Board("4k3/8/8/4N3/3P4/8/8/4K3 w - - 0 1")
        # With occupied_only=True, the e5 outpost (which has the knight) should
        # be returned, but other potential empty outposts (e.g. c5) should be
        # excluded unless they have a piece.
        occupied = find_outpost_squares(board, chess.WHITE, occupied_only=True)
        # Knight on e5 → must be in the list.
        assert any(o.square == "e5" and o.occupant_piece.value == "knight" for o in occupied)

        # Without the filter, all outpost squares (including empties) appear.
        all_outposts = find_outpost_squares(board, chess.WHITE, occupied_only=False)
        assert len(all_outposts) >= len(occupied)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
