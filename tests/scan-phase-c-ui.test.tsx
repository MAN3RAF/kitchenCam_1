import { StrictMode, type ReactNode } from 'react';
import { randomUUID } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import { HomeScreen } from '@/features/home/home-screen';
import { ScanEntryScreen, ManualStartScreen } from '@/features/scans/scan-entry-screen';
import { ScanEditorScreen, IngredientEditor } from '@/features/scans/scan-editor-screen';
import { ConfirmIngredients } from '@/features/scans/scan-confirm-screen';
import { ScanReadyScreen } from '@/features/scans/scan-ready-screen';
import { ScanProvider, ScanSession, useScanSession } from '@/features/scans/scan-provider';
import * as scanServiceModule from '@/features/scans/scan-service';
import { useAuth } from '@/features/auth/auth-provider';
import { useConnectivity } from '@/hooks/use-connectivity';
import { manualIngredient, ScanError, type ManualScan } from '@/features/scans/scan-domain';
import type { ScanService } from '@/features/scans/scan-service';

jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const mockedRouter = { push: jest.fn(), replace: jest.fn(), navigate: jest.fn() };
  return {
    router: mockedRouter,
    useRouter: () => mockedRouter,
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
  };
});
jest.mock('expo-crypto', () => ({
  randomUUID: () => jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID(),
}));
jest.mock('@/features/auth/auth-provider', () => ({ useAuth: jest.fn() }));
jest.mock('@/config/public-env', () => ({
  publicEnvironment: {
    supabaseUrl: 'http://localhost:54321',
    supabasePublishableKey: 'public-test-key',
  },
}));
jest.mock('@/features/scans/scan-provider', () => ({
  ...jest.requireActual('@/features/scans/scan-provider'),
  useScanSession: jest.fn(),
}));
jest.mock('@/hooks/use-connectivity', () => ({ useConnectivity: jest.fn() }));
jest.mock('@/components/screen', () => ({
  Screen: ({ children }: { children: ReactNode }) => children,
}));

let scan: ManualScan;
let service: jest.Mocked<ScanService>;
let session: ScanSession;
beforeEach(() => {
  scan = {
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
  service = {
    read: jest.fn().mockImplementation(async () => scan),
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation(async () => scan),
    mutate: jest.fn(),
  };
  session = new ScanSession(service, scan.ownerId);
  jest.mocked(useScanSession).mockReturnValue(session);
  jest.mocked(useConnectivity).mockReturnValue('online');
  jest.mocked(useAuth).mockReturnValue({
    status: 'guest',
    user: null,
    pendingEmail: null,
    createGuestSession: jest.fn(),
    requestEmailCode: jest.fn(),
    verifyEmailCode: jest.fn(),
    completeMagicLink: jest.fn(),
    clearPendingEmail: jest.fn(),
    signOut: jest.fn(),
    requestAccountDeletion: jest.fn(),
  });
});
afterEach(() => session.dispose());
async function show(children: ReactNode) {
  return render(<QueryClientProvider client={session.query}>{children}</QueryClientProvider>);
}
async function press(name: string) {
  await fireEvent.press(screen.getByRole('button', { name }));
}
async function add(name: string) {
  await fireEvent.changeText(screen.getByLabelText('Add an ingredient'), name);
  await press('Add ingredient');
}

test('Home enters the honest manual journey', async () => {
  const view = await show(<HomeScreen />);
  await press('Add ingredients');
  expect(router.push).toHaveBeenCalledWith('/scans');
  await view.unmount();
  await show(<ScanEntryScreen />);
  expect(screen.getByText(/Photo recognition isn’t available yet/)).toBeOnTheScreen();
  await press('Add ingredients manually');
  expect(router.push).toHaveBeenCalledWith('/scans/manual');
});
test('starting manual entry creates a real-service attempt only on explicit action', async () => {
  await show(<ManualStartScreen />);
  expect(service.create).not.toHaveBeenCalled();
  await press('Start ingredient list');
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/scans/${scan.id}`));
  expect(service.create).toHaveBeenCalledTimes(1);
});
test('empty editor validates whitespace and exposes selected checkbox state after add', async () => {
  await show(<IngredientEditor scan={scan} session={session} />);
  expect(screen.getByText('Start with what you have')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Review selection' })).toBeDisabled();
  await add('  ');
  expect(screen.getByText('Enter an ingredient name.')).toBeOnTheScreen();
  await add('  Tomato  ');
  expect(screen.getByRole('checkbox', { name: /Tomato/ })).toBeChecked();
  expect(screen.getByText('Unsaved changes')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('checkbox', { name: /Tomato/ }));
  expect(screen.getByRole('checkbox', { name: /Tomato/ })).not.toBeChecked();
  expect(screen.getByText('Not selected')).toBeOnTheScreen();
});
test('rename, reorder, and remove controls preserve stable rows', async () => {
  await show(<IngredientEditor scan={scan} session={session} />);
  await add('Tomato');
  await add('Basil');
  const id = session.editor(scan).snapshot().rows[0]!.id;
  await press('Edit or reorder Tomato');
  await press('Rename Tomato');
  await fireEvent.changeText(screen.getByLabelText('Ingredient name'), 'Cherry tomato');
  await press('Update ingredient');
  await press('Move Cherry tomato down');
  expect(session.editor(scan).snapshot().rows[1]!.id).toBe(id);
  await press('Remove Cherry tomato');
  expect(screen.queryByRole('checkbox', { name: /Cherry tomato/ })).toBeNull();
  expect(screen.getByRole('checkbox', { name: /Basil/ })).toBeChecked();
});
test('server save errors preserve the list and offer safe retry', async () => {
  service.mutate.mockRejectedValue(new ScanError('UNAVAILABLE'));
  await show(<IngredientEditor scan={scan} session={session} />);
  await add('Tomato');
  await press('Save changes');
  expect(await screen.findByRole('button', { name: 'Retry save' })).toBeEnabled();
  expect(screen.getByRole('checkbox', { name: /Tomato/ })).toBeChecked();
  expect(screen.queryByText('Saved')).toBeNull();
});
test('offline editor accepts input but disables persistence and review', async () => {
  jest.mocked(useConnectivity).mockReturnValue('offline');
  await show(<IngredientEditor scan={scan} session={session} />);
  await add('Tomato');
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Review selection' })).toBeDisabled();
  expect(service.mutate).not.toHaveBeenCalled();
});
test('confirmation with no selected rows is disabled', async () => {
  await show(<ConfirmIngredients scan={scan} session={session} />);
  expect(screen.getByRole('button', { name: 'Confirm ingredients' })).toBeDisabled();
});
test('explicit confirmation waits for acknowledgement before navigating to Ready', async () => {
  scan = { ...scan, ingredients: [manualIngredient(randomUUID(), 'Tomato')] };
  let resolve!: (value: ManualScan) => void;
  service.mutate.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await show(<ConfirmIngredients scan={scan} session={session} />);
  await press('Confirm ingredients');
  expect(router.replace).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Confirming…' })).toBeDisabled();
  await act(async () =>
    resolve({
      ...scan,
      version: 2,
      state: 'confirmed',
      confirmedIngredients: scan.ingredients,
      confirmedAt: new Date().toISOString(),
    }),
  );
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/scans/${scan.id}/ready`));
});
test('Ready reconstructs from a read after route remount and offers edit and Done', async () => {
  scan = {
    ...scan,
    ingredients: [manualIngredient(randomUUID(), 'Tomato')],
    state: 'confirmed',
    confirmedAt: new Date().toISOString(),
  };
  scan.confirmedIngredients = scan.ingredients;
  const first = await show(<ScanReadyScreen id={scan.id} />);
  expect(await screen.findByText('Ingredients confirmed')).toBeOnTheScreen();
  await first.unmount();
  await show(<ScanReadyScreen id={scan.id} />);
  expect(await screen.findByText('Tomato')).toBeOnTheScreen();
  expect(service.read.mock.calls.length).toBeGreaterThanOrEqual(2);
  await press('Edit ingredients');
  expect(router.replace).toHaveBeenCalledWith(`/scans/${scan.id}`);
  await press('Done');
  expect(router.replace).toHaveBeenCalledWith('/');
});
test('route remount retains temporary unsaved input in the same account session', async () => {
  const first = await show(<ScanEditorScreen id={scan.id} />);
  await screen.findByLabelText('Add an ingredient');
  await fireEvent.changeText(screen.getByLabelText('Add an ingredient'), 'Unsaved basil');
  await first.unmount();
  await show(<ScanEditorScreen id={scan.id} />);
  expect(await screen.findByDisplayValue('Unsaved basil')).toBeOnTheScreen();
});
test('unauthorized scan shows a safe recovery state without ingredients', async () => {
  service.read.mockRejectedValue(new ScanError('NOT_FOUND'));
  await show(<ScanReadyScreen id={scan.id} />);
  expect(
    await screen.findByText('This ingredient list is unavailable for your current account.'),
  ).toBeOnTheScreen();
  expect(screen.queryByText('Ingredients confirmed')).toBeNull();
});
test('stale edit presents both lists and requires an explicit reconciliation choice', async () => {
  service.mutate.mockRejectedValue(new ScanError('VERSION_CONFLICT'));
  service.read.mockResolvedValue({
    ...scan,
    version: 2,
    draftRevision: 2,
    ingredients: [manualIngredient(randomUUID(), 'Basil')],
  });
  await show(<IngredientEditor scan={scan} session={session} />);
  await add('Tomato');
  await press('Save changes');
  expect(await screen.findByText('Latest saved ingredients')).toBeOnTheScreen();
  expect(screen.getByText('Basil')).toBeOnTheScreen();
  expect(screen.getByRole('checkbox', { name: /Tomato/ })).toBeChecked();
  await press('Use latest saved list');
  expect(screen.getByRole('checkbox', { name: /Basil/ })).toBeChecked();
  expect(screen.getByText('Your recoverable edits')).toBeOnTheScreen();
  expect(screen.getByText('Tomato')).toBeOnTheScreen();
});

test('a failed background refresh keeps unsaved input visible and usable', async () => {
  await show(<ScanEditorScreen id={scan.id} />);
  await screen.findByLabelText('Add an ingredient');
  await add('Tomato');
  await fireEvent.changeText(screen.getByLabelText('Add an ingredient'), 'Basil');
  service.read.mockRejectedValue(new ScanError('UNAVAILABLE'));
  await act(async () => {
    await session.query.invalidateQueries();
  });
  expect(await screen.findByText(/Could not refresh this list/)).toBeOnTheScreen();
  expect(screen.getByDisplayValue('Basil')).toBeOnTheScreen();
  expect(screen.getByRole('checkbox', { name: /Tomato/ })).toBeChecked();
  await press('Add ingredient');
  expect(screen.getByRole('checkbox', { name: /Basil/ })).toBeChecked();
});

test('a confirmed server cancellation removes the cached editor and offers safe recovery', async () => {
  await show(<ScanEditorScreen id={scan.id} />);
  await screen.findByLabelText('Add an ingredient');
  service.read.mockRejectedValue(new ScanError('CANCELLED'));
  await act(async () => {
    await session.query.invalidateQueries();
  });
  expect(
    await screen.findByText('This ingredient list was cancelled. It can’t be edited or confirmed.'),
  ).toBeOnTheScreen();
  expect(screen.queryByLabelText('Add an ingredient')).toBeNull();
  expect(screen.getByRole('button', { name: 'Go to Ingredients' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Retry refresh' })).toBeNull();
});

test('an offline remount recovers this session’s editor without claiming another save', async () => {
  const view = await show(<ScanEditorScreen id={scan.id} />);
  await screen.findByLabelText('Add an ingredient');
  await add('Tomato');
  await view.unmount();
  await act(async () => {
    session.query.clear();
  });
  service.read.mockRejectedValue(new ScanError('UNAVAILABLE'));
  jest.mocked(useConnectivity).mockReturnValue('offline');
  await show(<ScanEditorScreen id={scan.id} />);
  expect(await screen.findByRole('checkbox', { name: /Tomato/ })).toBeChecked();
  expect(screen.getByText('Unsaved changes')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});

test('a denied refresh hides previously loaded data instead of showing a cached Ready screen', async () => {
  scan = {
    ...scan,
    ingredients: [manualIngredient(randomUUID(), 'Tomato')],
    state: 'confirmed',
    confirmedAt: new Date().toISOString(),
  };
  scan.confirmedIngredients = scan.ingredients;
  await show(<ScanReadyScreen id={scan.id} />);
  await screen.findByText('Ingredients confirmed');
  service.read.mockRejectedValue(new ScanError('NOT_FOUND'));
  await act(async () => {
    await session.query.invalidateQueries();
  });
  expect(
    await screen.findByText('This ingredient list is unavailable for your current account.'),
  ).toBeOnTheScreen();
  expect(screen.queryByText('Tomato')).toBeNull();
});

test('same-session creation deduplicates rapid calls and lost acknowledgement retries', async () => {
  service.create.mockRejectedValueOnce(new ScanError('UNAVAILABLE'));
  await expect(session.create()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  const first = session.create();
  const second = session.create();
  expect(first).toBe(second);
  await first;
  expect(service.create.mock.calls[1]).toEqual(service.create.mock.calls[0]);
  expect((await session.create()).id).toBe(scan.id);
  expect(service.create).toHaveBeenCalledTimes(2);
});

test('confirmation cannot skip a save whose acknowledgement is still unknown', async () => {
  const editor = session.editor(scan);
  editor.input('Tomato');
  editor.applyInput();
  service.mutate.mockRejectedValue(new ScanError('UNAVAILABLE'));
  await editor.submit('ingredients', true);
  await show(<ConfirmIngredients scan={scan} session={session} />);
  expect(screen.getByText(/save your changes before confirming/)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Confirm ingredients' })).toBeDisabled();
});

test('cancel rename explicitly restores the original row', async () => {
  await show(<IngredientEditor scan={scan} session={session} />);
  await add('Tomato');
  await press('Edit or reorder Tomato');
  await press('Rename Tomato');
  await fireEvent.changeText(screen.getByLabelText('Ingredient name'), 'Unfinished change');
  await press('Cancel rename');
  expect(screen.getByRole('checkbox', { name: /Tomato/ })).toBeChecked();
  expect(screen.getByLabelText('Add an ingredient')).toHaveDisplayValue('');
});

const useActualScanSession = jest.requireActual<typeof import('@/features/scans/scan-provider')>(
  '@/features/scans/scan-provider',
).useScanSession;
function AccountEditor() {
  const current = useActualScanSession();
  return current ? (
    <IngredientEditor scan={{ ...scan, ownerId: current.ownerId }} session={current} />
  ) : null;
}
test('account scope survives Strict Mode reconnects and same-ID refresh but clears edits on identity change', async () => {
  jest.spyOn(scanServiceModule, 'createScanService').mockReturnValue(service);
  const user = {
    id: scan.ownerId,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: scan.createdAt,
    is_anonymous: true,
  };
  const auth = jest.mocked(useAuth).getMockImplementation()!();
  jest.mocked(useAuth).mockReturnValue({ ...auth, user });
  const view = await render(
    <StrictMode>
      <ScanProvider>
        <AccountEditor />
      </ScanProvider>
    </StrictMode>,
  );
  await add('Tomato');
  jest
    .mocked(useAuth)
    .mockReturnValue({ ...auth, status: 'permanent', user: { ...user, is_anonymous: false } });
  await view.rerender(
    <StrictMode>
      <ScanProvider>
        <AccountEditor />
      </ScanProvider>
    </StrictMode>,
  );
  expect(screen.getByRole('checkbox', { name: /Tomato/ })).toBeChecked();
  jest.mocked(useAuth).mockReturnValue({ ...auth, user: { ...user, id: randomUUID() } });
  await view.rerender(
    <StrictMode>
      <ScanProvider>
        <AccountEditor />
      </ScanProvider>
    </StrictMode>,
  );
  expect(screen.queryByRole('checkbox', { name: /Tomato/ })).toBeNull();
  expect(screen.getByText('Start with what you have')).toBeOnTheScreen();
});
