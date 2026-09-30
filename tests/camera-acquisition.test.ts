import {
  CAMERA_STARTUP_TIMEOUT_MS,
  CameraAcquisitionController,
} from '@/features/capture/camera-acquisition';
import { captureSize } from '@/features/capture/camera-picture-size';

let camera: CameraAcquisitionController;
beforeEach(() => {
  jest.useFakeTimers();
  camera = new CameraAcquisitionController();
});
afterEach(() => {
  camera.suspend();
  jest.useRealTimers();
});
function mount() {
  camera.start();
  const generation = camera.snapshot().generation;
  expect(camera.isReady(generation)).toBe(false);
  camera.mounted(generation);
  return generation;
}
test('cold acquisition stays unready until its own delayed native ready event', () => {
  expect(camera.snapshot().phase).toBe('idle');
  camera.start();
  expect(camera.snapshot().phase).toBe('mounting');
  const generation = mount();
  jest.advanceTimersByTime(CAMERA_STARTUP_TIMEOUT_MS - 1);
  expect(camera.isReady(generation)).toBe(false);
  camera.ready(generation);
  jest.advanceTimersByTime(CAMERA_STARTUP_TIMEOUT_MS * 3);
  expect(camera.isReady(generation)).toBe(true);
});
test.each(['timeout', 'mount-error'] as const)(
  '%s releases the first view before allowing a single fresh retry',
  (failure) => {
    const first = mount();
    if (failure === 'timeout') jest.advanceTimersByTime(CAMERA_STARTUP_TIMEOUT_MS);
    else camera.fail(first, failure);
    expect(camera.snapshot()).toMatchObject({ phase: 'releasing', attempt: 1, failure });
    camera.ready(first);
    camera.start();
    expect(camera.isReady(first)).toBe(false);
    expect(camera.snapshot().phase).toBe('releasing');
    camera.retryAfterUnmount(first);
    const second = camera.snapshot().generation;
    expect(second).not.toBe(first);
    camera.mounted(second);
    camera.ready(first);
    camera.fail(first, 'mount-error');
    expect(camera.isReady(second)).toBe(false);
    camera.ready(second);
    jest.advanceTimersByTime(CAMERA_STARTUP_TIMEOUT_MS * 3);
    expect(camera.isReady(second)).toBe(true);
    expect(camera.snapshot().attempt).toBe(2);
  },
);
test('a failed second attempt stays failed with no automatic retry or late resurrection', () => {
  const first = mount();
  jest.advanceTimersByTime(CAMERA_STARTUP_TIMEOUT_MS);
  camera.retryAfterUnmount(first);
  const second = camera.snapshot().generation;
  camera.mounted(second);
  jest.advanceTimersByTime(CAMERA_STARTUP_TIMEOUT_MS);
  expect(camera.snapshot()).toMatchObject({ phase: 'failed', attempt: 2 });
  camera.ready(second);
  camera.retryAfterUnmount(second);
  camera.start();
  jest.advanceTimersByTime(CAMERA_STARTUP_TIMEOUT_MS * 100);
  expect(camera.snapshot()).toMatchObject({ phase: 'failed', generation: second });
  expect(jest.getTimerCount()).toBe(0);
});
test('suspending initialization cancels its deadline and fences late callbacks', () => {
  const first = mount();
  camera.suspend();
  camera.ready(first);
  camera.fail(first, 'mount-error');
  jest.advanceTimersByTime(CAMERA_STARTUP_TIMEOUT_MS * 3);
  expect(camera.snapshot().phase).toBe('idle');
  const second = mount();
  expect(second).not.toBe(first);
  camera.ready(first);
  expect(camera.isReady(second)).toBe(false);
});
test('suspending during the release gap cancels reacquisition', () => {
  const first = mount();
  camera.fail(first, 'mount-error');
  camera.suspend();
  camera.retryAfterUnmount(first);
  expect(camera.snapshot().phase).toBe('idle');
});
test('Retake from a replaced route has a fresh generation and no inherited readiness', () => {
  const first = mount();
  camera.ready(first);
  camera.suspend();
  const retake = new CameraAcquisitionController();
  retake.start();
  const next = retake.snapshot().generation;
  expect(next).not.toBe(first);
  retake.ready(first);
  expect(retake.isReady(next)).toBe(false);
  retake.ready(next);
  expect(retake.isReady(next)).toBe(true);
  retake.suspend();
});

test('native size selection uses the largest enumerated size within the source pixel limit', () => {
  expect(captureSize(['Photo', '8000x6000', '1920x1080', '4000x3000'])).toBe('4000x3000');
  expect(captureSize(['Photo', '8000x6000', '0x0', '10000x1'])).toBeUndefined();
});
test('Android configures the original generation and requires its sized ready event', async () => {
  const generation = mount();
  const query = jest.fn(async () => ['8000x6000', '4000x3000']);
  await camera.readyWithSize(generation, undefined, query);
  expect(camera.snapshot()).toMatchObject({
    phase: 'configuring',
    generation,
    pictureSize: '4000x3000',
  });
  expect(camera.isReady(generation)).toBe(false);
  await camera.readyWithSize(generation, undefined, query);
  expect(camera.isReady(generation)).toBe(false);
  await camera.readyWithSize(generation, '4000x3000', query);
  expect(camera.isReady(generation)).toBe(true);
  expect(query).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
test('late size results cannot configure a suspended or replacement camera', async () => {
  const first = mount();
  let resolve!: (sizes: string[]) => void;
  const query = camera.readyWithSize(
    first,
    undefined,
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  camera.suspend();
  const second = mount();
  resolve(['4000x3000']);
  await query;
  expect(camera.snapshot()).toEqual({ phase: 'initializing', generation: second, attempt: 1 });
});
test('size selection and rebinding share the bounded startup deadline', async () => {
  const generation = mount();
  await camera.readyWithSize(generation, undefined, async () => ['4000x3000']);
  jest.advanceTimersByTime(CAMERA_STARTUP_TIMEOUT_MS);
  expect(camera.snapshot()).toMatchObject({ phase: 'releasing', failure: 'timeout' });
  await camera.readyWithSize(generation, '4000x3000', async () => ['4000x3000']);
  expect(camera.isReady(generation)).toBe(false);
});
test.each(['empty', 'rejected'] as const)(
  'a %s size query fails safely and clears size on retry',
  async (kind) => {
    const generation = mount();
    await camera.readyWithSize(generation, undefined, async () => {
      if (kind === 'rejected') throw new Error('private native message');
      return [];
    });
    expect(camera.snapshot()).toMatchObject({
      phase: 'releasing',
      failure: kind === 'empty' ? 'size-unavailable' : 'size-query',
    });
    camera.retryAfterUnmount(generation);
    expect(camera.snapshot().pictureSize).toBeUndefined();
    expect(camera.snapshot().attempt).toBe(2);
  },
);
