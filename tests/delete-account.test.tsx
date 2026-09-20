import type { ReactNode } from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { DeleteAccountScreen } from '@/features/auth/delete-account-screen';
import { useAuth } from '@/features/auth/auth-provider';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), replace: jest.fn() } }));
jest.mock('@/features/auth/auth-provider', () => ({ useAuth: jest.fn() }));
jest.mock('@/components/screen', () => ({
  Screen: ({ children }: { children: ReactNode }) => children,
}));

test('deletion requires explicit DELETE confirmation and allows cancellation beforehand', async () => {
  const requestAccountDeletion = jest.fn().mockResolvedValue(undefined);
  jest.mocked(useAuth).mockReturnValue({
    status: 'permanent',
    user: null,
    pendingEmail: null,
    createGuestSession: jest.fn(),
    requestEmailCode: jest.fn(),
    verifyEmailCode: jest.fn(),
    completeMagicLink: jest.fn(),
    clearPendingEmail: jest.fn(),
    signOut: jest.fn(),
    requestAccountDeletion,
  });
  const user = userEvent.setup();
  await render(<DeleteAccountScreen />);
  const button = screen.getByRole('button', { name: 'Delete account' });
  expect(button).toBeDisabled();
  await user.press(button);
  await user.press(screen.getByRole('button', { name: 'Keep account' }));
  expect(router.back).toHaveBeenCalledTimes(1);
  expect(requestAccountDeletion).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('Confirmation'), 'DELET');
  expect(button).toBeDisabled();
  await user.type(screen.getByLabelText('Confirmation'), 'E');
  expect(button).toBeEnabled();
  await user.press(button);
  expect(requestAccountDeletion).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/profile');
});
