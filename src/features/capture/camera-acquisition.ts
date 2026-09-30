import { captureSize } from './camera-picture-size';

export const CAMERA_STARTUP_TIMEOUT_MS = 10_000;

type CameraPhase =
  | 'idle'
  | 'mounting'
  | 'initializing'
  | 'selecting-size'
  | 'configuring'
  | 'ready'
  | 'releasing'
  | 'failed';
export type CameraAcquisition = Readonly<{
  phase: CameraPhase;
  generation: number;
  attempt: 1 | 2;
  pictureSize?: string;
  failure?: 'timeout' | 'mount-error' | 'size-query' | 'size-unavailable';
}>;

// Unique across route replacements as well as retries, for fencing and device diagnostics.
let nextGeneration = 0;

/** Permission is a prerequisite, never a readiness signal. Owns one acquisition at a time. */
export class CameraAcquisitionController {
  private state: CameraAcquisition = { phase: 'idle', generation: 0, attempt: 1 };
  private listeners = new Set<() => void>();
  private deadline: ReturnType<typeof setTimeout> | undefined;

  constructor(private trace?: (state: CameraAcquisition) => void) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(state: CameraAcquisition) {
    this.state = state;
    this.trace?.(state);
    this.listeners.forEach((listener) => listener());
  }
  private clearDeadline() {
    clearTimeout(this.deadline);
    this.deadline = undefined;
  }
  start() {
    if (this.state.phase !== 'idle') return;
    this.set({ phase: 'mounting', generation: ++nextGeneration, attempt: 1 });
  }
  mounted(generation: number) {
    if (this.state.generation !== generation || this.state.phase !== 'mounting') return;
    this.deadline = setTimeout(() => this.fail(generation, 'timeout'), CAMERA_STARTUP_TIMEOUT_MS);
    this.set({ ...this.state, phase: 'initializing' });
  }
  ready(generation: number) {
    if (
      this.state.generation !== generation ||
      !['mounting', 'initializing', 'configuring'].includes(this.state.phase)
    )
      return;
    this.clearDeadline();
    this.set({ ...this.state, phase: 'ready' });
  }
  /** Android size changes rebind this view; never replace its React key on readiness. */
  async readyWithSize(
    generation: number,
    renderedSize: string | undefined,
    getSizes: () => Promise<string[]>,
  ) {
    if (this.state.generation !== generation) return;
    if (this.state.phase === 'configuring') {
      if (renderedSize === this.state.pictureSize) this.ready(generation);
      return;
    }
    if (!['mounting', 'initializing'].includes(this.state.phase)) return;
    this.mounted(generation);
    this.set({ ...this.state, phase: 'selecting-size' });
    try {
      const size = captureSize(await getSizes());
      if (this.state.generation !== generation || this.state.phase !== 'selecting-size') return;
      if (!size) {
        this.fail(generation, 'size-unavailable');
        return;
      }
      // Keep capture disabled until the same view reports ready with the selected prop.
      this.set({ ...this.state, phase: 'configuring', pictureSize: size });
    } catch {
      if (this.state.generation === generation && this.state.phase === 'selecting-size')
        this.fail(generation, 'size-query');
    }
  }
  isReady(generation: number) {
    return this.state.generation === generation && this.state.phase === 'ready';
  }
  fail(generation: number, failure: NonNullable<CameraAcquisition['failure']>) {
    if (
      this.state.generation !== generation ||
      !['mounting', 'initializing', 'selecting-size', 'configuring', 'ready'].includes(
        this.state.phase,
      )
    )
      return false;
    this.clearDeadline();
    // The view must disappear in a separate React commit before the retry can start.
    this.set({ ...this.state, phase: this.state.attempt === 1 ? 'releasing' : 'failed', failure });
    return true;
  }
  retryAfterUnmount(generation: number) {
    if (this.state.generation !== generation || this.state.phase !== 'releasing') return;
    this.set({ phase: 'mounting', generation: ++nextGeneration, attempt: 2 });
  }
  suspend() {
    this.clearDeadline();
    if (this.state.phase !== 'idle') this.set({ ...this.state, phase: 'idle' });
  }
}
