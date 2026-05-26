import { useState, useEffect } from 'react';
import { useMutation } from 'urql';
import { ProfileView } from './features/profile/ProfileView';
import { LoginForm } from './features/auth/LoginForm';
import { WeatherWidget } from './features/weather';
import { LOGOUT_MUTATION } from './graphql/queries';
import { getAccessToken, clearTokens, getRefreshToken } from './graphql/client';

/**
 * Main App component with auth flow.
 * Shows login form or profile based on auth state.
 */
export function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [, logout] = useMutation(LOGOUT_MUTATION);

  useEffect(() => {
    // Check if user has a token on mount
    setIsLoggedIn(!!getAccessToken());
  }, []);

  const handleLogin = () => {
    setIsLoggedIn(true);
  };

  const handleLogout = async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      await logout({ refreshToken });
    }
    clearTokens();
    setIsLoggedIn(false);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ marginBottom: '20px' }}>
        <h1 style={{ margin: 0 }}>Admin Dashboard</h1>
      </header>
      <main>
        {isLoggedIn ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px' }}>
            <ProfileView onLogout={handleLogout} />
            <aside>
              <WeatherWidget />
            </aside>
          </div>
        ) : (
          <LoginForm onSuccess={handleLogin} />
        )}
      </main>
    </div>
  );
}
