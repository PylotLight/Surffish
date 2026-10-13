import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router'
import { useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { startBrowser } from '../src/lib/browser'
import { useTheme } from '../src/lib/theme'

export default function RootLayout() {
  const t = useTheme()
  useEffect(() => {
    startBrowser().catch((e) => console.error('startBrowser failed', e))
  }, [])
  const nav = t.dark ? DarkTheme : DefaultTheme
  return (
    <SafeAreaProvider>
      <ThemeProvider value={{ ...nav, colors: { ...nav.colors, background: t.bg, card: t.surface, text: t.text, border: t.border, primary: t.accent } }}>
        <Stack screenOptions={{ headerStyle: { backgroundColor: t.surface }, headerTintColor: t.text, contentStyle: { backgroundColor: t.bg } }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="tabs" options={{ headerShown: false, animation: 'fade_from_bottom' }} />
          <Stack.Screen name="bookmarks" options={{ title: 'Bookmarks' }} />
          <Stack.Screen name="history" options={{ title: 'History' }} />
          <Stack.Screen name="extensions" options={{ title: 'Extensions' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        </Stack>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
