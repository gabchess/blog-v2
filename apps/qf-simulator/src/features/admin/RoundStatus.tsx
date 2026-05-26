import { motion, AnimatePresence } from 'motion/react';
import type { Round, RoundStatus as RoundStatusType } from '../../api/client';

interface Props {
  round: Round;
  setStatus: (status: RoundStatusType) => Promise<void>;
  closeRound: () => Promise<void>;
  deleteRound: () => Promise<void>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

const statusConfig = {
  setup: { color: 'var(--color-accent-magenta)', label: 'SETUP' },
  voting: { color: 'var(--color-accent-cyan)', label: 'VOTING LIVE' },
  closed: { color: 'var(--color-text-primary)', label: 'CLOSED' },
} as const;

const defaultConfig = statusConfig.setup;

export function RoundStatus({ round, setStatus, closeRound, deleteRound, loading, error, clearError }: Props) {
  const handleOpenVoting = () => setStatus('voting');
  const handleCloseRound = () => closeRound();
  const handleDeleteRound = () => deleteRound();

  const config = (round.status in statusConfig
    ? statusConfig[round.status as keyof typeof statusConfig]
    : defaultConfig);

  return (
    <div className="round-status">
      <div className="status-header">
        <h3>{round.name}</h3>
        <motion.div
          key={round.status}
          className="status-badge"
          style={{ '--status-color': config.color } as React.CSSProperties}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <span className="status-dot" />
          <span className="status-label">{config.label}</span>
        </motion.div>
      </div>

      <div className="status-stats">
        <div className="stat">
          <span className="stat-value">{round.matchingPool}</span>
          <span className="stat-label">Matching Pool</span>
        </div>
        <div className="stat">
          <span className="stat-value">{round.voterBudget}</span>
          <span className="stat-label">Voter Budget</span>
        </div>
        <div className="stat">
          <span className="stat-value">{round.projects.length}</span>
          <span className="stat-label">Projects</span>
        </div>
        <div className="stat">
          <span className="stat-value">{round.votes.length}</span>
          <span className="stat-label">Votes</span>
        </div>
      </div>

      {error && <div className="error" onClick={clearError}>{error}</div>}

      <AnimatePresence mode="wait">
        {round.status === 'setup' && round.projects.length >= 2 && round.voterCodes.length > 0 && (
          <motion.div
            key="open-voting"
            className="status-actions"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <button onClick={handleOpenVoting} disabled={loading}>
              Open Voting
            </button>
          </motion.div>
        )}
        {round.status === 'voting' && round.votes.length > 0 && (
          <motion.div
            key="close-round"
            className="status-actions"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <button onClick={handleCloseRound} disabled={loading}>
              Close Round & Calculate
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {round.status === 'setup' && (
        <p className="hint">
          {round.projects.length < 2 && 'Add at least 2 projects. '}
          {round.voterCodes.length === 0 && 'Generate voter codes. '}
        </p>
      )}

      <div className="round-actions">
        <button
          onClick={handleDeleteRound}
          disabled={loading}
          className="delete-round"
        >
          {round.status === 'closed' ? 'Start New Round' : 'Delete Round'}
        </button>
      </div>
    </div>
  );
}
