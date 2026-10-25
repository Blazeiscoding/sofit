/**
 * Replaces the em/en dashes models like to use: numeric ranges become "5-7", dash bullets become
 * "- ", and dashes used as punctuation become commas.
 */
export function cleanAiText(text: string): string {
  return text
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')
    .replace(/^(\s*)[–—]\s+/gm, '$1- ')
    .replace(/[ \t]*[—–][ \t]*/g, ', ')
    .replace(/,\s*([.,;:!?)])/g, '$1')
    .replace(/,\s*$/gm, '');
}
