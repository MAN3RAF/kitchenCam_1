import { Tabs } from 'expo-router/js-tabs';
import Bookmark from 'lucide-react-native/icons/bookmark';
import Home from 'lucide-react-native/icons/house';
import UserRound from 'lucide-react-native/icons/user-round';
import UsersRound from 'lucide-react-native/icons/users-round';
import Utensils from 'lucide-react-native/icons/utensils';
import { useWindowDimensions } from 'react-native';
import { Text } from '@/components/text';
import { tabs } from '@/constants/navigation';
import { spacing } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';

const icons = {
  home: Home,
  utensils: Utensils,
  bookmark: Bookmark,
  users: UsersRound,
  user: UserRound,
};

export function AppTabs() {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.actionPrimary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelPosition: 'below-icon',
        tabBarItemStyle: { minHeight: 48, paddingVertical: spacing.sm },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
          height: Math.max(76, 40 + fontScale * 40),
        },
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarAccessibilityLabel: tab.title,
            tabBarLabel: ({ focused }) => (
              <Text
                adjustsFontSizeToFit
                maxFontSizeMultiplier={1.4}
                minimumFontScale={0.7}
                numberOfLines={1}
                variant="caption"
                tone={focused ? 'link' : 'textSecondary'}
                style={{ flexShrink: 1, textAlign: 'center', width: '100%' }}
              >
                {tab.title}
              </Text>
            ),
            tabBarIcon: ({ color }) => {
              const Icon = icons[tab.icon];
              return <Icon size={22} color={color} accessible={false} aria-hidden />;
            },
          }}
        />
      ))}
    </Tabs>
  );
}
