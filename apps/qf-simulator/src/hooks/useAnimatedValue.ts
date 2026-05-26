import { useEffect, useState, useRef } from 'react';

interface UseAnimatedValueOptions {
  duration?: number;
  decimals?: number;
}

/**
 * Smoothly animates between numeric values using requestAnimationFrame.
 * Used for animating CLR calculations, totals, and matching amounts.
 *
 * @param targetValue - The value to animate to
 * @param options.duration - Animation duration in ms (default: 500)
 * @param options.decimals - Number of decimal places (default: 2)
 * @returns The current animated value
 *
 * @example
 * const animatedTotal = useAnimatedValue(clrResult.totalMatch, { duration: 600 });
 */
export function useAnimatedValue(
  targetValue: number,
  options: UseAnimatedValueOptions = {}
): number {
  const { duration = 500, decimals = 2 } = options;
  const [displayValue, setDisplayValue] = useState(targetValue);
  const startValue = useRef(targetValue);
  const startTime = useRef<number | null>(null);
  const animationFrame = useRef<number | null>(null);

  useEffect(() => {
    startValue.current = displayValue;
    startTime.current = null;

    const animate = (timestamp: number) => {
      if (startTime.current === null) {
        startTime.current = timestamp;
      }

      const elapsed = timestamp - startTime.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);

      const current = startValue.current + (targetValue - startValue.current) * eased;
      const rounded = Number(current.toFixed(decimals));

      setDisplayValue(rounded);

      if (progress < 1) {
        animationFrame.current = requestAnimationFrame(animate);
      }
    };

    animationFrame.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrame.current !== null) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [targetValue, duration, decimals]);

  return displayValue;
}
