import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';

interface SparklineProps extends Omit<React.SVGAttributes<SVGSVGElement>, 'fill'> {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
  fill?: boolean;
}

function Sparkline({
  data,
  color = 'currentColor',
  width = 60,
  height = 18,
  strokeWidth = 1.5,
  fill = false,
  className,
  ...props
}: SparklineProps) {
  if (!data.length) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const padY = strokeWidth / 2;

  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - padY - ((v - min) / range) * (height - padY * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const areaPath = fill
    ? `M0,${height} L${points.split(' ').join(' L')} L${width},${height} Z`.replace(/ L/g, ' ')
    : null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('text-primary', className)}
      preserveAspectRatio="none"
      aria-hidden="true"
      {...props}
    >
      {fill && areaPath && (
        <polygon points={`0,${height} ${points} ${width},${height}`} fill={color} opacity={0.12} />
      )}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export { Sparkline };
