import { useEffect } from 'react';
import { useMe } from '../../hooks/useMe';

interface DashboardProps {
  onLogout: () => void;
}

/** Dashboard showing raw /me API response as formatted JSON. */
export function Dashboard({ onLogout }: DashboardProps) {
  const { user, loading, error, fetchUser } = useMe();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  if (loading) {
    return <div style={{ padding: '20px' }}>Loading...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: '20px', color: 'red' }}>
        Error: {error}
        <button onClick={fetchUser} style={{ marginLeft: '10px' }}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>Dashboard</h2>
      <h3>/me Response:</h3>
      <pre style={{
        backgroundColor: '#1e1e1e',
        color: '#d4d4d4',
        padding: '16px',
        borderRadius: '8px',
        overflow: 'auto',
        fontFamily: 'monospace',
        fontSize: '14px'
      }}>
        {JSON.stringify(user, null, 2)}
      </pre>
    </div>
  );
}
