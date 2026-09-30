import { traceCameraAcquisition } from '@/features/capture/camera-diagnostics';

test('camera diagnostics only emit allowlisted acquisition metadata, even with extra input fields', () => {
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  const state = {
    phase: 'failed' as const,
    generation: 2,
    attempt: 2 as const,
    failure: 'timeout' as const,
    uri: 'file:///private.jpg',
    message: 'private native error',
    permission: { granted: true },
  };
  traceCameraAcquisition(state);
  expect(log).toHaveBeenCalledWith(
    '[KitchenCamCamera]',
    JSON.stringify({ phase: 'failed', generation: 2, attempt: 2, failure: 'timeout' }),
  );
  expect(log).toHaveBeenCalledTimes(1);
});

test('camera diagnostics emit nothing outside development builds', () => {
  jest.replaceProperty(global as typeof global & { __DEV__: boolean }, '__DEV__', false);
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  traceCameraAcquisition({ phase: 'ready', generation: 1, attempt: 1 });
  expect(log).not.toHaveBeenCalled();
});
