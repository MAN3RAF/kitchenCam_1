import type { CameraAcquisition } from './camera-acquisition';

/** Development-only acquisition metadata. Never log native errors, media, or permission objects. */
export function traceCameraAcquisition(state: CameraAcquisition) {
  if (!__DEV__) return;
  const { phase, generation, attempt, failure } = state;
  // eslint-disable-next-line no-console -- Allowlisted metadata for physical-device logcat diagnosis.
  console.info('[KitchenCamCamera]', JSON.stringify({ phase, generation, attempt, failure }));
}
