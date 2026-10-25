import * as SecureStore from 'expo-secure-store';

// AFTER_FIRST_UNLOCK so the background task can read tokens while the phone is locked.
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export async function getSecret(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key, options);
}

export async function setSecret(key: string, value: string | null): Promise<void> {
  if (value == null) await SecureStore.deleteItemAsync(key, options);
  else await SecureStore.setItemAsync(key, value, options);
}

export const SecretKeys = {
  googleTokens: 'google_tokens',
  openRouterKey: 'openrouter_key',
} as const;

/**
 * Copies EXPO_PUBLIC_OPENROUTER_KEY from the local .env into secure storage on first launch,
 * so a personal build doesn't need the key pasted on the phone. A key saved in the app wins.
 */
export async function seedOpenRouterKeyFromEnv(): Promise<void> {
  const envKey = process.env.EXPO_PUBLIC_OPENROUTER_KEY?.trim();
  if (!envKey || (await getSecret(SecretKeys.openRouterKey))) return;
  await setSecret(SecretKeys.openRouterKey, envKey);
}
