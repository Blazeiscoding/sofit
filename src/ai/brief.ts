import { getMainSleep, kvGet, kvSet } from '@/db/repo';
import { today } from '@/lib/date';
import { getSecret, SecretKeys } from '@/lib/secrets';
import type { Profile, Settings } from '@/store/settings';

import { runAgent } from './openrouter';
import { coachSystemPrompt, MORNING_BRIEF_PROMPT } from './prompts';
import { runTool, TOOL_DEFINITIONS } from './tools';

export type Brief = { date: string; text: string; at: number };

export function getCachedBrief(date = today()): Brief | null {
  return kvGet<Brief | null>(`brief:${date}`, null);
}

/**
 * Generates today's brief once last night's sleep has synced. Returns the cached copy when
 * one exists, or null when there's no key or no sleep yet.
 */
export async function ensureMorningBrief(profile: Profile, settings: Settings, force = false): Promise<Brief | null> {
  const date = today();
  const cached = getCachedBrief(date);
  if (cached && !force) return cached;
  if (!settings.morningBrief && !force) return null;
  if (!getMainSleep(date)) return null;
  const apiKey = await getSecret(SecretKeys.openRouterKey);
  if (!apiKey) return null;

  const text = await runAgent({
    apiKey,
    model: settings.aiModel,
    messages: [
      { role: 'system', content: coachSystemPrompt(profile) },
      { role: 'user', content: MORNING_BRIEF_PROMPT },
    ],
    tools: TOOL_DEFINITIONS,
    runTool: (name, args) => runTool(name, args, profile),
    maxRounds: 3,
  });
  const brief: Brief = { date, text: text.trim(), at: Date.now() };
  kvSet(`brief:${date}`, brief);
  return brief;
}
