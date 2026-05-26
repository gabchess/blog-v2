import { useState } from 'react';

interface Props {
  createRound: (name: string, matchingPool: number, voterBudget: number) => Promise<void>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

export function CreateRound({ createRound, loading, error, clearError }: Props) {
  const [name, setName] = useState('');
  const [matchingPool, setMatchingPool] = useState(1000);
  const [voterBudget, setVoterBudget] = useState(100);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createRound(name, matchingPool, voterBudget);
  };

  return (
    <form onSubmit={handleSubmit} className="create-round">
      <h2>Create New Round</h2>
      {error && <div className="error" onClick={clearError}>{error}</div>}

      <label>
        Round Name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>

      <label>
        Matching Pool
        <input
          type="number"
          value={matchingPool}
          onChange={(e) => setMatchingPool(Number(e.target.value))}
          min={1}
          required
        />
      </label>

      <label>
        Voter Budget
        <input
          type="number"
          value={voterBudget}
          onChange={(e) => setVoterBudget(Number(e.target.value))}
          min={1}
          required
        />
      </label>

      <button type="submit" disabled={loading}>
        {loading ? 'Creating...' : 'Create Round'}
      </button>
    </form>
  );
}
