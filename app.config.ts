import type { ConfigContext, ExpoConfig } from 'expo/config';

// Google's iOS-type OAuth client redirects to the reversed client ID, so that
// scheme has to be registered on both platforms for the sign-in to return.
const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const reversedClientId = googleClientId.split('.').reverse().join('.');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  scheme: googleClientId ? ['sofit', reversedClientId] : 'sofit',
  ios: {
    ...config.ios,
    entitlements: {
      'com.apple.developer.usernotifications.time-sensitive': true,
    },
  },
});
