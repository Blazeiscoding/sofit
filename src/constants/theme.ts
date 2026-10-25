import { Platform } from 'react-native';

export const Colors = {
  background: '#07090C',
  card: '#11161D',
  cardRaised: '#18202A',
  border: '#1F2833',
  text: '#FFFFFF',
  textSecondary: '#8A96A8',
  textMuted: '#55606F',
  recoveryHigh: '#16EC06',
  recoveryMid: '#FFDE00',
  recoveryLow: '#FF0026',
  strain: '#0093E7',
  sleep: '#7B8CFF',
  age: '#F5A524',
  hrv: '#21D4B4',
  danger: '#FF4D5E',
  stageDeep: '#3D4BE0',
  stageLight: '#7B8CFF',
  stageRem: '#21D4B4',
  stageAwake: '#F2F4F7',
} as const;

export const Fonts = {
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }),
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const Radius = {
  sm: 8,
  md: 14,
  lg: 20,
} as const;

export function recoveryColor(score: number | null | undefined): string {
  if (score == null) return Colors.textMuted;
  if (score >= 67) return Colors.recoveryHigh;
  if (score >= 34) return Colors.recoveryMid;
  return Colors.recoveryLow;
}
