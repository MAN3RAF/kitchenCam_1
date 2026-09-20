import { createContext, use, useEffect, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { readConnectivity, subscribeToConnectivity } from '@/services/connectivity';
import type { Connectivity } from '@/types/connectivity';

const ConnectivityContext = createContext<Connectivity>('unknown');

export function ConnectivityProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<Connectivity>('unknown');
  useEffect(() => {
    let active = true;
    let revision = 0;
    const refresh = async () => {
      const requestedRevision = ++revision;
      let value: Connectivity = 'unknown';
      try {
        value = await readConnectivity();
      } catch {
        /* Unknown is not evidence of being offline. */
      }
      if (active && requestedRevision === revision) setState(value);
    };
    const unsubscribe = subscribeToConnectivity((value) => {
      revision += 1;
      if (active) setState(value);
    });
    const appStateSubscription = AppState.addEventListener('change', (value) => {
      if (value === 'active') void refresh();
    });
    void refresh();
    return () => {
      active = false;
      unsubscribe();
      appStateSubscription.remove();
    };
  }, []);
  return <ConnectivityContext value={state}>{children}</ConnectivityContext>;
}

export function useConnectivity() {
  return use(ConnectivityContext);
}
