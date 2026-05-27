import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';
import { Card, CardContent, CardHeader } from '@workspace/ui/components/card';

type TrendTone = 'positive' | 'negative' | 'neutral';

interface StatCardProps extends React.ComponentProps<typeof Card> {
  label: React.ReactNode;
  value: React.ReactNode;
  trend?: React.ReactNode;
  trendTone?: TrendTone;
  hint?: React.ReactNode;
}

function StatCard({
  label,
  value,
  trend,
  trendTone = 'neutral',
  hint,
  className,
  children,
  ...props
}: StatCardProps) {
  return (
    <Card
      data-slot="stat-card"
      className={cn('gap-1.5 rounded-lg py-[14px]', className)}
      {...props}
    >
      <CardHeader className="[.border-b]:pb-2 flex flex-row items-start justify-between gap-2 px-4">
        <span className="text-muted-foreground text-[11px] font-medium uppercase tracking-[0.06em]">
          {label}
        </span>
        {trend && (
          <span
            className={cn(
              'text-[11px] font-medium',
              trendTone === 'positive' && 'text-emerald-600',
              trendTone === 'negative' && 'text-destructive',
              trendTone === 'neutral' && 'text-muted-foreground',
            )}
          >
            {trend}
          </span>
        )}
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-3 px-4">
        <div className="flex flex-col gap-1">
          <span
            className="font-display text-[26px] tabular-nums leading-none tracking-[-0.02em]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {value}
          </span>
          {hint && <span className="text-muted-foreground text-[11px]">{hint}</span>}
        </div>
        {children && <div className="text-primary shrink-0 opacity-70">{children}</div>}
      </CardContent>
    </Card>
  );
}

export { StatCard };
export type { TrendTone };
