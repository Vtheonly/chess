// EvalChart — Recharts line chart of evaluation vs ply.

'use client';

import { useGameStore } from '@/store/useGameStore';
import { LineChart, Line, XAxis, YAxis, ReferenceLine, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp } from 'lucide-react';

export function EvalChart() {
  const moveHistory = useGameStore((s) => s.moveHistory);
  const currentPly = useGameStore((s) => s.currentPly);
  const navigateToPly = useGameStore((s) => s.navigateToPly);

  const data = moveHistory.map((m) => ({
    ply: m.ply,
    eval: m.evalCp / 100,  // convert to pawns
    san: m.san,
    classification: m.classification,
  }));

  // Insert initial position (ply -1, eval 0)
  data.unshift({ ply: -1, eval: 0, san: 'start', classification: undefined });

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-emerald-400" />
          Evaluation Graph
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {data.length <= 1 ? (
          <div className="text-center text-slate-500 py-8 text-sm">
            No moves to chart yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart
              data={data}
              margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
              onClick={(e: any) => {
                if (e?.activeTooltipIndex !== undefined) {
                  navigateToPly(e.activeTooltipIndex - 1);
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="ply" stroke="#64748b" fontSize={10} />
              <YAxis
                stroke="#64748b"
                fontSize={10}
                domain={[-5, 5]}
                ticks={[-5, -3, -1, 0, 1, 3, 5]}
              />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="2 2" />
              <Tooltip
                contentStyle={{
                  background: '#1E293B',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
                labelStyle={{ color: '#94A3B8' }}
                formatter={(value: any) => [`${value >= 0 ? '+' : ''}${Number(value).toFixed(2)}`, 'Eval']}
                labelFormatter={(label: any) => `Ply ${label}`}
              />
              <Line
                type="monotone"
                dataKey="eval"
                stroke="#6366F1"
                strokeWidth={2}
                dot={{ fill: '#6366F1', r: 2 }}
                activeDot={{ r: 5, fill: '#FBBF24', cursor: 'pointer' }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
