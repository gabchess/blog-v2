import { useTokenTimer } from '../../hooks/useTokenTimer';

interface StatusBarProps {
  userEmail: string;
  onLogout: () => void;
  onSessionExpired: () => void;
}

/** Status bar showing auth state, token timer, and logout button. */
export function StatusBar({ userEmail, onLogout, onSessionExpired }: StatusBarProps) {
  const { secondsRemaining, isRefreshing } = useTokenTimer(onSessionExpired);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '10px 20px',
      backgroundColor: '#f0f0f0',
      borderBottom: '1px solid #ddd'
    }}>
      <span>Logged in as: <strong>{userEmail}</strong></span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {secondsRemaining !== null && (
          <span style={{ color: secondsRemaining < 60 ? 'orange' : 'green' }}>
            Token expires in: {formatTime(secondsRemaining)}
            {isRefreshing && ' (refreshing...)'}
          </span>
        )}
        <button onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
}
