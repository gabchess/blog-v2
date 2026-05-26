import { useState } from 'react';
import type { Round } from '../../api/client';

interface Props {
  round: Round;
  generateCodes: (count: number) => Promise<void>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

export function GenerateCodes({ round, generateCodes, loading, error, clearError }: Props) {
  const [count, setCount] = useState(5);

  const handleGenerate = async () => {
    await generateCodes(count);
  };

  return (
    <div className="generate-codes">
      <h3>Voter Codes ({round.voterCodes.length})</h3>

      {round.voterCodes.length > 0 && (
        <ul className="code-list">
          {round.voterCodes.map((vc) => (
            <li key={vc.code} className={vc.used ? 'used' : ''}>
              {vc.code} {vc.used && '(used)'}
            </li>
          ))}
        </ul>
      )}

      {round.status === 'setup' && (
        <div className="generate-form">
          {error && <div className="error" onClick={clearError}>{error}</div>}
          <input
            type="number"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            min={1}
            max={100}
          />
          <button onClick={handleGenerate} disabled={loading}>
            Generate {count} Codes
          </button>
        </div>
      )}
    </div>
  );
}
