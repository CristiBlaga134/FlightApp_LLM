export const Colors = {
  background: "#F4EEE5",
  backgroundDeep: "#E8DCCC",
  surface: "#FFF9F2",
  surfaceRaised: "#FFFCF7",
  surfaceSoft: "#F6EDE1",
  surfaceAccent: "#E8F7FF",
  surfaceDark: "#0D2440",

  primary: "#B97DDB",
  primaryDeep: "#9464AF",
  secondary: "#D6A548",
  secondarySoft: "#E5EDF4",
  accent: "#1E7BC2",
  accentSoft: "#BDD9EE",
  sky: "#DCE8F4",
  skySoft: "#EEF5FB",

  textPrimary: "#261D17",
  textSecondary: "#6F645B",
  textMuted: "#9B8F84",
  textOnDark: "#FFF8F0",

  border: "#E4D6C6",
  borderStrong: "#C8B39D",
  shadow: "#2A1D14",

  success: "#2E8B78",
  error: "#C74C4C",
  white: "#FFFFFF",
  black: "#111111",
};

export const Spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
};

export const Radius = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 999,
};

export const Typography = {
  display: "CormorantGaramond_700Bold",
  displaySoft: "CormorantGaramond_600SemiBold",
  sans: "Manrope_400Regular",
  sansMedium: "Manrope_500Medium",
  sansSemiBold: "Manrope_600SemiBold",
  sansBold: "Manrope_700Bold",
};

export const Shadows = {
  soft: {
    shadowColor: Colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 5,
  },
  card: {
    shadowColor: Colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  glow: {
    shadowColor: Colors.primary,
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 10,
  },
};