/** Pure flashcard parsing - shared by the deck store and the editor UI. */

export interface Card {
  front: string;
  back: string;
}

/**
 * Parse pasted text into cards - one card per line, term/definition separated
 * by a TAB (Quizlet default) or, failing that, the first comma (CSV).
 */
export function parseCards(text: string): Card[] {
  const out: Card[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sep = line.includes("\t") ? "\t" : line.includes(",") ? "," : null;
    if (!sep) continue;
    const i = line.indexOf(sep);
    const front = line.slice(0, i).trim();
    const back = line.slice(i + 1).trim();
    if (front || back) out.push({ front, back });
  }
  return out;
}
