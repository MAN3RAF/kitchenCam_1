import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { useAuth } from '@/features/auth/auth-provider';
import { spacing } from '@/theme/tokens';

export function DeleteAccountScreen() {
  const { requestAccountDeletion } = useAuth();
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const remove = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      await requestAccountDeletion();
      router.replace('/profile');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Deletion could not be started.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <View style={styles.content}>
        <Text variant="heading" accessibilityRole="header">
          Delete account
        </Text>
        <Text tone="danger">
          This decision is immediate and cannot be cancelled. Cleanup may continue in the
          background.
        </Text>
        <Text>
          Type DELETE to confirm. For security, you may be asked to sign in again before deletion
          can start.
        </Text>
        <TextField
          label="Confirmation"
          value={confirmation}
          onChangeText={setConfirmation}
          error={error}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Button
          label={submitting ? 'Deleting account…' : 'Delete account'}
          disabled={submitting || confirmation !== 'DELETE'}
          onPress={() => void remove()}
        />
        <Button label="Keep account" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ content: { gap: spacing.lg } });
