import type { CommentRange } from "./treesitter.js";

export function extractCoffeeScriptComments(source: string): CommentRange[] {
  const ranges: CommentRange[] = [];
  let i = 0;
  let line = 1;
  const n = source.length;
  let lastNonSpaceChar: string | null = null;

  const advanceThrough = (text: string, from: number): number => {
    let l = line;
    for (let k = from; k < text.length; k++) {
      if (text[k] === "\n") l++;
    }
    line = l;
    return text.length;
  };

  while (i < n) {
    const ch = source[i];

    if (ch === "\n") {
      line++;
      i++;
      continue;
    }

    if (source.startsWith("###", i)) {
      const start = i;
      const startLine = line;
      const end = source.indexOf("###", i + 3);
      const stop = end === -1 ? n : end + 3;
      const text = source.slice(start, stop);
      advanceThrough(text, 0);
      ranges.push({ startLine, endLine: line, text });
      i = stop;
      lastNonSpaceChar = null;
      continue;
    }

    if (ch === "#") {
      const start = i;
      const startLine = line;
      let end = source.indexOf("\n", i);
      if (end === -1) end = n;
      ranges.push({ startLine, endLine: startLine, text: source.slice(start, end) });
      i = end;
      lastNonSpaceChar = null;
      continue;
    }

    if (source.startsWith("'''", i) || source.startsWith('"""', i)) {
      const quote = source.slice(i, i + 3);
      const start = i + 3;
      const end = source.indexOf(quote, start);
      const stop = end === -1 ? n : end + 3;
      advanceThrough(source.slice(i, stop), 0);
      i = stop;
      lastNonSpaceChar = "'";
      continue;
    }

    if (ch === "'") {
      i++;
      while (i < n && source[i] !== "'") {
        if (source[i] === "\\") i++;
        if (source[i] === "\n") line++;
        i++;
      }
      i++;
      lastNonSpaceChar = "'";
      continue;
    }

    if (ch === '"') {
      i++;
      while (i < n && source[i] !== '"') {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "#" && source[i + 1] === "{") {
          i += 2;
          let interpolationDepth = 1;
          while (i < n && interpolationDepth > 0) {
            if (source[i] === "{") interpolationDepth++;
            if (source[i] === "}") interpolationDepth--;
            if (source[i] === "\n") line++;
            i++;
          }
          continue;
        }
        if (source[i] === "\n") line++;
        i++;
      }
      i++;
      lastNonSpaceChar = '"';
      continue;
    }

    if (source.startsWith("///", i)) {
      const start = i;
      const end = source.indexOf("///", i + 3);
      const stop = end === -1 ? n : end + 3;
      advanceThrough(source.slice(start, stop), 0);
      i = stop;
      lastNonSpaceChar = "/";
      continue;
    }

    if (ch === "/" && canStartRegex(lastNonSpaceChar)) {
      const start = i;
      i++;
      let inCharacterClass = false;
      let closed = false;
      while (i < n) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "[") inCharacterClass = true;
        if (source[i] === "]") inCharacterClass = false;
        if (source[i] === "\n") break;
        if (!inCharacterClass && source[i] === "/") {
          closed = true;
          i++;
          break;
        }
        i++;
      }
      if (closed) {
        lastNonSpaceChar = "/";
        continue;
      }
      i = start + 1;
      lastNonSpaceChar = "/";
      continue;
    }

    if (!/\s/.test(ch)) {
      lastNonSpaceChar = ch;
    }
    i++;
  }

  return ranges;
}

function canStartRegex(lastNonSpaceChar: string | null): boolean {
  if (lastNonSpaceChar === null) return true;
  if (/[a-zA-Z0-9_)\]}]/.test(lastNonSpaceChar)) return false;
  return true;
}
