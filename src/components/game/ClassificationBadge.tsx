// ClassificationBadge — color-coded pill showing the move's classification.

'use client';

import { CLASSIFICATION_META, type MoveClassification } from '@/types/chess';

interface Props {
  classification: MoveClassification;
  size?: 'sm' | 'md' | 'lg';
}

export function ClassificationBadge({ classification, size = 'md' }: Props) {
  const meta = CLASSIFICATION_META[classification];
  const sizes = {
    sm: 'w-5 h-5 text-[10px]',
    md: 'w-6 h-6 text-xs',
    lg: 'w-8 h-8 text-sm',
  };
  return (
    <div
      className={`inline-flex items-center justify-center rounded-full font-bold ${sizes[size]}`}
      style={{
        background: meta.bg,
        color: meta.color,
        border: `1.5px solid ${meta.color}`,
      }}
      title={`${meta.label} (${classification})`}
    >
      {meta.symbol}
    </div>
  );
}
