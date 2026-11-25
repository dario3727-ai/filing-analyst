/**
 * Answers sometimes use **bold** labels (Sonnet does despite the prompt).
 * Split text into plain and bold runs so the page shows bold instead of
 * asterisks. Unmatched "**" stays as typed. Pure; no HTML is produced here.
 */
export interface InlineRun {
  text: string;
  bold: boolean;
}

export function splitBold(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const pattern = /\*\*([^*]+?)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), bold: false });
    runs.push({ text: m[1]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold: false });
  return runs;
}
