"""CLI demo for the CaissaXAI Layer-2 Symbolic Feature Extractor.

Usage
-----
Analyze a single FEN position (with a chosen move):

    python -m caissaxai.layer2_symbolic.demo \\
        --fen "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1" \\
        --move f3g5

Replay an entire PGN game and print Layer-2 features for every move:

    python -m caissaxai.layer2_symbolic.demo \\
        --pgn-file ./examples/italian_gambit.pgn

Print only the JSON payload (no commentary) for piping into Layer 4:

    python -m caissaxai.layer2_symbolic.demo --fen "..." --move "..." --json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Iterable

import chess
import chess.pgn

from .feature_extractor import extract_features
from .schemas import FeatureExtractionResult


# ---------------------------------------------------------------------------
# Pretty-printing helpers
# ---------------------------------------------------------------------------
def _format_threats(threats) -> str:
    if not threats:
        return "    (no concrete threats created)\n"
    lines = []
    for t in threats:
        verdict = "WINNING" if t.is_winning_capture else "equal"
        lines.append(
            f"    • {t.threat_move_san:<8} → +{t.net_gain_cp:+d} cp  "
            f"on {t.target_piece.value} at {t.target_square}  [{verdict}]"
        )
    return "\n".join(lines) + "\n"


def _format_pawn_structure(report, label) -> str:
    if report is None:
        return f"    {label}: (no report)\n"
    return (
        f"    {label} ({report.color.value}):\n"
        f"      total pawns     : {report.total_pawns}\n"
        f"      isolated        : {report.isolated_pawn_count}  files={report.isolated_pawn_files}\n"
        f"      doubled         : {report.doubled_pawn_count}  files={report.doubled_pawn_files}\n"
        f"      backward        : {report.backward_pawn_count}  squares={report.backward_pawn_squares}\n"
        f"      passed          : {report.passed_pawn_count}  squares={report.passed_pawn_squares}\n"
        f"      phalanx squares : {report.phalanx_squares}\n"
        f"      pawn chains     : {report.pawn_chain_squares}\n"
        f"      pawn islands    : {report.pawn_island_count}\n"
    )


def _format_open_files(infos) -> str:
    open_or_semi = [f for f in infos if f.is_open or f.is_semi_open_for_white or f.is_semi_open_for_black]
    if not open_or_semi:
        return "    (all files closed)\n"
    lines = []
    for f in open_or_semi:
        kind = "OPEN" if f.is_open else (
            "SEMI-W" if f.is_semi_open_for_white else "SEMI-B"
        )
        lines.append(
            f"    • file {f.file}: {kind}  "
            f"whiteRooks={f.white_rook_count} blackRooks={f.black_rook_count}  "
            f"whiteQueens={f.white_queen_count} blackQueens={f.black_queen_count}"
        )
    return "\n".join(lines) + "\n"


def format_result_human(result: FeatureExtractionResult, *, move_number: int | None = None) -> str:
    """Render a single ``FeatureExtractionResult`` as a human-readable block."""
    ma = result.move_analysis
    sf = result.strategic_features

    header = f"━━━ Move {move_number if move_number else '?'}: {result.move_san} ({result.mover_color.value}) ━━━"
    out = []
    out.append(header)
    out.append(f"FEN before : {result.fen_before}")
    out.append(f"FEN after  : {result.fen_after}")
    out.append("")
    out.append("▸ Move Analysis (tactical)")
    out.append(f"    UCI              : {ma.move_uci}")
    out.append(f"    SAN              : {ma.move_san}")
    out.append(f"    is_capture       : {ma.is_capture}")
    if ma.captured_piece is not None:
        out.append(f"    captured_piece   : {ma.captured_piece.value}")
    out.append(f"    is_check         : {ma.is_check}")
    out.append(f"    is_checkmate     : {ma.is_checkmate}")
    out.append(f"    is_stalemate     : {ma.is_stalemate}")
    out.append(f"    SEE score        : {ma.see_score:+d} cp")
    out.append(f"    is_winning_cap   : {ma.is_winning_capture}")
    out.append(f"    is_sacrifice     : {ma.is_sacrifice}")
    out.append(f"    concrete_threats : {len(ma.concrete_threats)}")
    out.append(_format_threats(ma.concrete_threats))
    out.append("▸ Strategic Features (positional)")
    out.append(f"    is_outpost              : {sf.is_outpost}")
    out.append(f"    is_development          : {sf.is_development}")
    out.append(f"    occupies_open_file      : {sf.occupies_open_file}")
    out.append(f"    opens_open_file         : {sf.opens_open_file}")
    out.append(f"    center_control_delta    : {sf.center_control_delta:+d}")
    out.append(f"    isolated_pawn_delta     : {sf.isolated_pawn_delta_for_mover:+d}")
    out.append(f"    passed_pawn_delta       : {sf.passed_pawn_delta_for_mover:+d}")
    out.append(f"    king_attackers_delta    : {sf.king_attackers_delta:+d}")
    out.append(f"    mobility_delta          : {sf.mobility_delta:+d}")
    out.append("")
    out.append("▸ Outpost squares (after move)")
    if sf.outpost_squares_after:
        for o in sf.outpost_squares_after:
            occ = o.occupant_piece.value if o.occupant_piece else "empty"
            out.append(f"    • {o.square} ({o.color.value}) — occupant={occ}")
    else:
        out.append("    (none)")
    out.append("")
    out.append("▸ Open / semi-open files (after move)")
    out.append(_format_open_files(sf.open_files))
    out.append("▸ Pawn structure (after move)")
    out.append(_format_pawn_structure(sf.pawn_structure_after_white, "White"))
    out.append(_format_pawn_structure(sf.pawn_structure_after_black, "Black"))
    out.append("━" * len(header))
    return "\n".join(out)


# ---------------------------------------------------------------------------
# PGN replay
# ---------------------------------------------------------------------------
def iter_pgn_moves(pgn_text: str) -> Iterable[tuple[int, chess.Board, chess.Move]]:
    """Yield (ply_number, board_before, move) for every mainline move in ``pgn_text``."""
    import io
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        return
    board = game.board()
    for ply, move in enumerate(game.mainline_moves(), start=1):
        yield ply, board.copy(), move
        board.push(move)


def analyze_pgn_string(pgn_text: str) -> list[FeatureExtractionResult]:
    """Run the Layer-2 extractor over every move in ``pgn_text``."""
    results = []
    for ply, board, move in iter_pgn_moves(pgn_text):
        result = extract_features(board, move)
        results.append(result)
    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="caissaxai-l2-demo",
        description="Layer-2 Symbolic Feature Extractor — demo CLI",
    )
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--fen", help="FEN string to analyse (single position).")
    src.add_argument("--pgn-file", help="Path to a .pgn file to replay move-by-move.")
    src.add_argument("--pgn", help="Inline PGN string to replay move-by-move.")

    p.add_argument("--move", help="UCI move to analyse (only meaningful with --fen).")
    p.add_argument("--json", action="store_true",
                   help="Emit raw JSON instead of human-readable text.")
    p.add_argument("--limit", type=int, default=None,
                   help="For PGN replay, stop after N moves (default: all).")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_arg_parser().parse_args(argv)

    # ---- Single FEN ---------------------------------------------------------
    if args.fen:
        try:
            board = chess.Board(args.fen)
        except ValueError as e:
            print(f"Invalid FEN: {e}", file=sys.stderr)
            return 2
        if not args.move:
            # If no move provided, just print all candidate moves' features.
            print(f"FEN: {args.fen}")
            print("No --move given; analysing all legal moves...\n")
            for i, mv in enumerate(board.legal_moves, start=1):
                try:
                    result = extract_features(board, mv)
                except ValueError as e:
                    print(f"  skip {mv.uci()}: {e}", file=sys.stderr)
                    continue
                if args.json:
                    print(result.model_dump_json())
                else:
                    print(format_result_human(result, move_number=i))
                    print()
                if args.limit and i >= args.limit:
                    break
            return 0
        try:
            move = chess.Move.from_uci(args.move)
        except ValueError as e:
            print(f"Invalid UCI move '{args.move}': {e}", file=sys.stderr)
            return 2
        try:
            result = extract_features(board, move)
        except ValueError as e:
            print(f"Extraction failed: {e}", file=sys.stderr)
            return 3
        if args.json:
            print(result.model_dump_json(indent=2))
        else:
            print(format_result_human(result))
        return 0

    # ---- PGN replay ---------------------------------------------------------
    pgn_text: str
    if args.pgn_file:
        try:
            pgn_text = Path(args.pgn_file).read_text(encoding="utf-8")
        except OSError as e:
            print(f"Cannot read PGN file: {e}", file=sys.stderr)
            return 2
    else:
        pgn_text = args.pgn

    results = analyze_pgn_string(pgn_text)
    if args.limit:
        results = results[: args.limit]

    if args.json:
        payload = [r.model_dump(mode="json") for r in results]
        print(json.dumps(payload, indent=2))
    else:
        for i, r in enumerate(results, start=1):
            print(format_result_human(r, move_number=i))
            print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
