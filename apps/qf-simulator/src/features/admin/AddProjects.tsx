import { useState } from 'react';
import type { Round } from '../../api/client';

interface Props {
  round: Round;
  addProject: (name: string, description: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

export function AddProjects({ round, addProject, loading, error, clearError }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await addProject(name, description);
    setName('');
    setDescription('');
  };

  return (
    <div className="add-projects">
      <h3>Projects ({round.projects.length})</h3>

      <ul className="project-list">
        {round.projects.map((p) => (
          <li key={p.id} className="project-list__item">
            <span className="project-list__name">{p.name}</span>
            {p.description && (
              <span className="project-list__desc">{p.description}</span>
            )}
          </li>
        ))}
      </ul>

      {round.status === 'setup' && (
        <form onSubmit={handleSubmit}>
          {error && <div className="error" onClick={clearError}>{error}</div>}
          <input
            type="text"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button type="submit" disabled={loading}>Add Project</button>
        </form>
      )}
    </div>
  );
}
