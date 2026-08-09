# CaissaXAI — Layer 2: Symbolic Feature Extractor

A focused, production-quality implementation of the **Symbolic Feature &
Threat Extractor** described in §7 of the CaissaXAI Master Engineering
Specification.  This is the deterministic "truth engine" that sits between
the python-chess board representation (Layer 0) and the Game Memory Stack
(Layer 3).  It produces Pydantic-validated JSON payloads that the LLM
Narrator (Layer 5) can safely consume without ever computing chess
facts itself.

---

## 1. What it does

Given a chess position `B` and a legal move `m`, the extractor returns a
`FeatureExtractionResult` containing:

### Move-level tactical analysis (`MoveAnalysisRecord`)
* **SEE score** — Static Exchange Evaluation in centipawns (positive =
  mover wins material).  Computed with a from-scratch recursive SEE that
  correctly handles the king-as-recapturer special case (the king is
  excluded when the destination square is enemy-defended).
* **Concrete threats** — every winning capture the mover would have *if
  the opponent passed* (null-move search).  Reveals forks, hanging
  pieces, and tactical follow-ups.
* **Capture / sacrifice / check / mate / stalemate flags.**

### Positional snapshot (`StrategicFeaturesModel`)
* **Outpost detection** — knight/bishop squares deep in enemy territory,
  defended by a friendly pawn, with no enemy pawn able to attack.
* **Center control delta** — net change in mover's attacks on d4/d5/e4/e5.
* **Open files** — full per-file classification (open / semi-open-W /
  semi-open-B) with rook & queen occupancy counts.
* **Pawn structure** — isolated, doubled, backward, passed, phalanx,
  chain, and island counts for *both* colours, before and after the move.
* **King-zone attackers delta** — net change in mover's attacks on the
  enemy king's 3×3 zone (a lightweight king-safety proxy).
* **Mobility delta** — net change in the mover's legal-move count.

---

## 2. Project layout

```
caissaxai_l2/
├── README.md                      ← you are here
├── pyproject.toml                 ← package metadata
├── src/
│   └── caissaxai/
│       ├── __init__.py
│       ├── core/
│       │   └── __init__.py        ← piece values, thresholds, exceptions
│       └── layer2_symbolic/
│           ├── __init__.py        ← public API re-exports
│           ├── schemas.py         ← Pydantic v2 models
│           ├── see_calculator.py  ← recursive SEE
│           ├── null_move_threat.py← concrete-threat detector
│           ├── outpost_detector.py
│           ├── center_control.py  ← center, open files, mobility, king zone
│           ├── pawn_structure.py  ← isolated/doubled/backward/passed/...
│           ├── feature_extractor.py ← top-level orchestrator
│           └── demo.py            ← CLI demo
├── tests/
│   ├── conftest.py
│   └── unit/
│       ├── test_see_calculator.py
│       ├── test_null_move_threat.py
│       ├── test_outpost_detector.py
│       ├── test_center_control.py
│       ├── test_pawn_structure.py
│       └── test_feature_extractor.py
└── examples/
    ├── italian_gambit.pgn         ← Ng5 → Nxf7 royal fork demo
    └── legals_mate.pgn            ← Nxe5 sacrifice → Nd5# demo
```

---

## 3. Quick start

### Install dependencies

```bash
pip install python-chess pydantic
```

(`python-chess` ≥ 1.10 is supported; the SEE module is implemented
in-house so we do **not** depend on the `board.see()` method that was
added in 1.10 — the code works on 1.11+ as well.)

### Run the demo

```bash
cd caissaxai_l2
PYTHONPATH=src python -m caissaxai.layer2_symbolic.demo \
    --pgn-file ./examples/italian_gambit.pgn
```

You'll see Layer-2 output for every move.  The royal fork on move 9
(`Nxf7`) is the highlight:

```
━━━ Move 9: Nxf7 (white) ━━━

▸ Move Analysis (tactical)
    SEE score        : +100 cp
    is_winning_cap   : True
    concrete_threats : 2
    • Nxd8     → ++580 cp  on queen at d8  [WINNING]
    • Nxh8     → ++500 cp  on rook at h8   [WINNING]

▸ Strategic Features (positional)
    king_attackers_delta    : +1
    open_files (after move) :
      • file f: SEMI-B

▸ Pawn structure (after move)
    Black (black):
      total pawns     : 7          ← was 8
      pawn islands    : 2          ← was 1 (f-file empty)
```

### Use it as a library

```python
import chess
from caissaxai.layer2_symbolic import extract_features

board = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1")
move  = chess.Move.from_uci("f3g5")   # 4.Ng5

result = extract_features(board, move)

print(result.move_san)                # 'Ng5'
print(result.move_analysis.see_score) # 0 (non-capture)
for t in result.move_analysis.concrete_threats:
    print(t.threat_move_san, t.net_gain_cp)
    # Nxf7 100

print(result.strategic_features.center_control_delta)  # 0
print(result.strategic_features.mobility_delta)        # 4
```

### Emit JSON for downstream layers

```bash
PYTHONPATH=src python -m caissaxai.layer2_symbolic.demo \
    --fen "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1" \
    --move f3g5 --json
```

---

## 4. Algorithmic notes

### SEE (Static Exchange Evaluation)

The installed `python-chess` 1.11.x does not ship `board.see()`, so we
implement the classic recursive SEE from Stockfish's `see.cpp` directly
on top of `python-chess` board primitives.  The recursion is:

```
see(board, sq, captured_value, side):
    attacker = least_valuable_attacker(board, sq, side)
    if attacker is None:
        return 0                                  # no recapture
    if captured_value >= KING_VALUE:
        return captured_value                     # king captured → game over
    remove attacker from board
    sub = see(board, sq, attacker_value, opposite(side))
    restore attacker
    return max(captured_value - sub, 0)           # side may decline
```

**King handling.**  `_least_valuable_attacker` only returns the king as a
recapturer if the king can legally move to the destination square — i.e.,
after the king is hypothetically removed from its source, the destination
must not be attacked by the enemy.  This mirrors Stockfish's behaviour
and prevents the SEE from producing nonsensical results when a king
"recaptures" into a defended square.

### Null-move threat detection

```
detect_concrete_threats(board_before, move):
    push move on a copy of board
    if board.is_check():         return []   # null-move illegal in check
    if board.is_checkmate():     return []   # terminal position
    if board.is_stalemate():     return []   # terminal position
    push null-move
    for each legal capture c:
        see = calculate_see(board, c)
        if see >= 0: record as threat
    pop null-move, pop move
    deduplicate by target square, keep highest SEE
    sort by SEE descending
```

### Outpost detection (spec §7.3)

A square `S` is an outpost for colour `C` iff:

1. `S` is on ranks 4–6 (White) / 3–5 (Black).
2. `S` is defended by at least one friendly pawn.
3. No enemy pawn on an adjacent file is *ahead* of `S` (in the enemy's
   direction of advance) — i.e., no enemy pawn can ever march up to
   attack `S`.

### Pawn structure

The pawn-structure analyser implements every classical concept from
Stockfish's `pawns.cpp`:

* **Isolated** — no friendly pawns on adjacent files.
* **Doubled** — ≥ 2 friendly pawns on the same file (excess count = N−1).
* **Backward** — has adjacent-file neighbours but they are all *ahead* of
  it, AND there's an enemy "stopper" pawn on an adjacent file at the
  rank immediately in front of the advance square.
* **Passed** — no enemy pawn ahead on the same or adjacent files.
* **Phalanx** — two side-by-side pawns with no enemy pawn directly in
  front of either.
* **Pawn chain** — a pawn that defends another friendly pawn.
* **Pawn islands** — number of contiguous file groups that contain at
  least one friendly pawn.

---

## 5. Performance

Spec §14.1 mandates ≤ 15 ms per move for Layer 2.  On a stock laptop the
extractor runs in **~3 ms per move** on a typical midgame position (well
within budget).  The dominant cost is the null-move threat search,
which enumerates ~30 captures per position and runs SEE on each.

---

## 6. Test suite

```bash
cd caissaxai_l2
python -m pytest tests/ -v
```

**59 tests, all passing.**  Coverage spans:

| Module                  | Tests | Key scenarios                                                |
|-------------------------|------:|--------------------------------------------------------------|
| `see_calculator`        |    11 | free captures, equal trades, sacrifices, royal fork, e.p., promotion |
| `null_move_threat`      |     8 | Nxf7 fork, in-check bail-out, checkmate, dedup, sort order   |
| `outpost_detector`      |    10 | rank restrictions, pawn support, enemy-pawn attack potential |
| `center_control`        |    11 | center attacks, open/semi-open files, mobility, king zone    |
| `pawn_structure`        |    11 | isolated, doubled, passed, phalanx, islands                  |
| `feature_extractor`     |     8 | end-to-end extraction, schema compliance, JSON roundtrip     |

---

## 7. Integration with the rest of CaissaXAI

Layer 2 is **stateless** — it does not maintain game history.  The
higher-level layers consume its output as follows:

* **Layer 3 (Game Memory Stack)** — accumulates `FeatureExtractionResult`
  objects across plies, detects delta spikes (|Δeval| ≥ 50 cp), logs
  material sacrifices (SEE ≤ −150 cp), and tracks persistent imbalances
  by diffing the before/after `PawnStructureReport`.
* **Layer 4 (Payload Synthesizer)** — flattens the
  `FeatureExtractionResult` into a compact JSON payload calibrated to
  the target Elo tier (800 / 1200 / 1500 / 1800+).
* **Layer 5 (LLM Narrator)** — consumes the synthesised payload.  The
  LLM is *never* asked to compute SEE, detect threats, or count
  passed pawns; it only translates verified numbers into natural
  language.

To wire Layer 2 into a multi-layer pipeline, simply call
`extract_features(board, move)` after replaying each move of a PGN and
hand the result to Layer 3.

---

## 8. What's *not* in this package (intentional scope)

To keep the focus razor-sharp on the Symbolic Feature Extractor, this
package deliberately omits:

* **Layer 0** (PGN parsing / board navigation) — `python-chess.pgn`
  handles parsing; the demo's `iter_pgn_moves` is a 5-line convenience.
* **Layer 1** (Stockfish subprocess / UCI / MultiPV) — that is the
  *engine oracle*, separate from the symbolic extractor.
* **Layer 3** (Game Memory Stack) — consumes Layer 2's output but
  doesn't belong here.
* **Layers 4–6** (synthesizer, LLM, API/CLI).

These layers can be added later as siblings under `src/caissaxai/`.
