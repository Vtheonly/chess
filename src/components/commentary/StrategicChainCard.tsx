// StrategicChainCard — renders the 7-Stage Master Strategic Chain narrative.
// Shows the complete multi-move plan: immediate impact, threats, expected
// responses, long-term goals, and counterfactual analysis.

'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { MultiMoveStrategicChain } from '@/lib/chess/multiMoveChainAnalyzer';

interface Props {
  chain: MultiMoveStrategicChain;
  onExploreVariation: () => void;
}

export function StrategicChainCard({ chain, onExploreVariation }: Props) {
  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <span className="text-lg">🔭</span>
            Multi-Move Strategic Chain
          </span>
          <Button size="sm" onClick={onExploreVariation} className="bg-indigo-600 hover:bg-indigo-500">
            <span>🎬</span> Play Variation
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2 text-xs">
        <div className="bg-slate-900/40 p-2.5 rounded border border-slate-700/50">
          <strong className="text-indigo-400 block mb-0.5">1. Immediate Impact (Now):</strong>
          <p className="text-slate-300">{chain.immediateImpactNow}</p>
        </div>
        <div className="bg-slate-900/40 p-2.5 rounded border border-slate-700/50">
          <strong className="text-amber-400 block mb-0.5">2. Threat / Preparation (Next Move):</strong>
          <p className="text-slate-300">{chain.immediateThreatNextMove}</p>
        </div>
        <div className="bg-slate-900/40 p-2.5 rounded border border-slate-700/50">
          <strong className="text-rose-400 block mb-0.5">3. Expected Opponent Response:</strong>
          <p className="text-slate-300">{chain.expectedOpponentResponse}</p>
        </div>
        <div className="bg-slate-900/40 p-2.5 rounded border border-slate-700/50">
          <strong className="text-emerald-400 block mb-0.5">4. Positional Shift After Response:</strong>
          <p className="text-slate-300">{chain.positionalShiftAfterResponse}</p>
        </div>
        <div className="bg-slate-900/40 p-2.5 rounded border border-slate-700/50">
          <strong className="text-sky-400 block mb-0.5">5. Long-Term Engine Goal (4–6 Moves Ahead):</strong>
          <p className="text-slate-300">{chain.longTermEngineGoal}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
          <div className="bg-emerald-950/30 p-2.5 rounded border border-emerald-800/50">
            <strong className="text-emerald-300 block mb-0.5">6. Why Resulting Position Is Preferable:</strong>
            <p className="text-slate-300">{chain.whyResultingPositionPreferable}</p>
          </div>
          <div className="bg-purple-950/30 p-2.5 rounded border border-purple-800/50">
            <strong className="text-purple-300 block mb-0.5">7. Counterfactual Line:</strong>
            <p className="text-slate-300">{chain.counterfactualAlternative}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
