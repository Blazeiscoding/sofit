import { describe, expect, it } from '@jest/globals';

import { cleanAiText } from '../text';

describe('cleanAiText', () => {
  it('turns dash punctuation into commas', () => {
    expect(cleanAiText('Recovery is low — HRV dropped')).toBe('Recovery is low, HRV dropped');
    expect(cleanAiText('Recovery is low—HRV dropped')).toBe('Recovery is low, HRV dropped');
  });

  it('keeps numeric ranges as hyphens', () => {
    expect(cleanAiText('Aim for 8–12 strain')).toBe('Aim for 8-12 strain');
    expect(cleanAiText('Sleep 7 — 9 hours')).toBe('Sleep 7-9 hours');
  });

  it('converts dash bullets', () => {
    expect(cleanAiText('— Drink water\n– Sleep early')).toBe('- Drink water\n- Sleep early');
  });

  it('does not leave dangling commas', () => {
    expect(cleanAiText('Good night —.')).toBe('Good night.');
    expect(cleanAiText('Train hard —')).toBe('Train hard');
  });

  it('leaves plain text alone', () => {
    expect(cleanAiText('HRV is **62 ms**, up from 55.')).toBe('HRV is **62 ms**, up from 55.');
  });
});
