import { render, screen, userEvent } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { Button } from '@/components/button';
import { ErrorState, LoadingState } from '@/components/feedback';

test('buttons expose disabled state, block presses, and allow wrapped dynamic text', async () => {
  const onPress = jest.fn();
  const user = userEvent.setup();
  const view = await render(<Button label="Scan ingredients" disabled onPress={onPress} />);
  expect(screen.getByRole('button', { name: 'Scan ingredients' })).toBeDisabled();
  await user.press(screen.getByRole('button'));
  expect(onPress).not.toHaveBeenCalled();
  await view.rerender(<Button label="Scan ingredients" onPress={onPress} />);
  await user.press(screen.getByRole('button'));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Scan ingredients').props.allowFontScaling).toBe(true);
  expect(screen.getByText('Scan ingredients').props.numberOfLines).toBeUndefined();
});

test('errors expose an alert and a working recovery action', async () => {
  const retry = jest.fn();
  await render(
    <ErrorState title="Couldn't open this screen" message="Try opening it again." retry={retry} />,
  );
  expect(screen.getByRole('alert')).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

test('loading remains understandable when reduced motion removes its spinner', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  await render(<LoadingState label="Opening screen" />);
  expect(
    screen.getByRole('progressbar', { name: 'Opening screen' }).props.accessibilityState,
  ).toEqual({ busy: true });
  expect(screen.getByText('Opening screen')).toBeOnTheScreen();
});
