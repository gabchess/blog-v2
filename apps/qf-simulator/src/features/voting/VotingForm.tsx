import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useVoting, useAnimatedValue } from '../../hooks';
import type { Round } from '../../api/client';
import { AllocationInput } from './AllocationInput';
import { MatchingPreview } from './MatchingPreview';

// Animated value display for budget numbers
function AnimatedValue({ value, className }: { value: number; className?: string }) {
  const animated = useAnimatedValue(value, { duration: 400, decimals: 0 });
  return <span className={className}>${animated}</span>;
}

// Success confirmation overlay
function VoteConfirmation({
  allocations,
  projects,
  onDismiss
}: {
  allocations: Record<string, number>;
  projects: Array<{ id: string; name: string }>;
  onDismiss: () => void;
}) {
  const totalVoted = Object.values(allocations).reduce((a, b) => a + b, 0);
  const votedProjects = projects.filter(p => (allocations[p.id] ?? 0) > 0);

  return (
    <motion.div
      className="vote-confirmation-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="vote-confirmation"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
      >
        <motion.div
          className="confirmation-icon"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', damping: 10, stiffness: 200 }}
        >
          ✓
        </motion.div>
        <h2>Vote Recorded</h2>
        <p className="confirmation-total">${totalVoted} allocated</p>
        <div className="confirmation-breakdown">
          {votedProjects.map((project, index) => (
            <motion.div
              key={project.id}
              className="confirmation-item"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + index * 0.1 }}
            >
              <span className="project-name">{project.name}</span>
              <span className="project-amount">${allocations[project.id]}</span>
            </motion.div>
          ))}
        </div>
        <p className="confirmation-note">Your voter code has been consumed</p>
        <button onClick={onDismiss} className="confirmation-dismiss">
          Continue
        </button>
      </motion.div>
    </motion.div>
  );
}

interface Props {
  round: Round;
  onVoteSubmitted: () => void;
}

export function VotingForm({ round, onVoteSubmitted }: Props) {
  const { preview, loading, error, clearError, submitVote, getPreview } = useVoting();
  const [voterCode, setVoterCode] = useState('');
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [submittedAllocations, setSubmittedAllocations] = useState<Record<string, number>>({});

  // Initialize allocations for new projects only (don't reset existing values)
  useEffect(() => {
    setAllocations((prev) => {
      const updated = { ...prev };
      let changed = false;
      round.projects.forEach((p) => {
        if (!(p.id in updated)) {
          updated[p.id] = 0;
          changed = true;
        }
      });
      return changed ? updated : prev;
    });
  }, [round.projects]);

  // Debounced preview update
  useEffect(() => {
    const totalAllocated = Object.values(allocations).reduce((a, b) => a + b, 0);
    if (totalAllocated > 0) {
      const timer = setTimeout(() => getPreview(allocations), 300);
      return () => clearTimeout(timer);
    }
  }, [allocations, getPreview]);

  const totalAllocated = Object.values(allocations).reduce((a, b) => a + b, 0);

  const handleAllocationChange = useCallback((projectId: string, amount: number) => {
    setAllocations((prev) => ({ ...prev, [projectId]: Math.max(0, amount) }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voterCode.trim()) {
      return;
    }
    try {
      await submitVote(voterCode, allocations);
      setSubmittedAllocations({ ...allocations });
      setShowConfirmation(true);
    } catch {
      // Error is set in hook
    }
  };

  const handleConfirmationDismiss = () => {
    setShowConfirmation(false);
    // Clear form for next voter
    setVoterCode('');
    const cleared: Record<string, number> = {};
    round.projects.forEach((p) => { cleared[p.id] = 0; });
    setAllocations(cleared);
    onVoteSubmitted();
  };

  const remaining = round.voterBudget - totalAllocated;

  return (
    <div className="voting-form">
      <AnimatePresence>
        {showConfirmation && (
          <VoteConfirmation
            allocations={submittedAllocations}
            projects={round.projects}
            onDismiss={handleConfirmationDismiss}
          />
        )}
      </AnimatePresence>

      <h2>Cast Your Vote</h2>
      <div className="budget-display">
        <div className="budget-item">
          <span className="budget-label">Budget</span>
          <AnimatedValue value={round.voterBudget} className="budget-value" />
        </div>
        <div className="budget-item">
          <span className="budget-label">Allocated</span>
          <AnimatedValue value={totalAllocated} className="budget-value accent" />
        </div>
        <div className="budget-item">
          <span className="budget-label">Remaining</span>
          <AnimatedValue
            value={remaining}
            className={`budget-value ${remaining === 0 ? 'depleted' : ''}`}
          />
        </div>
      </div>

      {error && <div className="error" onClick={clearError}>{error}</div>}

      <form onSubmit={handleSubmit}>
        <label>
          Voter Code
          <input
            type="text"
            value={voterCode}
            onChange={(e) => setVoterCode(e.target.value)}
            placeholder="Enter your voter code"
            required
          />
        </label>

        <div className="allocations">
          {round.projects.map((project) => (
            <AllocationInput
              key={project.id}
              project={project}
              value={allocations[project.id] ?? 0}
              onChange={(amount) => handleAllocationChange(project.id, amount)}
              maxBudget={round.voterBudget}
              totalAllocated={totalAllocated}
            />
          ))}
        </div>

        <MatchingPreview preview={preview} loading={false} />

        <button type="submit" disabled={loading || totalAllocated === 0}>
          {loading ? 'Submitting...' : 'Submit Vote'}
        </button>
      </form>
    </div>
  );
}
