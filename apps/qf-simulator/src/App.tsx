import { useEffect, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useRound, useActiveRounds, useTokenTimer } from './hooks';
import { AdminPanel, LoginForm } from './features/admin';
import { VotingForm, RoundSelector } from './features/voting';
import { Results } from './features/results';
import { getAccessToken, clearAccessToken, logout as apiLogout, refresh, getRound, getRoundById } from './api/client';
import type { Round } from './api/client';

type View = 'admin' | 'voter';

const VALID_VIEWS: View[] = ['admin', 'voter'];

function parseHash(): View {
  const hash = window.location.hash.replace('#', '');
  return VALID_VIEWS.includes(hash as View) ? (hash as View) : 'admin';
}

// Polling interval for voter view (check for status changes)
const VOTER_POLL_INTERVAL = 3000; // 3 seconds

function App() {
  const { round, fetchRound } = useRound();
  const { rounds: activeRounds, fetchActiveRounds, loading: loadingActiveRounds } = useActiveRounds();
  const [view, setView] = useState<View>(parseHash);
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!getAccessToken());
  const [selectedRound, setSelectedRound] = useState<Round | null>(null);
  const [restoringSession, setRestoringSession] = useState(true);

  // Restore session from refresh token cookie on mount
  useEffect(() => {
    if (getAccessToken()) {
      setRestoringSession(false);
      return;
    }
    refresh()
      .then(() => {
        setIsLoggedIn(true);
        fetchRound();
      })
      .catch(() => {
        // No valid refresh token — stay logged out
      })
      .finally(() => setRestoringSession(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync hash → state on browser back/forward
  useEffect(() => {
    const onHashChange = () => setView(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Initial fetch for admin
  useEffect(() => {
    fetchRound();
  }, [fetchRound]);

  // Fetch active rounds when switching to voter view
  const handleViewChange = useCallback(async (newView: View) => {
    window.location.hash = newView;
    setView(newView);
    if (newView === 'voter') {
      setSelectedRound(null); // Reset selection
      const rounds = await fetchActiveRounds();
      // Auto-select if only 1 round
      const firstRound = rounds[0];
      if (rounds.length === 1 && firstRound) {
        const fullRound = await getRoundById(firstRound.id);
        setSelectedRound(fullRound);
      }
    }
  }, [fetchActiveRounds]);

  const handleLogin = useCallback(() => {
    setIsLoggedIn(true);
    fetchRound();
  }, [fetchRound]);

  const handleLogout = useCallback(async () => {
    try {
      await apiLogout();
    } catch (error) {
      console.error('Logout failed:', error);
      clearAccessToken();
    }
    setIsLoggedIn(false);
  }, []);

  const handleSessionExpired = useCallback(() => {
    clearAccessToken();
    setIsLoggedIn(false);
  }, []);

  // Auto-refresh token before expiry
  useTokenTimer(handleSessionExpired);

  // Poll for updates when in voter view
  useEffect(() => {
    if (view !== 'voter') return;

    // Poll to check for status changes or new rounds (silent = no loading flash)
    const intervalId = setInterval(async () => {
      const rounds = await fetchActiveRounds({ silent: true });
      // If we have a selected round, always refresh it by ID (handles voting→closed transition)
      if (selectedRound) {
        const fullRound = await getRoundById(selectedRound.id);
        if (fullRound) {
          setSelectedRound(fullRound);
        }
      }
      // Auto-select if only 1 round and nothing selected
      const singleRound = rounds[0];
      if (rounds.length === 1 && singleRound && !selectedRound) {
        const fullRound = await getRoundById(singleRound.id);
        setSelectedRound(fullRound);
      }
    }, VOTER_POLL_INTERVAL);

    return () => clearInterval(intervalId);
  }, [view, selectedRound, fetchActiveRounds]);

  const handleRoundSelect = useCallback(async (roundId: string) => {
    // Fetch the full round data for the selected round
    const fullRound = await getRoundById(roundId);
    if (fullRound) {
      setSelectedRound(fullRound);
    }
  }, []);

  const handleVoteSubmitted = useCallback(async () => {
    // Refresh active rounds
    const rounds = await fetchActiveRounds();
    // If multiple rounds, go back to selector
    if (rounds.length > 1) {
      setSelectedRound(null);
    } else if (rounds.length === 1 && rounds[0]) {
      // Refresh the selected round
      const fullRound = await getRoundById(rounds[0].id);
      setSelectedRound(fullRound);
    } else {
      setSelectedRound(null);
    }
  }, [fetchActiveRounds]);

  // Compute voter view state
  const voterViewState = (() => {
    if (loadingActiveRounds && !selectedRound) return 'loading';
    if (activeRounds.length === 0 && !selectedRound) return 'no-rounds';
    if (activeRounds.length > 1 && !selectedRound) return 'select-round';
    if (selectedRound?.status === 'voting') return 'voting';
    if (selectedRound?.status === 'closed') return 'results';
    return 'loading'; // Fallback while fetching full round
  })();

  return (
    <div className="app">
      <header>
        <h1>QF Simulator</h1>
        <p>Capital Constrained Liberal Radicalism Demo</p>
        <nav>
          <button onClick={() => handleViewChange('admin')} className={view === 'admin' ? 'active' : ''}>
            Admin
          </button>
          <button onClick={() => handleViewChange('voter')} className={view === 'voter' ? 'active' : ''}>
            Voter
          </button>
        </nav>
      </header>

      <main>
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            {view === 'admin' && restoringSession && (
              <div className="waiting"><h2>Restoring session...</h2></div>
            )}
            {view === 'admin' && !restoringSession && !isLoggedIn && (
              <LoginForm onSuccess={handleLogin} />
            )}
            {view === 'admin' && isLoggedIn && (
              <>
                <div className="admin-header">
                  <div className="admin-header__user">
                    <span className="admin-header__status">
                      <span className="admin-header__status-dot" />
                      Session Active
                    </span>
                  </div>
                  <button onClick={handleLogout} className="admin-header__logout">Logout</button>
                </div>
                <AdminPanel />
              </>
            )}

            {view === 'voter' && voterViewState === 'loading' && (
              <div className="waiting">
                <h2>Loading...</h2>
              </div>
            )}

            {view === 'voter' && voterViewState === 'no-rounds' && (
              <div className="waiting">
                <h2>No Active Voting Rounds</h2>
                <p>No voting rounds are currently open. Please wait for an admin to start a round.</p>
              </div>
            )}

            {view === 'voter' && voterViewState === 'select-round' && (
              <RoundSelector
                rounds={activeRounds}
                onSelect={handleRoundSelect}
              />
            )}

            {view === 'voter' && voterViewState === 'voting' && selectedRound && (
              <VotingForm round={selectedRound} onVoteSubmitted={handleVoteSubmitted} />
            )}

            {view === 'voter' && voterViewState === 'results' && selectedRound && (
              <Results round={selectedRound} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export { App };
