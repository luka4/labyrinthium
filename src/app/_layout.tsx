import { Cinzel_500Medium } from '@expo-google-fonts/cinzel/500Medium';
import { Cinzel_700Bold } from '@expo-google-fonts/cinzel/700Bold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { useFonts } from 'expo-font';
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useProgress } from '../state/progress';
import { useSettings } from '../state/settings';
import { colors } from '../ui/theme';

SplashScreen.preventAutoHideAsync();

/** Both persisted stores are loaded from storage. */
function useHydrated() {
  const [ready, setReady] = useState(() => useProgress.persist.hasHydrated() && useSettings.persist.hasHydrated());
  useEffect(() => {
    const check = () => setReady(useProgress.persist.hasHydrated() && useSettings.persist.hasHydrated());
    const a = useProgress.persist.onFinishHydration(check);
    const b = useSettings.persist.onFinishHydration(check);
    check();
    return () => {
      a();
      b();
    };
  }, []);
  return ready;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Cinzel_500Medium, Cinzel_700Bold, Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const hydrated = useHydrated();
  const ready = (fontsLoaded || !!fontError) && hydrated;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }}>
        <Stack.Screen name="play/[id]" options={{ gestureEnabled: false }} />
        <Stack.Screen name="artifact/[id]" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="settings" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
      <StatusBar style="light" />
    </GestureHandlerRootView>
  );
}
