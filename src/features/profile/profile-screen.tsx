import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/button';
import { EmptyState, LoadingState } from '@/components/feedback';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { useAuth } from '@/features/auth/auth-provider';
import { spacing } from '@/theme/tokens';

export function ProfileScreen() {
  const { status, user, signOut } = useAuth();
  if (status === 'loading') {
    return (
      <Screen>
        <LoadingState label="Loading account" />
      </Screen>
    );
  }
  if (status === 'unconfigured') {
    return (
      <Screen>
        <EmptyState
          title="Account options aren't configured"
          message="Start the approved local backend and add its public local configuration to use sign-in."
        />
      </Screen>
    );
  }
  if (status === 'signed-out') {
    return (
      <Screen>
        <EmptyState
          title="Explore without an account"
          message="Sign in only when you want account-backed continuity or community access."
          action={{ label: 'Sign in with email', onPress: () => router.push('/sign-in') }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.content}>
        <Text variant="heading" accessibilityRole="header">
          {status === 'guest' ? 'Guest session' : 'Your account'}
        </Text>
        <Text tone="textSecondary">
          {status === 'guest'
            ? 'Your private data is tied to this device session until you link a verified account.'
            : (user?.email ?? 'Verified account')}
        </Text>
        {status === 'guest' ? (
          <Button label="Link an email account" onPress={() => router.push('/sign-in')} />
        ) : null}
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
        <Button
          label="Delete account"
          variant="secondary"
          onPress={() => router.push('/delete-account')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ content: { gap: spacing.lg } });
