# ADR-411: React Animation and Design System for QF Simulator

## Status
Proposed

## Context
Phase 1 of the Awwards QF Simulator redesign requires establishing the animation foundation and design system. Key decisions needed:

1. Which animation library for React (Motion vs GSAP vs React Spring)
2. How to implement smooth number transitions (useAnimatedValue hook)
3. How to structure CSS for dark theme with neon glow effects
4. Performance considerations for 60fps animations

## Research Findings

### Web Sources

1. **Motion IS Framer Motion** - As of late 2024, Framer Motion was rebranded to "Motion" and made independent. Package is now `motion/react` with 12M+ monthly downloads.
   — [Motion Blog](https://motion.dev/blog/do-you-still-need-framer-motion)

2. **Library Selection Matrix 2025**:
   - Most React projects → Motion (40% faster implementation than GSAP)
   - Animation-heavy marketing → GSAP (pixel-perfect timeline control)
   - Physics-based organic → React Spring
   - Bundle-critical → Motion One (3.8kb)
   — [Dev.to React Animation Libraries 2025](https://dev.to/raajaryan/react-animation-libraries-in-2025-what-companies-are-actually-using-3lik)

3. **For 60fps performance**: Only animate `transform` and `opacity` - these trigger GPU compositing, not layout recalculation
   — [Motion Performance Guide](https://motion.dev/docs/performance)

### Expert Opinions (Twitter/X)

- **@mattgperry (Matt Perry, Motion creator)**: Motion's hybrid engine combines Web Animations API for GPU acceleration with JavaScript for flexibility. Now supports React, Vue, and vanilla JS.

- **Consensus on neon glow UIs**: "Neon colors and white don't mix. Glow effects require dark backgrounds to work. Layer multiple shadows with increasing blur radii."
  — [Design Shack](https://designshack.net/articles/graphics/neon-colors-web-design/)

- **Accessibility warning**: Must implement `prefers-reduced-motion` - replace transform animations with opacity, Motion has built-in `useReducedMotion` hook.

### Production Examples (GitHub)

1. **[driaug/animated-counter](https://github.com/driaug/animated-counter)** - Uses `useMotionValue` + `useSpring` + `useInView` pattern:
   ```typescript
   const motionValue = useMotionValue(0);
   const springValue = useSpring(motionValue, { damping: 100, stiffness: 100 });
   useEffect(() => springValue.on("change", (latest) => {
     ref.current.textContent = latest.toFixed(0);
   }), [springValue]);
   ```

2. **[tsParticles](https://github.com/tsparticles/tsparticles)** - For particle systems, use Canvas not DOM. Motion is designed for DOM element animations, not 100+ particles.

3. **Neon glow CSS pattern**:
   ```css
   box-shadow:
     0 0 5px rgba(0, 255, 255, 0.5),
     0 0 15px rgba(0, 255, 255, 0.3),
     0 0 30px rgba(0, 255, 255, 0.1);
   ```

### Official Guidance

1. **Motion React minimum**: React 18+ required
2. **Motion DevTools**: Incompatible with Motion v11+ - not a concern for our use case
3. **AnimatePresence modes**: `"wait"` for sequential, `"popLayout"` for list removals
4. **useReducedMotion**: Actively responds to system setting changes and re-renders

**box-shadow performance warning**: CPU-heavy, triggers repaints every frame. Solutions:
- Use pseudo-element with opacity animation instead
- Or use `filter: drop-shadow()` (hardware accelerated)

**requestAnimationFrame best practices**:
- Always use the timestamp argument
- It's one-shot - must call again for continuation
- Animations auto-pause in background tabs

## Decision

### Animation Library: Motion (v12.x)

**Rationale:**
- Industry standard for React (Stripe, Notion, Framer use it)
- Best declarative API for component animations
- Built-in accessibility (`useReducedMotion`)
- Hybrid engine with automatic GPU acceleration
- 40% faster development than GSAP per industry data

**Import pattern:**
```typescript
import { motion, AnimatePresence, useMotionValue, useSpring } from "motion/react"
```

### Animated Number Pattern: useMotionValue + useSpring

**NOT useState** - this avoids React re-renders on every frame.

```typescript
// Recommended pattern from production examples
function AnimatedNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(0);
  const springValue = useSpring(motionValue, { damping: 100, stiffness: 100 });

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  useEffect(() => {
    return springValue.on("change", (latest) => {
      if (ref.current) {
        ref.current.textContent = latest.toFixed(2);
      }
    });
  }, [springValue]);

  return <span ref={ref} />;
}
```

**Alternative (simpler, from PLAN.md):** requestAnimationFrame hook is also valid for cases where spring physics aren't needed. The existing plan's `useAnimatedValue` hook is acceptable but consider switching to Motion's `useSpring` for consistency.

### CSS Design Tokens Structure

```css
:root {
  /* Colors - Dark Theme */
  --color-bg-deep: #0a0a0f;
  --color-bg-surface: #12121a;
  --color-bg-elevated: #1a1a24;

  /* Neon Accents - Layered glow technique */
  --color-accent-cyan: #00ffff;
  --color-accent-magenta: #ff00ff;
  --glow-cyan-sm: 0 0 5px rgba(0, 255, 255, 0.5);
  --glow-cyan-md: 0 0 15px rgba(0, 255, 255, 0.3);
  --glow-cyan-lg: 0 0 30px rgba(0, 255, 255, 0.1);

  /* Typography */
  --font-mono: 'JetBrains Mono', monospace;
}
```

### Glow Effect Implementation

Use layered shadows (not animated box-shadow):

```css
.glow-card {
  box-shadow:
    var(--glow-cyan-sm),
    var(--glow-cyan-md),
    var(--glow-cyan-lg);
}

/* For animated glow, use opacity on pseudo-element */
.glow-card::after {
  content: "";
  position: absolute;
  inset: 0;
  box-shadow: 0 0 40px rgba(0, 255, 255, 0.4);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.glow-card:hover::after {
  opacity: 1;
}
```

### Particle System: Canvas (Phase 2)

For the particle stream visualization in Phase 2, use **Canvas + requestAnimationFrame**, not Motion. Motion is DOM-based and will struggle with 100+ particles. Consider:
- tsParticles (`@tsparticles/react`) for ready-made effects
- Custom Canvas implementation for precise control

## Consequences

### Positive
- Motion's hybrid engine ensures 60fps performance
- Spring physics give natural, organic feel to number transitions
- CSS custom properties enable consistent theming
- Layered shadow technique avoids box-shadow performance issues
- Built-in accessibility with `useReducedMotion`

### Negative
- Motion bundle size (~17kb) vs lighter alternatives
- Limited tree-shaking due to tightly coupled structure
- Need separate Canvas approach for particle system (adds complexity)

### Trade-offs
- Accepting larger bundle for better DX and ecosystem support
- Using two animation approaches (Motion for UI, Canvas for particles) adds complexity but ensures performance

## Implementation Notes for Phase 1

1. **Task 1.1**: Add `motion` package (not `framer-motion`)
2. **Task 1.2**: CSS design tokens with layered glow shadows
3. **Task 1.3**: `useAnimatedValue` hook - can use either:
   - Motion's `useMotionValue` + `useSpring` (recommended for consistency)
   - requestAnimationFrame approach (as specified in PLAN.md)

Both are valid. The PLAN.md approach is simpler and doesn't require Motion, which is fine for Phase 1. Phase 2+ can leverage Motion's spring physics.

## References

- [Motion Documentation](https://motion.dev/docs)
- [Motion Performance Guide](https://motion.dev/docs/performance)
- [Motion Accessibility](https://motion.dev/docs/react-accessibility)
- [Motion useReducedMotion](https://motion.dev/docs/react-use-reduced-motion)
- [AnimatePresence Modes](https://motion.dev/docs/react-animate-presence)
- [How to Animate Box-Shadow (Tobias Ahlin)](https://tobiasahlin.com/blog/how-to-animate-box-shadow/)
- [CSS Glow Effects](https://codersblock.com/blog/creating-glow-effects-with-css/)
- [MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame)
- [driaug/animated-counter](https://github.com/driaug/animated-counter)
- [tsParticles](https://github.com/tsparticles/tsparticles)
