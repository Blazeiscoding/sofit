import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';

import { getSecret, SecretKeys, setSecret } from '@/lib/secrets';

WebBrowser.maybeCompleteAuthSession();

export const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';

export const GOOGLE_HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.settings.readonly',
];

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

type StoredTokens = {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. */
  expiresAt: number;
};

function redirectUri(): string {
  const reversed = GOOGLE_CLIENT_ID.split('.').reverse().join('.');
  return AuthSession.makeRedirectUri({ native: `${reversed}:/oauth2redirect` });
}

async function loadTokens(): Promise<StoredTokens | null> {
  const raw = await getSecret(SecretKeys.googleTokens);
  return raw ? (JSON.parse(raw) as StoredTokens) : null;
}

async function saveTokens(tokens: StoredTokens | null) {
  await setSecret(SecretKeys.googleTokens, tokens ? JSON.stringify(tokens) : null);
}

export async function isSignedIn(): Promise<boolean> {
  return (await loadTokens()) != null;
}

export class AuthRequiredError extends Error {
  constructor(message = 'Google sign-in required') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

let refreshing: Promise<StoredTokens> | null = null;

async function refresh(tokens: StoredTokens): Promise<StoredTokens> {
  if (!tokens.refreshToken) throw new AuthRequiredError('Session expired. Sign in again.');
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
  });
  const res = await fetch(discovery.tokenEndpoint!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    // invalid_grant means the refresh token was revoked or expired (7 days in Testing mode).
    if (res.status === 400 || res.status === 401) {
      await saveTokens(null);
      throw new AuthRequiredError('Session expired. Sign in again.');
    }
    throw new Error(`Token refresh failed (${res.status})`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
  const next: StoredTokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  await saveTokens(next);
  return next;
}

/** Returns a valid access token, refreshing it if it expires within a minute. */
export async function getAccessToken(forceRefresh = false): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens) throw new AuthRequiredError();
  if (!forceRefresh && tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
  refreshing ??= refresh(tokens).finally(() => {
    refreshing = null;
  });
  return (await refreshing).accessToken;
}

export async function signOut() {
  const tokens = await loadTokens();
  await saveTokens(null);
  if (tokens?.refreshToken) {
    fetch(`${discovery.revocationEndpoint}?token=${encodeURIComponent(tokens.refreshToken)}`, {
      method: 'POST',
    }).catch(() => {});
  }
}

/** Google OAuth (authorization code + PKCE) for the Google Health scopes. */
export function useGoogleSignIn() {
  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: GOOGLE_CLIENT_ID,
      redirectUri: redirectUri(),
      scopes: GOOGLE_HEALTH_SCOPES,
      usePKCE: true,
      // offline + consent makes Google return a refresh token every time.
      extraParams: { access_type: 'offline', prompt: 'consent' },
    },
    discovery,
  );
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    if (!request) return;
    setError(null);
    const response = await promptAsync();
    if (response.type === 'error') {
      setStatus('error');
      setError(response.error?.message ?? response.params.error_description ?? 'Sign-in failed');
      return;
    }
    if (response.type !== 'success') {
      setStatus('idle');
      return;
    }
    setStatus('working');
    try {
      const token = await AuthSession.exchangeCodeAsync(
        {
          clientId: GOOGLE_CLIENT_ID,
          code: response.params.code,
          redirectUri: redirectUri(),
          extraParams: { code_verifier: request.codeVerifier ?? '' },
        },
        discovery,
      );
      await saveTokens({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? null,
        expiresAt: Date.now() + (token.expiresIn ?? 3600) * 1000,
      });
      setStatus('done');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return {
    ready: !!request && !!GOOGLE_CLIENT_ID,
    configured: !!GOOGLE_CLIENT_ID,
    status,
    error,
    signIn,
  };
}
