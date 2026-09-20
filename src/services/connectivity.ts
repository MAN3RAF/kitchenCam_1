import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network';
import type { Connectivity } from '@/types/connectivity';

export function classifyConnectivity(
  state: Pick<NetworkState, 'isConnected' | 'isInternetReachable'>,
): Connectivity {
  if (state.isConnected === false || state.isInternetReachable === false) return 'offline';
  if (state.isConnected === true && state.isInternetReachable === true) return 'online';
  return 'unknown';
}

export async function readConnectivity(): Promise<Connectivity> {
  return classifyConnectivity(await getNetworkStateAsync());
}

export function subscribeToConnectivity(listener: (state: Connectivity) => void) {
  const subscription = addNetworkStateListener((state) => listener(classifyConnectivity(state)));
  return () => subscription.remove();
}
