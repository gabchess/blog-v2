import { useEffect, useRef } from 'react';
import { useAccount, useConnect, useConnectors } from 'wagmi';

export function useAutoConnect(): void {
  const connectors = useConnectors();
  const { connect } = useConnect();
  const { isConnected } = useAccount();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (isConnected || attemptedRef.current) return;

    const safeConnector = connectors.find((c) => c.id === 'safe');
    if (!safeConnector) return;

    let cancelled = false;
    attemptedRef.current = true;

    // getProvider() returns undefined outside any iframe, throws inside
    // non-Safe iframes (SDK timeout), returns provider inside Safe iframes.
    safeConnector.getProvider().then((provider) => {
      if (provider && !cancelled) {
        connect({ connector: safeConnector });
      }
    }).catch(() => {
      // Expected: Safe SDK throws when not in Safe App iframe context.
    });

    return () => {
      cancelled = true;
      // Reset so React StrictMode's second mount can retry.
      // Without this, the first mount sets attemptedRef = true, StrictMode
      // unmounts (cancelled = true), and the second mount bails out —
      // preventing auto-connect from ever succeeding.
      attemptedRef.current = false;
    };
  }, [connectors, connect, isConnected]);
}
