/**
 * Google's OAuth redirect (`com.googleusercontent.apps…:/oauth2redirect?code=…`) reopens the app on
 * Android. expo-auth-session reads that URL itself, so keep the router where it is instead of
 * treating it as a page.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  try {
    if (path.includes('oauth2redirect')) return null;
    return path;
  } catch {
    return '/';
  }
}
