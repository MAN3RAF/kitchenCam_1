import {
  ingredientsSchema,
  isUncertainScanError,
  manualIngredient,
  nameIssue,
  sameIngredients,
  selectionIssue,
  ScanError,
  scanError,
  type Ingredient,
  type ManualScan,
} from './scan-domain';
import type { ScanCommand, ScanService } from './scan-service';

export type EditorState = {
  base: ManualScan;
  rows: Ingredient[];
  input: string;
  editingId: string | null;
  status: 'saved' | 'editing' | 'saving' | 'uncertain' | 'conflict';
  error: string | null;
  fieldError: string | null;
  latest: ManualScan | null;
  recovery: Ingredient[][];
  copying: boolean;
  copyUncertain: boolean;
};
// Temporary, account-scoped memory only. No disk queue, analytics, or implicit writes.
export class ScanEditor {
  private state: EditorState;
  private listeners = new Set<() => void>();
  private pending: ScanCommand | null = null;
  private busy = false;
  private active = true;
  private copies = new Map<
    Ingredient[],
    { key: string; rows: Ingredient[]; result?: ManualScan }
  >();
  private pendingCopy: { key: string; rows: Ingredient[]; result?: ManualScan } | null = null;
  constructor(
    scan: ManualScan,
    private service: ScanService,
    private uuid: () => string,
  ) {
    this.state = {
      base: scan,
      rows: scan.ingredients,
      input: '',
      editingId: null,
      status: 'saved',
      error: null,
      fieldError: null,
      latest: null,
      recovery: [],
      copying: false,
      copyUncertain: false,
    };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  dispose() {
    this.active = false;
    this.listeners.clear();
  }
  private set(update: Partial<EditorState>) {
    if (!this.active) return;
    this.state = { ...this.state, ...update };
    this.listeners.forEach((listener) => listener());
  }
  get locked() {
    return (
      !this.active ||
      this.busy ||
      this.pending !== null ||
      this.pendingCopy !== null ||
      this.state.status === 'conflict'
    );
  }
  get pendingOperation() {
    return this.pending?.operation;
  }
  input(value: string) {
    if (!this.locked) this.set({ input: value, fieldError: null });
  }
  edit(id: string) {
    if (this.locked || this.state.input) return;
    const row = this.state.rows.find((item) => item.id === id);
    if (row) this.set({ input: row.displayName, editingId: id, fieldError: null });
  }
  cancelRename() {
    if (!this.locked && this.state.editingId)
      this.set({ input: '', editingId: null, fieldError: null });
  }
  applyInput() {
    if (this.locked) return false;
    const { input, editingId, rows } = this.state;
    const issue =
      nameIssue(input) ??
      (!editingId && rows.length >= 50 ? 'You can add up to 50 ingredients.' : undefined);
    if (issue) {
      this.set({ fieldError: issue });
      return false;
    }
    const next = editingId
      ? rows.map((row) => (row.id === editingId ? { ...row, displayName: input.trim() } : row))
      : [...rows, manualIngredient(this.uuid(), input)];
    this.set({
      rows: next,
      input: '',
      editingId: null,
      fieldError: null,
      error: null,
      status: 'editing',
    });
    return true;
  }
  change(id: string, operation: 'remove' | 'select' | 'up' | 'down') {
    if (this.locked) return;
    const rows = [...this.state.rows];
    const index = rows.findIndex((row) => row.id === id);
    const row = rows[index];
    if (!row) return;
    if (operation === 'remove') {
      // An in-progress rename remains in the input, ready to add back.
      rows.splice(index, 1);
      if (this.state.editingId === id) this.set({ editingId: null });
    } else if (operation === 'select') rows[index] = { ...row, selected: !row.selected };
    else {
      const otherIndex = index + (operation === 'up' ? -1 : 1);
      const other = rows[otherIndex];
      if (!other) return;
      rows[index] = other;
      rows[otherIndex] = row;
    }
    this.set({ rows, status: 'editing', error: null });
  }
  receive(scan: ManualScan) {
    if (
      scan.id !== this.state.base.id ||
      scan.version <= this.state.base.version ||
      this.busy ||
      this.pending ||
      this.pendingCopy
    )
      return;
    if (this.state.status === 'saved' && !this.state.input) {
      this.set({ base: scan, rows: scan.ingredients, latest: null });
    } else
      this.set({
        latest: scan,
        status: 'conflict',
        error: new ScanError('VERSION_CONFLICT').message,
      });
  }
  async refresh() {
    if (this.busy) return;
    try {
      const latest = await this.service.read(this.state.base.id);
      this.receive(latest);
      if (this.state.status === 'conflict') this.set({ latest });
    } catch (error) {
      this.set({ error: scanError(error).message });
    }
  }
  useLatest() {
    const { latest, rows } = this.state;
    if (!latest || this.busy || this.pending || this.pendingCopy) return;
    this.set({
      base: latest,
      rows: latest.ingredients,
      recovery: [...this.state.recovery, rows],
      latest: null,
      editingId: null,
      status: 'saved',
      error: null,
    });
  }
  async copy(online: boolean, recoveryIndex?: number): Promise<ManualScan | null> {
    if (this.busy || !online || !this.active) return null;
    const source =
      recoveryIndex === undefined ? this.state.rows : this.state.recovery[recoveryIndex];
    if (!source || !ingredientsSchema.safeParse(source).success) return null;
    // Unapplied input stays in the original editor; resolve it before leaving for a copy.
    if (!this.pendingCopy && recoveryIndex === undefined && this.state.input) {
      this.set({
        error:
          'Use the latest saved list first, then finish the name you’re entering. Your local list will remain in recoverable edits.',
      });
      return null;
    }
    let attempt = this.pendingCopy ?? this.copies.get(source);
    if (!attempt) {
      attempt = { key: this.uuid(), rows: source };
      this.copies.set(source, attempt);
    }
    if (attempt.result) return attempt.result;
    this.pendingCopy = attempt;
    this.busy = true;
    this.set({ copying: true });
    try {
      const scan = await this.service.create(attempt.key, attempt.rows);
      if (!this.active) return null;
      this.pendingCopy = null;
      attempt.result = scan;
      this.set({ copyUncertain: false, error: null });
      return scan;
    } catch (error) {
      const safe = scanError(error);
      if (!isUncertainScanError(safe)) this.pendingCopy = null;
      this.set({ error: safe.message, copyUncertain: this.pendingCopy !== null });
      return null;
    } finally {
      this.busy = false;
      this.set({ copying: false });
    }
  }
  async submit(operation: 'ingredients' | 'confirm', online: boolean): Promise<ManualScan | null> {
    if (this.busy || !this.active || this.pendingCopy) return null;
    if (!online) {
      this.set({ error: new ScanError('OFFLINE').message });
      return null;
    }
    if (this.state.status === 'conflict') return null;
    if (this.state.input || this.state.editingId) {
      this.set({ fieldError: 'Add or update the ingredient above before continuing.' });
      return null;
    }
    if (operation === 'confirm') {
      const issue = selectionIssue(this.state.rows);
      if (issue) {
        this.set({ error: issue });
        return null;
      }
      if (this.state.status === 'editing') return null;
      if (this.state.base.state === 'confirmed' && this.state.status === 'saved')
        return this.state.base;
    }
    if (!this.pending)
      this.pending = {
        key: this.uuid(),
        scan: this.state.base,
        operation,
        ingredients: this.state.rows,
      };
    const command = this.pending;
    if (command.operation !== operation) return null;
    this.busy = true;
    this.set({ status: 'saving', error: null });
    try {
      const scan = await this.service.mutate(command);
      if (!this.active) return null;
      this.pending = null;
      const expectedDraft = command.scan.draftRevision + (operation === 'ingredients' ? 1 : 0);
      if (
        scan.version !== command.scan.version + 1 ||
        scan.draftRevision !== expectedDraft ||
        scan.state !== (operation === 'confirm' ? 'confirmed' : 'needs_confirmation') ||
        !sameIngredients(scan.ingredients, command.ingredients)
      ) {
        this.set({
          status: 'conflict',
          latest: scan,
          error: new ScanError('VERSION_CONFLICT').message,
        });
        return null;
      }
      this.set({ base: scan, rows: scan.ingredients, status: 'saved', latest: null });
      return scan;
    } catch (error) {
      const safe = scanError(error);
      const conflict = safe.code === 'VERSION_CONFLICT' || safe.code === 'IDEMPOTENCY_CONFLICT';
      if (!isUncertainScanError(safe)) this.pending = null;
      this.set({
        error: safe.message,
        status: conflict
          ? 'conflict'
          : this.pending
            ? 'uncertain'
            : operation === 'confirm'
              ? 'saved'
              : 'editing',
      });
      if (conflict) {
        try {
          this.set({ latest: await this.service.read(command.scan.id) });
        } catch {
          /* Explicit refresh remains available. */
        }
      }
      return null;
    } finally {
      this.busy = false;
      this.set({});
    }
  }
}
