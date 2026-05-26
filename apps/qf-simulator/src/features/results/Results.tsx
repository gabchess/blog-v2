import { motion } from 'motion/react';
import { useMemo } from 'react';
import type { Round, ProjectResult } from '../../api/client';
import { useAnimatedValue } from '../../hooks';

interface Props {
  round: Round;
}

// Animated value display for results numbers
function AnimatedValue({
  value,
  decimals = 2,
  prefix = '',
}: {
  value: number;
  decimals?: number;
  prefix?: string;
}) {
  const animated = useAnimatedValue(value, { duration: 800, decimals });
  return (
    <>
      {prefix}
      {decimals === 0 ? Math.round(animated) : animated.toFixed(decimals)}
    </>
  );
}

// Cubic-bezier easing — typed as tuple for motion v12
const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE_OUT_EXPO },
  },
};

const barVariants = {
  hidden: { scaleX: 0 },
  visible: (delay: number) => ({
    scaleX: 1,
    transition: { duration: 0.8, delay, ease: EASE_OUT_EXPO },
  }),
};

// Single project result card with visual bar
function ProjectCard({
  project,
  maxTotal,
  rank,
  isWinner,
}: {
  project: ProjectResult;
  maxTotal: number;
  rank: number;
  isWinner: boolean;
}) {
  const directPercent = (project.directContributions / maxTotal) * 100;
  const matchedPercent = (project.scaledMatch / maxTotal) * 100;

  return (
    <motion.div
      className={`result-card ${isWinner ? 'result-card--winner' : ''}`}
      variants={itemVariants}
    >
      <div className="result-card__header">
        <span className="result-card__rank">#{rank}</span>
        <span className="result-card__name">{project.projectName}</span>
        <span className="result-card__total">
          <AnimatedValue value={project.total} prefix="$" />
        </span>
      </div>

      <div className="result-card__bar-container">
        {/* Direct contributions bar */}
        <motion.div
          className="result-card__bar result-card__bar--direct"
          style={{ width: `${directPercent}%` }}
          variants={barVariants}
          custom={rank * 0.1}
        />
        {/* Matched funds bar */}
        <motion.div
          className="result-card__bar result-card__bar--matched"
          style={{
            width: `${matchedPercent}%`,
            left: `${directPercent}%`,
          }}
          variants={barVariants}
          custom={rank * 0.1 + 0.2}
        />
      </div>

      <div className="result-card__breakdown">
        <div className="result-card__stat">
          <span className="result-card__stat-label">Direct</span>
          <span className="result-card__stat-value result-card__stat-value--direct">
            <AnimatedValue value={project.directContributions} prefix="$" />
          </span>
        </div>
        <div className="result-card__stat">
          <span className="result-card__stat-label">Matched</span>
          <span className="result-card__stat-value result-card__stat-value--matched">
            <AnimatedValue value={project.scaledMatch} prefix="$" />
          </span>
        </div>
        <div className="result-card__stat result-card__stat--multiplier">
          <span className="result-card__stat-label">Multiplier</span>
          <span className="result-card__stat-value">
            {project.directContributions > 0
              ? `${(project.total / project.directContributions).toFixed(1)}×`
              : '—'}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// Summary stat box
function SummaryStat({
  label,
  value,
  prefix = '',
  suffix = '',
  decimals = 2,
  highlight = false,
}: {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  highlight?: boolean;
}) {
  return (
    <motion.div
      className={`summary-stat ${highlight ? 'summary-stat--highlight' : ''}`}
      variants={itemVariants}
    >
      <div className="summary-stat__value">
        <AnimatedValue value={value} prefix={prefix} decimals={decimals} />
        {suffix}
      </div>
      <div className="summary-stat__label">{label}</div>
    </motion.div>
  );
}

// Distribution donut chart
function DistributionChart({
  directTotal,
  matchedTotal,
}: {
  directTotal: number;
  matchedTotal: number;
}) {
  const total = directTotal + matchedTotal;
  const directAngle = (directTotal / total) * 360;

  return (
    <motion.div className="distribution-chart" variants={itemVariants}>
      <svg viewBox="0 0 100 100" className="distribution-chart__svg">
        {/* Background circle */}
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="12"
        />
        {/* Matched segment (magenta) */}
        <motion.circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="var(--color-accent-magenta)"
          strokeWidth="12"
          strokeDasharray={`${2 * Math.PI * 40}`}
          strokeDashoffset="0"
          transform="rotate(-90 50 50)"
          initial={{ strokeDashoffset: 2 * Math.PI * 40 }}
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration: 1, delay: 0.5, ease: EASE_OUT_EXPO }}
          style={{ filter: 'drop-shadow(0 0 8px rgba(255, 0, 255, 0.5))' }}
        />
        {/* Direct segment (cyan) - overlays part of matched */}
        <motion.circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="var(--color-accent-cyan)"
          strokeWidth="12"
          strokeDasharray={`${(directAngle / 360) * 2 * Math.PI * 40} ${2 * Math.PI * 40}`}
          transform="rotate(-90 50 50)"
          initial={{ strokeDashoffset: 2 * Math.PI * 40 }}
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration: 1, delay: 0.8, ease: EASE_OUT_EXPO }}
          style={{ filter: 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.5))' }}
        />
        {/* Center text */}
        <text
          x="50"
          y="46"
          textAnchor="middle"
          fill="var(--color-text-primary)"
          fontSize="8"
          fontFamily="var(--font-mono)"
          fontWeight="600"
        >
          ${total.toFixed(0)}
        </text>
        <text
          x="50"
          y="56"
          textAnchor="middle"
          fill="var(--color-text-muted)"
          fontSize="4"
          fontFamily="var(--font-mono)"
        >
          TOTAL
        </text>
      </svg>
      <div className="distribution-chart__legend">
        <div className="distribution-chart__legend-item">
          <span className="distribution-chart__dot distribution-chart__dot--direct" />
          <span>Direct (${directTotal.toFixed(0)})</span>
        </div>
        <div className="distribution-chart__legend-item">
          <span className="distribution-chart__dot distribution-chart__dot--matched" />
          <span>Matched (${matchedTotal.toFixed(0)})</span>
        </div>
      </div>
    </motion.div>
  );
}

export function Results({ round }: Props) {
  if (!round.results) {
    return <div className="results-empty">No results available</div>;
  }

  const { results } = round;

  // Sort projects by total funding
  const sortedProjects = useMemo(
    () => [...results.projects].sort((a, b) => b.total - a.total),
    [results.projects]
  );

  const maxTotal = sortedProjects[0]?.total ?? 0;

  // Calculate totals for chart
  const directTotal = results.projects.reduce((sum, p) => sum + p.directContributions, 0);
  const matchedTotal = results.projects.reduce((sum, p) => sum + p.scaledMatch, 0);

  return (
    <motion.div
      className="results-page"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Hero header */}
      <motion.div className="results-hero" variants={itemVariants}>
        <h1 className="results-hero__title">{round.name}</h1>
        <p className="results-hero__subtitle">Final Distribution</p>
      </motion.div>

      {/* Summary stats row */}
      <motion.div className="results-summary" variants={containerVariants}>
        <SummaryStat
          label="Matching Pool"
          value={round.matchingPool}
          prefix="$"
          decimals={0}
          highlight
        />
        <SummaryStat
          label="Matching Demand"
          value={results.totalRawMatch}
          prefix="$"
          decimals={0}
        />
        <SummaryStat label="Total Voters" value={round.votes.length} decimals={0} />
        <SummaryStat label="Projects Funded" value={results.projects.length} decimals={0} />
      </motion.div>

      {/* Distribution visualization */}
      <motion.div className="results-distribution" variants={containerVariants}>
        <DistributionChart directTotal={directTotal} matchedTotal={matchedTotal} />

        <motion.div className="results-distribution__stats" variants={itemVariants}>
          <div className="distribution-stat">
            <div className="distribution-stat__value distribution-stat__value--direct">
              <AnimatedValue value={directTotal} prefix="$" />
            </div>
            <div className="distribution-stat__label">Total Direct</div>
          </div>
          <div className="distribution-stat__plus">+</div>
          <div className="distribution-stat">
            <div className="distribution-stat__value distribution-stat__value--matched">
              <AnimatedValue value={matchedTotal} prefix="$" />
            </div>
            <div className="distribution-stat__label">Total Matched</div>
          </div>
          <div className="distribution-stat__equals">=</div>
          <div className="distribution-stat">
            <div className="distribution-stat__value distribution-stat__value--total">
              <AnimatedValue value={directTotal + matchedTotal} prefix="$" />
            </div>
            <div className="distribution-stat__label">Grand Total</div>
          </div>
        </motion.div>
      </motion.div>

      {/* Scaling info */}
      <motion.div
        className={`results-scaling-note ${results.scalingFactor < 1 ? 'results-scaling-note--warning' : 'results-scaling-note--success'}`}
        variants={itemVariants}
      >
        {results.scalingFactor < 1 ? (
          <>
            <span className="results-scaling-note__icon">⚠</span>
            Demand (${results.totalRawMatch.toFixed(0)}) exceeded pool ($
            {round.matchingPool}) — matches scaled to{' '}
            {(results.scalingFactor * 100).toFixed(1)}%
          </>
        ) : (
          <>
            <span className="results-scaling-note__icon">✓</span>
            Full matching applied — demand (${results.totalRawMatch.toFixed(0)}) within pool ($
            {round.matchingPool})
          </>
        )}
      </motion.div>

      {/* Project cards */}
      <motion.div className="results-projects" variants={containerVariants}>
        <motion.h2 className="results-section-title" variants={itemVariants}>
          Project Rankings
        </motion.h2>
        {sortedProjects.map((project, index) => (
          <ProjectCard
            key={project.projectId}
            project={project}
            maxTotal={maxTotal}
            rank={index + 1}
            isWinner={index === 0}
          />
        ))}
      </motion.div>

      {/* CLR Explanation */}
      <motion.div className="results-explanation" variants={itemVariants}>
        <h3>How CLR Matching Works</h3>
        <div className="results-explanation__formula">
          Match = (Σ√contributions)² − Σcontributions
        </div>
        <p>
          Projects supported by <strong>many small donors</strong> receive more
          matching than projects supported by few large donors. This incentivizes
          broad community support over whale funding.
        </p>
      </motion.div>
    </motion.div>
  );
}
