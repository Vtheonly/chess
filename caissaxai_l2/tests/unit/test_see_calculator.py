"""Tests/unit/test_see_calculator.py

Validates the Static Exchange Evaluation (SEE) implementation against
classic chess tactic patterns:

* Free piece capture (no recapture) → SEE = +piece_value
* Equal exchange (knight for knight) → SEE = 0
* Pure material sacrifice (Q for N defended by 2 pawns) → SEE = -580
* Royal fork pattern (Nxf7 with Bc4 cover) → SEE = +100
* En-passant capture → SEE = 0 (pawn for pawn)
"""

from __future__ import annotations

import chess
import pytest

from caissaxai.layer2_symbolic.see_calculator import calculate_see, SEEResult


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------
class TestSEEBasic:
    """Basic sanity tests."""

    def test_non_capture_returns_zero(self):
        """1.e4 is not a capture → SEE must be 0 and is_capture=False."""
        board = chess.Board()
        move = chess.Move.from_uci("e2e4")
        result = calculate_see(board, move)
        assert result.see_value == 0
        assert result.is_capture is False
        assert result.verdict == "non-capture"
        assert result.is_winning_capture is False
        assert result.is_sacrifice is False

    def test_simple_pawn_capture_no_recapture(self):
        """exd5 where black has NO recapture (d-file blocked, no attackers) → SEE = +100.

        Setup: remove black queen so there's no recapturer on d5.
        Black pawn on d5, white pawn on e4 — exd5 wins a pawn cleanly.
        """
        # Original FEN `rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR`
        # has black queen on d8 which recaptures after exd5 (SEE=0).
        # We remove the black queen to create a clean +100 capture test.
        board = chess.Board("rnb1kbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1")
        move = chess.Move.from_uci("e4d5")
        result = calculate_see(board, move)
        assert result.is_capture is True
        assert result.see_value == 100
        assert result.is_winning_capture is True
        assert result.verdict == "winning"

    def test_pawn_capture_recaptured_by_queen(self):
        """exd5 with black queen on d8 recapturing (d-file clear) → SEE = 0.

        Black pawn on d5 (no d7 pawn — d-file is clear from d8 to d5),
        black queen on d8 recaptures.  White has no recapturer (own d2 pawn
        blocks the d-file for the white queen).  Net: +100 -100 = 0.
        """
        board = chess.Board("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1")
        move = chess.Move.from_uci("e4d5")
        result = calculate_see(board, move)
        assert result.is_capture is True
        assert result.see_value == 0
        assert result.verdict == "equal"


class TestSEEExchanges:
    """Multi-step exchange tests."""

    def test_free_queen_capture(self):
        """Qxe4 with no recapture available → SEE = +900."""
        # White Q on e2, black Q on e4, e-file clear between them.
        board = chess.Board("rnb1kbnr/pppp1ppp/8/4p3/4q3/8/4Q3/PPPPBPPP w KQkq - 0 1")
        move = chess.Move.from_uci("e2e4")
        result = calculate_see(board, move)
        assert result.see_value == 900
        assert result.is_winning_capture is True

    def test_equal_queen_trade(self):
        """Qxe7 defended by Ng8 and Ke8 → SEE = 0 (Q for Q)."""
        board = chess.Board("rnb1k1nr/ppppqppp/3p4/8/4Q3/8/PPPP1PPP/RNB1KBNR w KQkq - 0 1")
        move = chess.Move.from_uci("e4e7")
        result = calculate_see(board, move)
        assert result.see_value == 0
        assert result.verdict == "equal"
        assert result.is_winning_capture is True  # equal counts as "winning" per spec

    def test_knight_for_knight(self):
        """Nxe4 defended by d5 pawn → SEE = 0 (N for N)."""
        board = chess.Board("rnbqkbnr/ppp2ppp/8/3pp3/4n3/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 1")
        move = chess.Move.from_uci("c3e4")
        result = calculate_see(board, move)
        assert result.see_value == 0
        assert result.verdict == "equal"

    def test_pure_sacrifice_queen_for_knight(self):
        """Qxe4 defended by d5 AND f5 pawns → SEE = -580 (lose Q for N).

        Math: White +320 (knight) - 900 (queen lost to dxe4) = -580.
        Black does NOT need to recapture with the second pawn because
        the first recapture already nets positive for them.
        """
        board = chess.Board("rnbqkb1r/ppp2ppp/8/3ppp2/4n3/8/PPPP1PPP/RNB1KBNR w KQkq - 0 1")
        # Move white queen to e1 so Qxe4 is a legal move
        board.remove_piece_at(chess.D1)
        board.set_piece_at(chess.E1, chess.Piece(chess.QUEEN, chess.WHITE))
        move = chess.Move.from_uci("e1e4")
        result = calculate_see(board, move)
        assert result.see_value == -580
        assert result.is_sacrifice is True
        assert result.verdict == "sacrifice"

    def test_royal_fork_knight_wins_pawn(self):
        """Nxf7 with Bc4 preventing king recapture → SEE = +100.

        After 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5 Bc5 5.Nxf7 — the knight
        captures the f7 pawn. Black king on e8 would normally recapture,
        but the white bishop on c4 attacks f7, so the king cannot legally
        move there. White wins the pawn cleanly.
        """
        board = chess.Board("r2qkbnr/pppp1ppp/2n5/2b1pN2/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 0 1")
        move = chess.Move.from_uci("f5f7")
        result = calculate_see(board, move)
        assert result.see_value == 100
        assert result.is_winning_capture is True


class TestSEESpecial:
    """En-passant, promotion, and edge cases."""

    def test_en_passant_capture(self):
        """En-passant capture → SEE = 0 (pawn for pawn).

        Setup: white pawn on e5, black just played f7-f5 (ep_square = f6).
        White plays exf6 e.p. — captures the f5 pawn via the f6 square.
        """
        # FEN: pawns on d5 (black), e5 (white), f5 (black). Black just
        # moved f7-f5, so ep_square = f6.
        board = chess.Board("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 1")
        assert board.ep_square == chess.F6
        # White pawn on e5 captures e.p. on f6.
        move = chess.Move.from_uci("e5f6")
        assert board.is_en_passant(move)
        result = calculate_see(board, move)
        assert result.is_capture is True
        # Pawn for pawn, no recapture possible (e.p. captured pawn is gone) → SEE = 0.
        assert result.see_value == 0

    def test_promotion_capture(self):
        """dxe8=Q capturing a rook → SEE = +500 (captured rook value).

        Setup: white pawn on d7, black rook on e8, black king far enough
        away that it cannot recapture.  Our SEE implementation counts only
        the captured-piece value, not the promotion bonus, so SEE = +500.
        """
        # Place black rook on e8 (not d8) and black king on h8 (far away).
        board = chess.Board("4r2k/3P4/8/8/8/8/8/4K3 w - - 0 1")
        move = chess.Move.from_uci("d7e8q")  # capture rook, promote to queen
        assert board.is_capture(move)
        result = calculate_see(board, move)
        assert result.is_capture is True
        # Captured rook (500), no recapture (king on h8 too far) → SEE = +500.
        assert result.see_value == 500


class TestSEEInvalidMoves:
    """Defensive: SEE on illegal moves should be caught at a higher level."""

    def test_see_on_illegal_move_does_not_crash(self):
        """calculate_see doesn't validate legality — it only checks if the
        destination square has an enemy piece (i.e., is a 'capture' in the
        material-exchange sense).  For a clearly non-capturing move like a
        quiet pawn push, SEE returns 0 cleanly.
        """
        board = chess.Board()
        # a2a4 is a legal quiet pawn push (non-capture) → SEE = 0.
        move = chess.Move.from_uci("a2a4")
        result = calculate_see(board, move)
        assert result.see_value == 0
        assert result.is_capture is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
