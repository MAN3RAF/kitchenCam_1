import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { useAuth } from '@/features/auth/auth-provider';
import { spacing } from '@/theme/tokens';

export function SignInScreen() {
  const { requestEmailCode } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      await requestEmailCode(email);
      router.push('/verify');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in could not be started.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <View style={styles.content}>
        <Text variant="heading" accessibilityRole="header">
          Sign in with email
        </Text>
        <Text tone="textSecondary">We will send a six-digit code. No password is required.</Text>
        <TextField
          label="Email address"
          value={email}
          onChangeText={setEmail}
          error={error}
          autoCapitalize="none"
          autoComplete="email"
          inputMode="email"
          keyboardType="email-address"
          returnKeyType="send"
          onSubmitEditing={() => void submit()}
        />
        <Button
          label={submitting ? 'Sending code…' : 'Send code'}
          disabled={submitting}
          onPress={() => void submit()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ content: { gap: spacing.lg } });
