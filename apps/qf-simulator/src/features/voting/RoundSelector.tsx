import { motion } from 'motion/react';
import type { RoundSummary } from '../../api/client';

interface Props {
  rounds: RoundSummary[];
  onSelect: (roundId: string) => void;
  loading?: boolean;
}

export function RoundSelector({ rounds, onSelect, loading }: Props) {
  if (loading) {
    return (
      <div className="round-selector">
        <h2>Loading Rounds...</h2>
      </div>
    );
  }

  return (
    <div className="round-selector">
      <h2>Select a Round</h2>
      <p className="round-selector__subtitle">
        Multiple voting rounds are active. Choose which round to participate in.
      </p>
      <div className="round-selector__list">
        {rounds.map((round, index) => (
          <motion.button
            key={round.id}
            className="round-selector__item"
            onClick={() => onSelect(round.id)}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="round-selector__item-header">
              <span className="round-selector__item-name">{round.name}</span>
            </div>
            <div className="round-selector__item-details">
              <div className="round-selector__stat">
                <span className="round-selector__stat-label">Matching Pool</span>
                <span className="round-selector__stat-value">${round.matchingPool.toLocaleString()}</span>
              </div>
              <div className="round-selector__stat">
                <span className="round-selector__stat-label">Your Budget</span>
                <span className="round-selector__stat-value">${round.voterBudget}</span>
              </div>
              <div className="round-selector__stat">
                <span className="round-selector__stat-label">Projects</span>
                <span className="round-selector__stat-value">{round.projectCount}</span>
              </div>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
