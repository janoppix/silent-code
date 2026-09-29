import { diffLines } from "diff";

export function addedLineNumbers(base: string, current: string): Set<number> {
  const added = new Set<number>();
  if (base === current) return added;

  const parts = diffLines(base, current);
  let lineNo = 0;
  for (const part of parts) {
    const count = part.value.split("\n").length - (part.value.endsWith("\n") ? 1 : 0);
    if (part.added) {
      for (let i = 0; i < count; i++) {
        added.add(lineNo + i + 1);
      }
    }
    if (!part.removed) {
      lineNo += count;
    }
  }
  return added;
}

export function baseLineSet(base: string): Set<string> {
  return new Set(base.split("\n").map((l) => l.trim()));
}

export function splitLines(text: string): string[] {
  return text.split("\n");
}
