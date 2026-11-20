/** Design tokens: the torch-lit palette of the prototype. Game art keeps its own colors. */
export const colors = {
  bg: '#0b0a08',
  surface: '#1d1912',
  surfacePressed: '#2a241a',
  border: '#5a4a30',
  ink: '#f0e2c2',
  muted: '#b9a888',
  dim: '#8f8168',
  gold: '#f3c55a',
  onGold: '#1d1912',
  danger: '#e0785f',
  scrim: 'rgba(5,4,3,0.78)',
} as const;

export const fonts = {
  display: 'Cinzel_700Bold',
  displayMedium: 'Cinzel_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
} as const;

export const type = {
  hero: { fontFamily: fonts.display, fontSize: 38, letterSpacing: 2, color: colors.ink },
  title: { fontFamily: fonts.display, fontSize: 26, letterSpacing: 1, color: colors.ink },
  heading: { fontFamily: fonts.displayMedium, fontSize: 18, letterSpacing: 0.5, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.ink },
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  label: { fontFamily: fonts.bodySemi, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.muted },
} as const;

/** 4-pt spacing scale */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16 } as const;
