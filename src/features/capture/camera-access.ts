export type CameraPermission = { granted: boolean; canAskAgain: boolean; status: string };
export type CameraAccess =
  'checking' | 'request' | 'denied' | 'settings' | 'granted' | 'unavailable';
export interface CameraPermissions {
  get(): Promise<CameraPermission>;
  request(): Promise<CameraPermission>;
}

/** Request a supported bounded native still size; no resizing or source admission here. */
export function captureSize(sizes: readonly string[]): string | null {
  const candidates = sizes.flatMap((size) => {
    const match = /^(\d+)x(\d+)$/.exec(size);
    if (!match) return [];
    const pixels = Number(match[1]) * Number(match[2]);
    return pixels > 0 && pixels <= 12_000_000 ? [{ size, pixels }] : [];
  });
  candidates.sort((a, b) => b.pixels - a.pixels);
  return candidates[0]?.size ?? null;
}

/** Permission checks never request permission. Only the explanation button calls request. */
export class CameraAccessController {
  private generation = 0;
  private state: CameraAccess = 'checking';
  private listeners = new Set<() => void>();
  constructor(private permissions: CameraPermissions) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(state: CameraAccess) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  suspend() {
    this.generation++;
    this.set('checking');
  }
  unavailable() {
    this.generation++;
    this.set('unavailable');
  }
  async check(request = false) {
    const generation = ++this.generation;
    this.set('checking');
    try {
      const permission = await (request ? this.permissions.request() : this.permissions.get());
      if (generation !== this.generation) return;
      this.set(
        permission.granted
          ? 'granted'
          : !permission.canAskAgain
            ? 'settings'
            : permission.status === 'undetermined'
              ? 'request'
              : 'denied',
      );
    } catch {
      if (generation === this.generation) this.set('unavailable');
    }
  }
}
