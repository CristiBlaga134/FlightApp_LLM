import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { CormorantGaramond_600SemiBold } from '@expo-google-fonts/cormorant-garamond/600SemiBold';
import { CormorantGaramond_700Bold } from '@expo-google-fonts/cormorant-garamond/700Bold';
import { Manrope_400Regular } from '@expo-google-fonts/manrope/400Regular';
import { Manrope_500Medium } from '@expo-google-fonts/manrope/500Medium';
import { Manrope_600SemiBold } from '@expo-google-fonts/manrope/600SemiBold';
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider } from '../src/context/AuthContext';
import { UserProfileProvider } from '../src/context/UserProfileContext';

// Polyfill for Hermes engine — performance.clearMarks/clearMeasures are not
// implemented in some RN versions but called by reanimated internals.
if (typeof performance !== 'undefined') {
  if (typeof performance.clearMarks !== 'function') {
    (performance as any).clearMarks = () => {};
  }
  if (typeof performance.clearMeasures !== 'function') {
    (performance as any).clearMeasures = () => {};
  }
  if (typeof performance.mark !== 'function') {
    (performance as any).mark = () => {};
  }
  if (typeof performance.measure !== 'function') {
    (performance as any).measure = () => {};
  }
}

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    CormorantGaramond_600SemiBold,
    CormorantGaramond_700Bold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <AuthProvider>
      <UserProfileProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack screenOptions={{
            headerShown: false,
            animation: "fade",
          }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="checkout"
              options={{ presentation: "modal", animation: "slide_from_right" }}
            />
            <Stack.Screen
              name="modal"
              options={{ presentation: "modal", title: "Modal", animation: "slide_from_bottom" }}
            />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </UserProfileProvider>
    </AuthProvider>
  );
}
