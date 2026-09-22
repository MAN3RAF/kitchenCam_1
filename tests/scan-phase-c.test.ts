import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { ScanEditor } from '@/features/scans/scan-editor';
import {
  manualIngredient,
  nameIssue,
  selectionIssue,
  ScanError,
  type ManualScan,
} from '@/features/scans/scan-domain';
import {
  projectManualScan,
  createScanService,
  type ScanService,
  type ScanCommand,
} from '@/features/scans/scan-service';

function fixture() {
  const scan: ManualScan = {
    id: randomUUID(),
    ownerId: randomUUID(),
    version: 1,
    draftRevision: 1,
    state: 'needs_confirmation',
    ingredients: [],
    confirmedIngredients: null,
    confirmedAt: null,
    createdAt: new Date().toISOString(),
  };
  const service: jest.Mocked<ScanService> = {
    read: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    mutate: jest.fn(),
  };
  const editor = new ScanEditor(scan, service, randomUUID);
  return { scan, service, editor };
}
function acknowledgement(command: ScanCommand): ManualScan {
  return {
    ...command.scan,
    version: command.scan.version + 1,
    draftRevision: command.scan.draftRevision + (command.operation === 'ingredients' ? 1 : 0),
    ingredients: command.ingredients,
    state: command.operation === 'confirm' ? 'confirmed' : 'needs_confirmation',
    confirmedIngredients:
      command.operation === 'confirm' ? command.ingredients.filter((row) => row.selected) : null,
    confirmedAt: command.operation === 'confirm' ? new Date().toISOString() : null,
  };
}
test('names reject whitespace and over-limit input while supporting trimmed Unicode code points', () => {
  expect(nameIssue(' \t\n ')).toBeDefined();
  expect(nameIssue('é'.repeat(121))).toBeDefined();
  expect(nameIssue('🍅'.repeat(120))).toBeUndefined();
  expect(manualIngredient(randomUUID(), '  طماطم  ').displayName).toBe('طماطم');
});
test('manual rows retain identity through editing, selection, ordering, and removal', () => {
  const { editor } = fixture();
  editor.input('Tomato');
  editor.applyInput();
  const id = editor.snapshot().rows[0]!.id;
  editor.input('Basil');
  editor.applyInput();
  editor.edit(id);
  editor.input('Cherry tomato');
  editor.applyInput();
  editor.change(id, 'down');
  editor.change(id, 'select');
  expect(editor.snapshot().rows[1]).toMatchObject({
    id,
    displayName: 'Cherry tomato',
    selected: false,
    provenance: 'manual',
    detectionId: null,
  });
  editor.change(id, 'up');
  editor.change(id, 'remove');
  expect(editor.snapshot().rows.map((row) => row.displayName)).toEqual(['Basil']);
});
test('rapid repeated add does not duplicate the row or erase invalid input', () => {
  const { editor } = fixture();
  editor.input('  Tomato  ');
  editor.applyInput();
  editor.applyInput();
  expect(editor.snapshot().rows).toHaveLength(1);
  editor.input('x'.repeat(121));
  editor.applyInput();
  expect(editor.snapshot().input).toHaveLength(121);
  expect(editor.snapshot().fieldError).toBeDefined();
});
test('duplicate-looking rows stay separate and selected exact matches need explicit resolution', () => {
  const rows = [manualIngredient(randomUUID(), 'Tomato'), manualIngredient(randomUUID(), 'tomato')];
  expect(selectionIssue(rows)).toMatch(/names match/);
  expect(selectionIssue([{ ...rows[0]!, selected: false }, rows[1]!])).toBeUndefined();
});
test('fifty-row limit preserves the fifty-first input', () => {
  const { editor } = fixture();
  for (let i = 0; i < 51; i++) {
    editor.input(`Ingredient ${i}`);
    editor.applyInput();
  }
  expect(editor.snapshot().rows).toHaveLength(50);
  expect(editor.snapshot().input).toBe('Ingredient 50');
});
test('offline editing never dispatches or reports a server save', async () => {
  const { editor, service } = fixture();
  editor.input('Tomato');
  editor.applyInput();
  expect(await editor.submit('ingredients', false)).toBeNull();
  expect(service.mutate).not.toHaveBeenCalled();
  expect(editor.snapshot().status).toBe('editing');
  expect(editor.snapshot().rows).toHaveLength(1);
});
test('unapplied input cannot be silently skipped when saving', async () => {
  const { editor, service } = fixture();
  editor.input('Tomato');
  await editor.submit('ingredients', true);
  expect(service.mutate).not.toHaveBeenCalled();
  expect(editor.snapshot().input).toBe('Tomato');
});
test('zero selection confirmation never dispatches', async () => {
  const { editor, service } = fixture();
  await editor.submit('confirm', true);
  expect(service.mutate).not.toHaveBeenCalled();
  expect(editor.snapshot().error).toMatch(/at least one/);
});
test('saving locks concurrent taps and only acknowledges after the response', async () => {
  const { editor, service } = fixture();
  let resolve!: (scan: ManualScan) => void;
  service.mutate.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  editor.input('Tomato');
  editor.applyInput();
  const pending = editor.submit('ingredients', true);
  expect(editor.snapshot().status).toBe('saving');
  await editor.submit('ingredients', true);
  expect(service.mutate).toHaveBeenCalledTimes(1);
  resolve(acknowledgement(service.mutate.mock.calls[0]![0]));
  await pending;
  expect(editor.snapshot().status).toBe('saved');
  expect(editor.locked).toBe(false);
});
test('lost acknowledgement retries the identical key and body and preserves local edits', async () => {
  const { editor, service } = fixture();
  service.mutate
    .mockRejectedValueOnce(new Error('private operational detail'))
    .mockImplementationOnce(async (command) => acknowledgement(command));
  editor.input('Tomato');
  editor.applyInput();
  await editor.submit('ingredients', true);
  expect(editor.snapshot().status).toBe('uncertain');
  expect(editor.snapshot().error).not.toContain('private');
  editor.input('must not change ambiguous request');
  await editor.submit('ingredients', true);
  expect(service.mutate.mock.calls[1]![0]).toBe(service.mutate.mock.calls[0]![0]);
  expect(editor.snapshot().status).toBe('saved');
});
test('validation rejection preserves rows and allows corrections', async () => {
  const { editor, service } = fixture();
  service.mutate.mockRejectedValue(new ScanError('VALIDATION'));
  editor.input('Tomato');
  editor.applyInput();
  await editor.submit('ingredients', true);
  expect(editor.snapshot().rows).toHaveLength(1);
  expect(editor.locked).toBe(false);
});
test('stale edit retains local rows, loads latest, and explicit reconciliation keeps recovery text', async () => {
  const { scan, editor, service } = fixture();
  const latest = {
    ...scan,
    version: 2,
    draftRevision: 2,
    ingredients: [manualIngredient(randomUUID(), 'Basil')],
  };
  service.mutate.mockRejectedValue(new ScanError('VERSION_CONFLICT'));
  service.read.mockResolvedValue(latest);
  editor.input('Tomato');
  editor.applyInput();
  await editor.submit('ingredients', true);
  expect(editor.snapshot().status).toBe('conflict');
  expect(editor.snapshot().rows[0]!.displayName).toBe('Tomato');
  expect(editor.snapshot().latest).toBe(latest);
  editor.useLatest();
  expect(editor.snapshot().rows[0]!.displayName).toBe('Basil');
  expect(editor.snapshot().recovery[0]![0]!.displayName).toBe('Tomato');
  expect(service.mutate).toHaveBeenCalledTimes(1);
});
test('newer replay response cannot falsely report the submitted draft as saved', async () => {
  const { scan, editor, service } = fixture();
  service.mutate.mockResolvedValue({ ...scan, version: 4, draftRevision: 4 });
  editor.input('Tomato');
  editor.applyInput();
  await editor.submit('ingredients', true);
  expect(editor.snapshot().status).toBe('conflict');
  expect(editor.snapshot().rows[0]!.displayName).toBe('Tomato');
});
test('confirmation and edit after confirmation use distinct expected revisions', async () => {
  const { editor, service } = fixture();
  service.mutate.mockImplementation(async (command) => acknowledgement(command));
  editor.input('Tomato');
  editor.applyInput();
  await editor.submit('ingredients', true);
  const confirmed = await editor.submit('confirm', true);
  expect(confirmed?.confirmedIngredients).toHaveLength(1);
  editor.input('Basil');
  editor.applyInput();
  const reopened = await editor.submit('ingredients', true);
  expect(reopened?.state).toBe('needs_confirmation');
  expect(reopened?.confirmedIngredients).toBeNull();
  expect(service.mutate.mock.calls.map(([command]) => command.scan.version)).toEqual([1, 2, 3]);
});
test('identity disposal suppresses a late mutation acknowledgement', async () => {
  const { editor, service } = fixture();
  service.mutate.mockImplementation(async (command) => {
    editor.dispose();
    return acknowledgement(command);
  });
  editor.input('Tomato');
  editor.applyInput();
  expect(await editor.submit('ingredients', true)).toBeNull();
  expect(editor.snapshot().status).not.toBe('saved');
});
test('adapter rejects malformed/manual provenance and cross-owner projections safely', () => {
  const { scan } = fixture();
  const row = {
    id: scan.id,
    owner_id: scan.ownerId,
    source: 'manual',
    version: 1,
    draft_revision: 1,
    state: scan.state,
    image_revision: 0,
    manual_fallback: true,
    sanitization_state: 'not_started',
    ingredients: [],
    confirmed_ingredients: null,
    confirmed_at: null,
    created_at: scan.createdAt,
  };
  expect(projectManualScan(row, scan.ownerId)).toEqual(scan);
  expect(() => projectManualScan(row, randomUUID())).toThrow(ScanError);
  expect(() =>
    projectManualScan(
      {
        ...row,
        ingredients: [{ ...manualIngredient(randomUUID(), 'Tomato'), privatePath: 'private' }],
      },
      scan.ownerId,
    ),
  ).toThrow(ScanError);
});

test('adapter accepts and preserves an authoritative manual quantity while rejecting malformed quantities', () => {
  const { scan } = fixture();
  const quantity = { value: '2.5', unit: 'each', estimated: false } as const;
  const row = {
    id: scan.id,
    owner_id: scan.ownerId,
    source: 'manual',
    version: 1,
    draft_revision: 1,
    state: scan.state,
    image_revision: 0,
    manual_fallback: true,
    sanitization_state: 'not_started',
    ingredients: [{ ...manualIngredient(randomUUID(), 'Tomato'), quantity }],
    confirmed_ingredients: null,
    confirmed_at: null,
    created_at: scan.createdAt,
  };
  expect(projectManualScan(row, scan.ownerId).ingredients[0]!.quantity).toEqual(quantity);
  expect(() =>
    projectManualScan(
      {
        ...row,
        ingredients: [
          { ...row.ingredients[0], quantity: { value: '2', unit: 'grams', estimated: false } },
        ],
      },
      scan.ownerId,
    ),
  ).toThrow(ScanError);
  expect(
    projectManualScan(
      { ...row, ingredients: [{ ...row.ingredients[0], quantity: null }] },
      scan.ownerId,
    ).ingredients[0]!.quantity,
  ).toBeNull();
});

test('successive conflicts preserve every recoverable list and pending name', () => {
  const { scan, editor } = fixture();
  editor.input('Tomato');
  editor.applyInput();
  editor.input('Unfinished name');
  editor.receive({ ...scan, version: 2, ingredients: [manualIngredient(randomUUID(), 'Basil')] });
  editor.useLatest();
  expect(editor.snapshot().input).toBe('Unfinished name');
  editor.applyInput();
  editor.receive({ ...scan, version: 3, ingredients: [manualIngredient(randomUUID(), 'Onion')] });
  editor.useLatest();
  expect(editor.snapshot().recovery.map((rows) => rows.map((row) => row.displayName))).toEqual([
    ['Tomato'],
    ['Basil', 'Unfinished name'],
  ]);
});

test('separate-list retry freezes its payload and acknowledgement prevents duplicate copies', async () => {
  const { scan, editor, service } = fixture();
  editor.input('Tomato');
  editor.applyInput();
  editor.receive({ ...scan, version: 2 });
  service.create.mockRejectedValueOnce(new ScanError('UNAVAILABLE'));
  expect(await editor.copy(true)).toBeNull();
  expect(editor.snapshot().copyUncertain).toBe(true);
  editor.useLatest();
  expect(editor.snapshot().status).toBe('conflict');
  service.create.mockImplementation(async (_key, rows) => ({
    ...scan,
    id: randomUUID(),
    ingredients: rows,
  }));
  const result = await editor.copy(true);
  expect(service.create.mock.calls[1]).toEqual(service.create.mock.calls[0]);
  expect(await editor.copy(true)).toBe(result);
  expect(service.create).toHaveBeenCalledTimes(2);
});

test('current conflict copy never substitutes an older recovery list', async () => {
  const { scan, editor, service } = fixture();
  service.create.mockImplementation(async (_key, rows) => ({
    ...scan,
    id: randomUUID(),
    ingredients: rows,
  }));
  editor.input('Tomato');
  editor.applyInput();
  editor.receive({ ...scan, version: 2, ingredients: [manualIngredient(randomUUID(), 'Basil')] });
  editor.useLatest();
  editor.input('Onion');
  editor.applyInput();
  editor.receive({ ...scan, version: 3 });
  expect((await editor.copy(true))?.ingredients.map((row) => row.displayName)).toEqual([
    'Basil',
    'Onion',
  ]);
  expect((await editor.copy(true, 0))?.ingredients.map((row) => row.displayName)).toEqual([
    'Tomato',
  ]);
});

test('unapplied input is not silently left behind by a conflict-copy navigation', async () => {
  const { scan, editor, service } = fixture();
  editor.input('Unfinished name');
  editor.receive({ ...scan, version: 2 });
  expect(await editor.copy(true)).toBeNull();
  expect(service.create).not.toHaveBeenCalled();
  expect(editor.snapshot().input).toBe('Unfinished name');
});

test('unsupported Unicode input stays editable with a safe validation message', () => {
  const { editor } = fixture();
  for (const value of ['bad\u0000name', '\ud800']) {
    editor.input(value);
    expect(editor.applyInput()).toBe(false);
    expect(editor.snapshot().input).toBe(value);
    expect(editor.snapshot().fieldError).toMatch(/unsupported characters/);
  }
});

test('repeated confirmation after acknowledgement returns the durable result without another mutation', async () => {
  const { editor, service } = fixture();
  service.mutate.mockImplementation(async (command) => acknowledgement(command));
  editor.input('Tomato');
  editor.applyInput();
  await editor.submit('ingredients', true);
  const confirmed = await editor.submit('confirm', true);
  expect(await editor.submit('confirm', true)).toBe(confirmed);
  expect(service.mutate).toHaveBeenCalledTimes(2);
});

test('adapter aborts a stalled read with a safe error after the bounded deadline', async () => {
  jest.useFakeTimers();
  try {
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const client = createClient<Database>('http://localhost:54321', 'public-test-key', {
      accessToken: async () => null,
      global: {
        fetch: async (_url, options) => {
          requestStarted();
          return new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('transport detail'), { name: 'AbortError' })),
            );
          });
        },
      },
    });
    const result = createScanService(client, randomUUID()).read(randomUUID());
    const assertion = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
    await started;
    await jest.advanceTimersByTimeAsync(20_000);
    await assertion;
  } finally {
    jest.useRealTimers();
  }
});

test('adapter bounds token retrieval and ignores a late token resolution after timeout', async () => {
  jest.useFakeTimers();
  try {
    let releaseToken!: (token: string | null) => void;
    const token = new Promise<string | null>((resolve) => {
      releaseToken = resolve;
    });
    const client = createClient<Database>('http://localhost:54321', 'public-test-key', {
      accessToken: () => token,
      global: { fetch: jest.fn() },
    });
    const result = createScanService(client, randomUUID()).read(randomUUID());
    let settled = 0;
    void result.then(
      () => {
        settled++;
      },
      () => {
        settled++;
      },
    );
    const assertion = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
    await jest.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(settled).toBe(1);
    releaseToken('late-token');
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(1);
  } finally {
    jest.useRealTimers();
  }
});
