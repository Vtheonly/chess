import { Chess } from 'chess.js';
import { evaluate, see } from '/home/z/my-project/src/lib/chess/engine.ts';
import { generateTilesAndCalc, checkNarrativeAgainstTiles } from '/home/z/my-project/src/lib/chess/ruleTiles.ts';

interface TestCase {
  name: string;
  fenBefore: string;
  moveUci: string;
  narrative: string;
  expectPassed: boolean;
  expectViolationContains?: string[];
}

const cases: TestCase[] = [
  // ─── Original bug from the screenshot ────────────────────────────────
  {
    name: 'c6 "develops the bishop" (original hallucination)',
    fenBefore: 'rnbqkbnr/ppppppp1/7p/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 1 2',
    moveUci: 'c7c6',
    narrative: "Black plays c6, which develops the bishop and challenges White's center. This is a solid developing move.",
    expectPassed: false,
    expectViolationContains: ['piece development', 'do NOT develop pieces'],
  },
  // ─── Hallucinations the OLD 6-rule filter missed ─────────────────────
  {
    name: 'quiet move claims "creates a passed pawn" (no tile fired)',
    fenBefore: 'rnbqkbnr/ppppppp1/7p/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 1 2',
    moveUci: 'a7a6',
    narrative: "Black plays a6, creating a passed pawn and securing the bishop pair advantage.",
    expectPassed: false,
    expectViolationContains: ['passed pawn', 'bishop pair'],
  },
  {
    name: 'claims "luft" + "initiative" + "prophylactic" (3 unverifiable concepts)',
    fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    moveUci: 'g1f3',
    narrative: "White plays Nf3, making luft for the king and seizing the initiative with a prophylactic move.",
    expectPassed: false,
    expectViolationContains: ['luft', 'initiative', 'prophylax'],
  },
  {
    name: 'claims "bishop pair" (unverifiable)',
    fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    moveUci: 'f1c4',
    narrative: "White develops the bishop to c4, securing the bishop pair advantage.",
    expectPassed: false,
    expectViolationContains: ['bishop pair'],
  },
  {
    name: 'claims "zugzwang" (unverifiable)',
    fenBefore: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1',
    moveUci: 'd1e2',
    narrative: "This move creates zugzwang — the opponent has no good moves. The king opposition is decisive.",
    expectPassed: false,
    expectViolationContains: ['zugzwang', 'opposition'],
  },
  {
    name: 'claims "trapped piece" + "overloaded" (unverifiable)',
    fenBefore: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1',
    moveUci: 'd1e2',
    narrative: "White's queen move traps the enemy knight and exploits an overloaded piece defending f7.",
    expectPassed: false,
    expectViolationContains: ['trapped', 'overloaded'],
  },
  {
    name: 'claims "backward pawn" + "bad bishop" (unverifiable)',
    fenBefore: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1',
    moveUci: 'd1e2',
    narrative: "This creates a backward pawn and a bad bishop for Black.",
    expectPassed: false,
    expectViolationContains: ['backward', 'bad bishop'],
  },
  {
    name: 'quiet move a3 with strategic claims (empty-tiles fallback)',
    fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    moveUci: 'a2a3',
    narrative: "White plays a3, developing the bishop and controlling the center with a prophylactic luft move.",
    expectPassed: false,
    expectViolationContains: ['No atomic rule tiles fired', 'piece development', 'luft', 'prophylax'],
  },
  // ─── Valid narratives that should PASS ───────────────────────────────
  {
    name: 'Nf3 develops the knight (valid — DEVELOPMENT tile fires)',
    fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    moveUci: 'g1f3',
    narrative: "White plays Nf3, a natural developing move that increases mobility.",
    expectPassed: true,
  },
  {
    name: 'quiet move a3 with only tactical facts (empty-tiles fallback passes)',
    fenBefore: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    moveUci: 'a2a3',
    narrative: "White plays a3. The evaluation changes by +5cp. No capture was made. No check was given.",
    expectPassed: true,
  },
  {
    name: 'Nxe5 does NOT win material (correctly flagged — knight recaptured by Nc6)',
    fenBefore: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1',
    moveUci: 'f3e5',
    narrative: "White wins a pawn with Nxe5, gaining material.",
    expectPassed: false,
    expectViolationContains: ['winning material', 'SEE'],
  },
];

let passCount = 0;
let failCount = 0;

for (const tc of cases) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`TEST: ${tc.name}`);
  console.log(`${'─'.repeat(70)}`);

  const board = new Chess(tc.fenBefore);
  const mv = board.move(tc.moveUci);
  if (!mv) {
    console.log('  SKIP: invalid move');
    continue;
  }
  const fenAfter = board.fen();
  const seeScore = see(tc.fenBefore, mv.lan);
  const eBefore = evaluate(tc.fenBefore);
  const eAfter = evaluate(fenAfter);

  const concreteThreats: Array<{ san: string; gainCp: number; target: string; piece: string }> = [];
  if (!board.isCheckmate() && !board.isStalemate()) {
    try {
      const fenParts = fenAfter.split(' ');
      fenParts[1] = fenParts[1] === 'w' ? 'b' : 'w';
      fenParts[3] = '-';
      const tmp = new Chess();
      tmp.load(fenParts.join(' '));
      const caps = tmp.moves({ verbose: true }) as any[];
      for (const m of caps.slice(0, 12)) {
        if (!m.captured) continue;
        const gain = see(tmp.fen(), m.lan);
        if (gain >= 0) concreteThreats.push({ san: m.san, gainCp: gain, target: m.to, piece: m.captured });
      }
    } catch {}
  }

  const { tiles } = generateTilesAndCalc({
    fenBefore: tc.fenBefore, fenAfter,
    moveUci: mv.lan, moveSan: mv.san,
    playerColor: mv.color === 'w' ? 'white' : 'black',
    seeScore,
    isCapture: !!mv.captured, isCheck: board.inCheck(), isCheckmate: board.isCheckmate(),
    capturedPiece: mv.captured,
    concreteThreats,
    evalBeforeCp: eBefore.cp, evalAfterCp: eAfter.cp,
  });

  console.log(`  Tiles fired: ${tiles.length === 0 ? '(none)' : tiles.map(t => `${t.ruleName}(${t.weightedPointsCp >= 0 ? '+' : ''}${t.weightedPointsCp}cp)`).join(', ')}`);

  const synthInput = {
    fenBefore: tc.fenBefore, fenAfter,
    moveUci: mv.lan, moveSan: mv.san,
    playerColor: (mv.color === 'w' ? 'white' : 'black') as 'white' | 'black',
    seeScore,
    isCapture: !!mv.captured, isCheck: board.inCheck(), isCheckmate: board.isCheckmate(),
    capturedPiece: mv.captured,
    concreteThreats,
    evalBeforeCp: eBefore.cp, evalAfterCp: eAfter.cp,
  };

  const result = checkNarrativeAgainstTiles(tc.narrative, tiles, synthInput);

  console.log(`  Narrative: "${tc.narrative.slice(0, 80)}${tc.narrative.length > 80 ? '...' : ''}"`);
  console.log(`  Filter passed: ${result.passed}`);
  if (result.violations.length > 0) {
    console.log(`  Violations (${result.violations.length}):`);
    for (const v of result.violations) {
      console.log(`    → ${v.slice(0, 120)}${v.length > 120 ? '...' : ''}`);
    }
  }

  let testPassed = true;
  if (result.passed !== tc.expectPassed) {
    console.log(`  ❌ FAIL: expected passed=${tc.expectPassed}, got ${result.passed}`);
    testPassed = false;
  }
  if (tc.expectViolationContains) {
    for (const substr of tc.expectViolationContains) {
      const found = result.violations.some(v => v.toLowerCase().includes(substr.toLowerCase()));
      if (!found) {
        console.log(`  ❌ FAIL: expected a violation containing "${substr}", none found`);
        testPassed = false;
      }
    }
  }
  if (testPassed) {
    console.log(`  ✅ PASS`);
    passCount++;
  } else {
    failCount++;
  }
}

console.log(`\n${'═'.repeat(70)}`);
console.log(`RESULTS: ${passCount} passed, ${failCount} failed`);
console.log(`${'═'.repeat(70)}`);
