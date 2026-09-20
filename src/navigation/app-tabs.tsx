import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { tabs } from '@/constants/navigation';
import { useTheme } from '@/theme/use-theme';

export function AppTabs() {
  const { colors } = useTheme();
  return (
    <NativeTabs
      tintColor={colors.actionPrimary}
      backgroundColor={colors.surface}
      labelStyle={{ color: colors.textSecondary }}
    >
      {tabs.map((tab) => (
        <NativeTabs.Trigger key={tab.name} name={tab.name}>
          <NativeTabs.Trigger.Label>{tab.title}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={tab.sf} md={tab.md} />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
