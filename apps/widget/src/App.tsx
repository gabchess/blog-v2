import { useState, useEffect, useCallback } from 'react';
import { LoginForm } from './features/auth';
import { Dashboard } from './features/dashboard';
import { StatusBar } from './features/status-bar';
import { getAccessToken, clearAccessToken, logout as apiLogout, type User } from './api/client';
import { useMe } from './hooks';

/**
 * Main App component with auth flow.
 * Shows login form or dashboard based on auth state.
 */
export function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const { user, fetchUser } = useMe();

  useEffect(() => {
    // Check if user has a token on mount
    const hasToken = !!getAccessToken();
    setIsLoggedIn(hasToken);
    if (hasToken) {
      fetchUser();
    }
  }, [fetchUser]);

  const handleLogin = useCallback(async () => {
    setIsLoggedIn(true);
    await fetchUser();
  }, [fetchUser]);

  const handleLogout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // Clear token even if logout API fails
      clearAccessToken();
    }
    setIsLoggedIn(false);
  }, []);

  const handleSessionExpired = useCallback(() => {
    clearAccessToken();
    setIsLoggedIn(false);
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ padding: '20px', marginBottom: '0' }}>
        <h1 style={{ margin: 0 }}>Widget - REST API Demo</h1>
      </header>
      {isLoggedIn && user && (
        <StatusBar
          userEmail={user.email}
          onLogout={handleLogout}
          onSessionExpired={handleSessionExpired}
        />
      )}
      <main>
        {isLoggedIn ? (
          <Dashboard onLogout={handleLogout} />
        ) : (
          <div style={{ padding: '20px' }}>
            <LoginForm onSuccess={handleLogin} />
          </div>
        )}
      </main>
    </div>
  );
}
