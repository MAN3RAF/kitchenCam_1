export type PhotoSource = 'camera' | 'gallery';

/** Local, memory-only reference. All reported metadata is untrusted. */
export type LocalPhoto = Readonly<{
  revision: string;
  uri: string;
  source: PhotoSource;
  width: number;
  height: number;
  mimeType: string;
  size: number;
  selectedAt: string;
}>;

export type PhotoInput = Readonly<{
  uri: string;
  width: number;
  height: number;
  mimeType?: string | null;
  type?: string;
}>;

export class PhotoError extends Error {
  constructor(public readonly code: 'UNAVAILABLE' | 'UNSUPPORTED' | 'UNREADABLE') {
    super(
      {
        UNAVAILABLE: 'Photos aren’t available right now. Try again or enter ingredients manually.',
        UNSUPPORTED: 'Choose a JPEG, PNG, or still WebP photo instead.',
        UNREADABLE: 'This photo can’t be opened. Retake it or choose another photo.',
      }[code],
    );
  }
}

export interface PhotoFiles {
  prepare(input: PhotoInput, source: PhotoSource, revision: string): Promise<LocalPhoto>;
  readable(photo: LocalPhoto): Promise<void>;
  remove(photo: LocalPhoto): Promise<void>;
  releaseInput(input: PhotoInput, source: PhotoSource): Promise<void>;
}

export type PhotoState = Readonly<{
  photo: LocalPhoto | null;
  busy: boolean;
  accepted: boolean;
  error: string | null;
}>;

/** Owns async fencing and temporary-file lifetime, independently of React/navigation. */
export class PhotoSession {
  private state: PhotoState = { photo: null, busy: false, accepted: false, error: null };
  private generation = 0;
  private operation: PhotoSource | 'validation' | null = null;
  private acquiring = new Set<PhotoSource>();
  private listeners = new Set<() => void>();
  constructor(
    private files: PhotoFiles,
    private uuid: () => string,
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<PhotoState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private async safely(work: Promise<void>) {
    try {
      await work;
    } catch {
      /* Cleanup is retried by the next cache sweep. */
    }
  }
  cancelPending(source?: PhotoSource) {
    if (source && this.operation !== source) return;
    this.generation++;
    this.operation = null;
    this.update({ busy: false });
  }
  discard() {
    this.cancelPending();
    const old = this.state.photo;
    this.update({ photo: null, accepted: false, error: null });
    if (old) void this.safely(this.files.remove(old));
  }
  failPreview(revision: string) {
    if (this.state.photo?.revision !== revision) return;
    this.discard();
    this.update({ busy: false, error: new PhotoError('UNREADABLE').message });
  }
  async acquire(
    source: PhotoSource,
    operation: () => Promise<PhotoInput | null>,
  ): Promise<boolean> {
    if (this.state.busy || this.acquiring.has(source)) return false;
    this.acquiring.add(source);
    const generation = ++this.generation;
    this.operation = source;
    this.update({ busy: true, error: null });
    let input: PhotoInput | null = null;
    let prepared: LocalPhoto | null = null;
    try {
      input = await operation();
      if (!input || generation !== this.generation) return false;
      prepared = await this.files.prepare(input, source, this.uuid());
      if (generation !== this.generation) return false;
      const old = this.state.photo;
      this.update({ photo: prepared, accepted: false });
      prepared = null; // Ownership transferred to the live descriptor.
      if (old) await this.safely(this.files.remove(old));
      return generation === this.generation;
    } catch (error) {
      if (generation === this.generation)
        this.update({
          error:
            error instanceof PhotoError ? error.message : new PhotoError('UNAVAILABLE').message,
        });
      return false;
    } finally {
      if (prepared) await this.safely(this.files.remove(prepared));
      if (input) await this.safely(this.files.releaseInput(input, source));
      this.acquiring.delete(source);
      if (generation === this.generation) {
        this.operation = null;
        this.update({ busy: false });
      }
    }
  }
  async validate(revision: string, accept = false): Promise<boolean> {
    const photo = this.state.photo;
    if (!photo || photo.revision !== revision || this.state.busy) return false;
    const generation = ++this.generation;
    this.operation = 'validation';
    this.update({ busy: true, error: null });
    try {
      await this.files.readable(photo);
      if (generation !== this.generation || this.state.photo !== photo) return false;
      this.update({ accepted: accept || this.state.accepted });
      return true;
    } catch {
      if (generation === this.generation) this.failPreview(revision);
      return false;
    } finally {
      if (generation === this.generation) {
        this.operation = null;
        this.update({ busy: false });
      }
    }
  }
}
