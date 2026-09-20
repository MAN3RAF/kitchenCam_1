import { act, render, screen } from '@testing-library/react-native';
import { ConnectivityProvider, useConnectivity } from '@/hooks/use-connectivity';
import {
  classifyConnectivity,
  readConnectivity,
  subscribeToConnectivity,
} from '@/services/connectivity';
import { Text } from '@/components/text';
import type { Connectivity } from '@/types/connectivity';

jest.mock('@/services/connectivity', () => ({
  ...jest.requireActual('@/services/connectivity'),
  readConnectivity: jest.fn(),
  subscribeToConnectivity: jest.fn(),
}));

function Probe() {
  return <Text>{useConnectivity()}</Text>;
}

test('unknown connectivity is never reported as offline or as proven online', () => {
  expect(classifyConnectivity({})).toBe('unknown');
  expect(classifyConnectivity({ isConnected: true })).toBe('unknown');
  expect(classifyConnectivity({ isConnected: false })).toBe('offline');
  expect(classifyConnectivity({ isConnected: true, isInternetReachable: true })).toBe('online');
});

test('a stale initial read cannot overwrite a newer connectivity event; listeners are cleaned up', async () => {
  let resolveRead: (value: Connectivity) => void = () => undefined;
  let notify: (value: Connectivity) => void = () => undefined;
  const unsubscribe = jest.fn();
  jest.mocked(readConnectivity).mockReturnValue(
    new Promise((resolve) => {
      resolveRead = resolve;
    }),
  );
  jest.mocked(subscribeToConnectivity).mockImplementation((listener) => {
    notify = listener;
    return unsubscribe;
  });
  const view = await render(
    <ConnectivityProvider>
      <Probe />
    </ConnectivityProvider>,
  );
  await act(async () => {
    notify('offline');
    resolveRead('online');
  });
  expect(screen.getByText('offline')).toBeOnTheScreen();
  await view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
