import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/button';
import { EmptyState } from '@/components/feedback';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { useAuth } from '@/features/auth/auth-provider';
import { spacing } from '@/theme/tokens';

export function VerifyScreen() {
  const { pendingEmail, verifyEmailCode, clearPendingEmail } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  if (!pendingEmail) {
    return (
      <Screen>
        <EmptyState
          title="No code is pending"
          message="Request a new email code to continue."
          action={{ label: 'Return to sign in', onPress: () => router.replace('/sign-in') }}
        />
      </Screen>
    );
  }

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await verifyEmailCode(code);
      router.replace(result.preferenceReviewRequired ? '/review-preferences' : '/profile');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The code could not be verified.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <View style={styles.content}>
        <Text variant="heading" accessibilityRole="header">
          Enter your code
        </Text>
        <Text tone="textSecondary">Enter the six-digit code sent to {pendingEmail.email}.</Text>
        <TextField
          label="Six-digit code"
          value={code}
          onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
          error={error}
          autoComplete="one-time-code"
          inputMode="numeric"
          keyboardType="number-pad"
          maxLength={6}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        <Button
          label={submitting ? 'Verifying…' : 'Verify code'}
          disabled={submitting || code.length !== 6}
          onPress={() => void submit()}
        />
        <Button
          label="Use a different email"
          variant="secondary"
          disabled={submitting}
          onPress={() => {
            void clearPendingEmail().then(() => router.replace('/sign-in'));
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ content: { gap: spacing.lg } });
