import React from 'react';
import { Tabs, Redirect } from 'expo-router';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '../../src/context/AuthContext';
import { Colors, Radius, Typography } from '../../src/theme/colors';

export default function TabLayout() {
  const { user, authLoading } = useAuth();

  if (authLoading) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        sceneStyle: {
          backgroundColor: Colors.background,
        },
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 18,
          height: 78,
          paddingTop: 10,
          paddingBottom: 12,
          backgroundColor: Colors.surfaceRaised,
          borderTopWidth: 0,
          borderRadius: Radius.xl,
          shadowColor: '#3C271D',
          shadowOpacity: 0.12,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 10 },
          elevation: 12,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: Typography.sansBold,
          letterSpacing: 0.2,
        },
        tabBarItemStyle: {
          borderRadius: Radius.lg,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Assistant',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Trips',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="bookmark.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="person.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
