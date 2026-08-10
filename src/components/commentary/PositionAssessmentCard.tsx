// PositionAssessmentCard — renders the 360° position health audit.
// Shows White/Black strengths & vulnerabilities side-by-side.

'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PositionHealthAssessment } from '@/lib/chess/positionAssessor';

interface Props {
  assessment: PositionHealthAssessment;
}

export function PositionAssessmentCard({ assessment }: Props) {
  const evalColor = assessment.evalCp > 50 ? 'text-emerald-400'
    : assessment.evalCp < -50 ? 'text-rose-400' : 'text-amber-400';
  const evalBg = assessment.evalCp > 50 ? 'bg-emerald-500/10 border-emerald-500/30'
    : assessment.evalCp < -50 ? 'bg-rose-500/10 border-rose-500/30'
    : 'bg-amber-500/10 border-amber-500/30';

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <span className="text-lg"></span>
            Position Health Audit
          </span>
          <span className={`text-xs px-2.5 py-1 rounded-full font-mono font-bold border ${evalBg} ${evalColor}`}>
            {assessment.evalCp > 0 ? '+' : ''}{(assessment.evalCp / 100).toFixed(2)} cp
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <p className="text-xs text-slate-300 font-medium bg-slate-900/50 p-2 rounded border border-slate-700/50">
          {assessment.statusHeadline}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {/* White */}
          <div className="space-y-2 bg-slate-900/30 p-2.5 rounded border border-slate-700/40">
            <div className="font-semibold text-emerald-400 flex items-center gap-1">
              <span></span> White Key Assets
            </div>
            {assessment.whiteStrengths.length > 0 ? (
              <ul className="space-y-1">
                {assessment.whiteStrengths.map((item, idx) => (
                  <li key={idx} className="text-slate-300 flex items-start gap-1.5">
                    <span className="text-emerald-400 font-bold">•</span>
                    <span>
                      <strong className="text-slate-200">{item.concept.icon} {item.concept.name}:</strong>{' '}
                      {item.description}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500 italic">No major structural assets</p>
            )}
            {assessment.whiteWeaknesses.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-800">
                <div className="font-semibold text-rose-400 flex items-center gap-1 mb-1">
                  <span></span> White Vulnerabilities
                </div>
                <ul className="space-y-1">
                  {assessment.whiteWeaknesses.map((item, idx) => (
                    <li key={idx} className="text-slate-300 flex items-start gap-1.5">
                      <span className="text-rose-400 font-bold">•</span>
                      <span>{item.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Black */}
          <div className="space-y-2 bg-slate-900/30 p-2.5 rounded border border-slate-700/40">
            <div className="font-semibold text-emerald-400 flex items-center gap-1">
              <span></span> Black Key Assets
            </div>
            {assessment.blackStrengths.length > 0 ? (
              <ul className="space-y-1">
                {assessment.blackStrengths.map((item, idx) => (
                  <li key={idx} className="text-slate-300 flex items-start gap-1.5">
                    <span className="text-emerald-400 font-bold">•</span>
                    <span>
                      <strong className="text-slate-200">{item.concept.icon} {item.concept.name}:</strong>{' '}
                      {item.description}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500 italic">No major structural assets</p>
            )}
            {assessment.blackWeaknesses.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-800">
                <div className="font-semibold text-rose-400 flex items-center gap-1 mb-1">
                  <span></span> Black Vulnerabilities
                </div>
                <ul className="space-y-1">
                  {assessment.blackWeaknesses.map((item, idx) => (
                    <li key={idx} className="text-slate-300 flex items-start gap-1.5">
                      <span className="text-rose-400 font-bold">•</span>
                      <span>{item.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
