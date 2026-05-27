import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';

type TimelineState = 'done' | 'active' | 'todo';

function Timeline({ className, ...props }: React.ComponentProps<'ol'>) {
  return <ol data-slot="timeline" className={cn('relative flex flex-col', className)} {...props} />;
}

interface TimelineItemProps extends Omit<React.ComponentProps<'li'>, 'title'> {
  date: React.ReactNode;
  state?: TimelineState;
  title: React.ReactNode;
  description?: React.ReactNode;
  isLast?: boolean;
}

function TimelineItem({
  date,
  state = 'todo',
  title,
  description,
  isLast = false,
  className,
  ...props
}: TimelineItemProps) {
  return (
    <li
      data-slot="timeline-item"
      data-state={state}
      className={cn('relative flex gap-3 pb-4 last:pb-0', className)}
      {...props}
    >
      <div className="flex w-14 shrink-0 items-start pt-0.5">
        <span className="text-muted-foreground font-mono text-[11px] uppercase tracking-tight">
          {date}
        </span>
      </div>
      <div className="relative flex flex-col items-center">
        <span
          className={cn(
            'mt-1 size-2.5 rounded-full ring-4',
            state === 'done' && 'bg-primary ring-primary/15',
            state === 'active' && 'animate-pulse bg-emerald-500 ring-emerald-500/20',
            state === 'todo' && 'bg-muted-foreground/30 ring-muted-foreground/10',
          )}
        />
        {!isLast && (
          <span
            className={cn('mt-1 w-px flex-1', state === 'done' ? 'bg-primary/30' : 'bg-border')}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 pb-2">
        <span
          className={cn(
            'text-sm font-medium leading-tight',
            state === 'todo' && 'text-muted-foreground',
          )}
        >
          {title}
        </span>
        {description && (
          <span className="text-muted-foreground text-xs leading-snug">{description}</span>
        )}
      </div>
    </li>
  );
}

export { Timeline, TimelineItem };
export type { TimelineState };
