import { PreparationError, type PhotoPreparation, type PreparedPhoto } from './preparation-policy';

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
  prepared: PreparedPhoto | null;
  preparing: boolean;
  error: string | null;
}>;

/** Owns async fencing and temporary-file lifetime, independently of React/navigation. */
export class PhotoSession {
  private state: PhotoState = {
    photo: null,
    busy: false,
    prepared: null,
    preparing: false,
    error: null,
  };
  private generation = 0;
  private operation: PhotoSource | 'validation' | 'preparation' | null = null;
  private preparingSource: LocalPhoto | null = null;
  private acquiring = new Set<PhotoSource>();
  private listeners = new Set<() => void>();
  constructor(
    private files: PhotoFiles,
    private uuid: () => string,
    private preparation?: PhotoPreparation,
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
    this.update({ busy: false, preparing: false });
  }
  cancelPreparation() {
    if (this.operation === 'preparation') this.cancelPending();
  }
  private retireSource(photo: LocalPhoto) {
    // An uncancellable native decoder may still be reading this app-owned source.
    if (this.preparingSource !== photo) void this.safely(this.files.remove(photo));
  }
  private clearPrepared() {
    const prepared = this.state.prepared;
    this.update({ prepared: null });
    if (prepared && this.preparation) void this.safely(this.preparation.remove(prepared));
  }
  discard() {
    this.cancelPending();
    const old = this.state.photo;
    this.clearPrepared();
    this.update({ photo: null, error: null });
    if (old) this.retireSource(old);
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
    this.cancelPreparation();
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
      this.clearPrepared();
      this.update({ photo: prepared });
      prepared = null; // Ownership transferred to the live descriptor.
      if (old) this.retireSource(old);
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
  async validate(revision: string): Promise<boolean> {
    const photo = this.state.photo;
    if (!photo || photo.revision !== revision || this.state.busy) return false;
    const generation = ++this.generation;
    this.operation = 'validation';
    this.update({ busy: true, error: null });
    try {
      await this.files.readable(photo);
      await this.preparation?.admit(photo);
      if (generation !== this.generation || this.state.photo !== photo) return false;
      return true;
    } catch (error) {
      if (generation === this.generation) {
        this.failPreview(revision);
        if (error instanceof PreparationError) this.update({ error: error.message });
      }
      return false;
    } finally {
      if (generation === this.generation) {
        this.operation = null;
        this.update({ busy: false });
      }
    }
  }
  async preparePhoto(revision: string): Promise<boolean> {
    const source = this.state.photo;
    if (!source || source.revision !== revision || this.state.busy) return false;
    if (this.preparingSource) {
      this.update({ error: new PreparationError('BUSY').message });
      return false;
    }
    if (this.state.prepared?.sourceRevision === revision) return true;
    const generation = ++this.generation;
    const current = () => generation === this.generation && this.state.photo === source;
    this.operation = 'preparation';
    this.preparingSource = source;
    this.update({ busy: true, preparing: true, error: null });
    let result: PreparedPhoto | null = null;
    try {
      const preparationRevision = this.uuid();
      if (!this.preparation) throw new PreparationError('UNAVAILABLE');
      result = await this.preparation.prepare(source, preparationRevision, current);
      if (!current()) return false;
      if (
        result.sourceRevision !== source.revision ||
        result.revision !== preparationRevision ||
        !result.appOwned
      )
        throw new PreparationError('INVALID');
      this.update({ prepared: result });
      result = null;
      return true;
    } catch (error) {
      if (current())
        this.update({
          error:
            error instanceof PreparationError
              ? error.message
              : new PreparationError('INVALID').message,
        });
      return false;
    } finally {
      if (result && this.preparation) await this.safely(this.preparation.remove(result));
      this.preparingSource = null;
      if (this.state.photo !== source) await this.safely(this.files.remove(source));
      if (current()) {
        this.operation = null;
        this.update({ busy: false, preparing: false });
      }
    }
  }
}
