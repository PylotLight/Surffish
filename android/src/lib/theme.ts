import { useColorScheme } from 'react-native'

// Surffish palette (desktop: src/renderer). Accent is the brand teal.
const shared = { accent: '#2f86e8', accentText: '#ffffff', danger: '#e5484d', private: '#8b5cf6' }

export const light = {
  ...shared,
  dark: false,
  bg: '#f6f7f9',
  surface: '#ffffff',
  surface2: '#eef0f3',
  border: '#dde1e6',
  text: '#14171c',
  muted: '#6b7280',
  privateBg: '#efe9ff'
}

export const dark: typeof light = {
  ...shared,
  dark: true,
  bg: '#0f1115',
  surface: '#171a20',
  surface2: '#22262e',
  border: '#2c313a',
  text: '#eceff4',
  muted: '#8b93a1',
  privateBg: '#231b3a'
}

export type Theme = typeof light

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light
}
