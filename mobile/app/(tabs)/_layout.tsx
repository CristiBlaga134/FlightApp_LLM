import React from 'react';
import { View } from 'react-native';
import { Tabs, Redirect } from 'expo-router';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Radius } from '../../src/theme/colors';

type TabIconProps = { color: string; focused: boolean; iconName: Parameters<typeof IconSymbol>[0]['name']; label: string };

function TabPill({ color, focused, iconName }: TabIconProps) {
  return (
    <View style={{
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    }}>
      <IconSymbol size={24} name={iconName} color={color} />
      {focused && (
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.primary }} />
      )}
    </View>
  );
}

export default function TabLayout() {
  const { user, authLoading } = useAuth();

  if (authLoading) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        sceneStyle: { backgroundColor: "transparent" },
        tabBarHideOnKeyboard: true,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 18,
          height: 72,
          backgroundColor: Colors.surfaceRaised,
          borderTopWidth: 0,
          borderRadius: Radius.xl,
          shadowColor: '#3C271D',
          shadowOpacity: 0.12,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 10 },
          elevation: 12,
        },
        tabBarItemStyle: {
          alignItems: 'center',
          justifyContent: 'center',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Assistant',
          tabBarIcon: ({ color, focused }) => (
            <TabPill color={color} focused={focused} iconName="house.fill" label="Assistant" />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Trips',
          tabBarIcon: ({ color, focused }) => (
            <TabPill color={color} focused={focused} iconName="bookmark.fill" label="Trips" />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <TabPill color={color} focused={focused} iconName="person.fill" label="Profile" />
          ),
        }}
      />
    </Tabs>
  );
}
