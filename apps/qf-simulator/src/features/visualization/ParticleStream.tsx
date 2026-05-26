import { useEffect, useState, useRef, useMemo } from 'react';

type FlowDirection = 'in' | 'out' | 'stable';

interface Particle {
  id: number;
  x: number; // 0-100 percentage
  y: number; // 0-100 percentage (0 = top, 100 = pool)
  direction: FlowDirection;
  createdAt: number;
}

interface Props {
  /** Amount in dollars - determines particle count */
  amount: number;
  /** 'direct' = cyan, 'matched' = magenta */
  type: 'direct' | 'matched';
  /** Height of the stream container */
  height?: number;
}

// Visual tuning
const DOLLARS_PER_PARTICLE = 1; // 1 particle per $1
const MAX_PARTICLES = 100; // Cap for performance
const POOL_Y = 35; // Pool position as percentage (35% down = centered in box)
const FLOW_SPEED = 2; // Percentage points per frame
const SHIMMER_AMPLITUDE = 20; // How much particles move when stable

/**
 * Particle stream with count = amount / DOLLARS_PER_PARTICLE.
 * - Inflow: New particles spawn at top, flow down to pool
 * - Outflow: Particles rise from pool and exit top
 * - Stable: Particles shimmer in pool area
 */
export function ParticleStream({ amount, type, height = 200 }: Props) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const nextId = useRef(0);
  const animationRef = useRef<number>(undefined);

  // Use ref for targetCount so animation always has latest value
  const targetCountRef = useRef(0);
  targetCountRef.current = Math.min(MAX_PARTICLES, Math.floor(amount / DOLLARS_PER_PARTICLE));

  // Main animation loop - runs continuously
  useEffect(() => {
    const animate = () => {
      const targetCount = targetCountRef.current;

      setParticles((prev) => {
        const now = performance.now();
        let updated = [...prev];
        const currentCount = updated.length;

        // INFLOW: Need more particles - spawn at top
        if (currentCount < targetCount) {
          const toSpawn = Math.min(5, targetCount - currentCount); // Spawn up to 5 per frame
          for (let i = 0; i < toSpawn; i++) {
            updated.push({
              id: nextId.current++,
              x: 15 + Math.random() * 70, // Random x position (15-85%)
              y: -10, // Start above container
              direction: 'in',
              createdAt: now,
            });
          }
        }

        // OUTFLOW: Too many particles - mark for removal (faster rate for visibility)
        if (currentCount > targetCount) {
          const toRemove = Math.min(10, currentCount - targetCount);
          let removed = 0;
          // First try stable particles, then any particle
          for (const p of updated) {
            if (removed >= toRemove) break;
            if (p.direction === 'stable') {
              p.direction = 'out';
              removed++;
            }
          }
          // If not enough stable particles, mark 'in' particles too
          if (removed < toRemove) {
            for (const p of updated) {
              if (removed >= toRemove) break;
              if (p.direction === 'in') {
                p.direction = 'out';
                removed++;
              }
            }
          }
        }

        // Animate each particle based on direction
        updated = updated
          .map((p) => {
            if (p.direction === 'in') {
              // Flow down toward pool
              const newY = p.y + FLOW_SPEED;
              if (newY >= POOL_Y) {
                return { ...p, y: POOL_Y + Math.random() * 5, direction: 'stable' as const };
              }
              return { ...p, y: newY };
            }

            if (p.direction === 'out') {
              // Flow up and out
              const newY = p.y - FLOW_SPEED;
              if (newY < -10) {
                return null; // Remove particle
              }
              return { ...p, y: newY };
            }

            // Stable: shimmer in pool
            const age = now - p.createdAt;
            const shimmer = Math.sin(age / 500 + p.id) * SHIMMER_AMPLITUDE;
            return { ...p, y: POOL_Y + shimmer };
          })
          .filter((p): p is Particle => p !== null);

        return updated;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []); // Run once, uses ref for latest targetCount

  const colorClass = type === 'direct' ? 'particle-cyan' : 'particle-magenta';

  // Particle size: smaller when more particles (4px at 1, 2px at 100)
  const particleSize = Math.max(2, 4 - (particles.length / 50));

  return (
    <div
      className={`particle-stream ${colorClass}`}
      style={{ height }}
    >
      {particles.map((p) => (
        <span
          key={p.id}
          className="particle"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            opacity: p.direction === 'out' ? 0.5 : 1,
            width: `${particleSize}px`,
            height: `${particleSize}px`,
          }}
        />
      ))}
      <div className="stream-label">
        {type === 'direct' ? 'Direct' : 'Matched'}
        <span className="stream-amount">${amount.toFixed(2)}</span>
      </div>
    </div>
  );
}
