import { useEffect } from 'react';
import { useRound } from '../../hooks';
import { CreateRound } from './CreateRound';
import { AddProjects } from './AddProjects';
import { GenerateCodes } from './GenerateCodes';
import { RoundStatus } from './RoundStatus';

export function AdminPanel() {
  const {
    round,
    fetchRound,
    loading,
    error,
    clearError,
    createRound,
    addProject,
    generateCodes,
    setStatus,
    closeRound,
    deleteRound,
  } = useRound();

  useEffect(() => {
    fetchRound();
  }, [fetchRound]);

  if (loading && !round) {
    return <div>Loading...</div>;
  }

  if (!round) {
    return (
      <CreateRound
        createRound={createRound}
        loading={loading}
        error={error}
        clearError={clearError}
      />
    );
  }

  return (
    <div className="admin-panel">
      <RoundStatus
        round={round}
        setStatus={setStatus}
        closeRound={closeRound}
        deleteRound={deleteRound}
        loading={loading}
        error={error}
        clearError={clearError}
      />
      <AddProjects
        round={round}
        addProject={addProject}
        loading={loading}
        error={error}
        clearError={clearError}
      />
      <GenerateCodes
        round={round}
        generateCodes={generateCodes}
        loading={loading}
        error={error}
        clearError={clearError}
      />
    </div>
  );
}
