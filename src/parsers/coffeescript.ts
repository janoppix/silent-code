import type { CommentRange } from "./treesitter.js";

/**
 * Minimal CoffeeScript tokenizer, scoped to what zero-comments needs: tell comments apart
 * from strings, block strings, interpolation and regex literals. Not a full CoffeeScript parser.
 */
export function extractCoffeeScriptComments(source: string): CommentRange[] {
  const ranges: CommentRange[] = [];
  let i = 0;
  let line = 1;
  const n = source.length;
  let lastSignificant: string | null = null; // last non-space char consumed, for regex/division disambiguation

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

    // Block comment ###...###
    if (source.startsWith("###", i)) {
      const start = i;
      const startLine = line;
      const end = source.indexOf("###", i + 3);
      const stop = end === -1 ? n : end + 3;
      const text = source.slice(start, stop);
      advanceThrough(text, 0);
      ranges.push({ startLine, endLine: line, text });
      i = stop;
      lastSignificant = null;
      continue;
    }

    // Line comment #...
    if (ch === "#") {
      const start = i;
      const startLine = line;
      let end = source.indexOf("\n", i);
      if (end === -1) end = n;
      ranges.push({ startLine, endLine: startLine, text: source.slice(start, end) });
      i = end;
      lastSignificant = null;
      continue;
    }

    // Triple-quoted block strings '''...''' and """...""" (interpolation inside """ handled generically below)
    if (source.startsWith("'''", i) || source.startsWith('"""', i)) {
      const quote = source.slice(i, i + 3);
      const start = i + 3;
      const end = source.indexOf(quote, start);
      const stop = end === -1 ? n : end + 3;
      advanceThrough(source.slice(i, stop), 0);
      i = stop;
      lastSignificant = "'";
      continue;
    }

    // Single-quoted string (no interpolation, but escapes allowed)
    if (ch === "'") {
      const start = i;
      i++;
      while (i < n && source[i] !== "'") {
        if (source[i] === "\\") i++;
        if (source[i] === "\n") line++;
        i++;
      }
      i++;
      lastSignificant = "'";
      void start;
      continue;
    }

    // Double-quoted string with #{...} interpolation
    if (ch === '"') {
      i++;
      while (i < n && source[i] !== '"') {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "#" && source[i + 1] === "{") {
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (source[i] === "{") depth++;
            if (source[i] === "}") depth--;
            if (source[i] === "\n") line++;
            i++;
          }
          continue;
        }
        if (source[i] === "\n") line++;
        i++;
      }
      i++;
      lastSignificant = '"';
      continue;
    }

    // Extended regex ///.../// (can contain comments in real CoffeeScript; treated as opaque here)
    if (source.startsWith("///", i)) {
      const start = i;
      const end = source.indexOf("///", i + 3);
      const stop = end === -1 ? n : end + 3;
      advanceThrough(source.slice(start, stop), 0);
      i = stop;
      lastSignificant = "/";
      continue;
    }

    // Regex literal /.../, disambiguated from division by previous significant token
    if (ch === "/" && canStartRegex(lastSignificant)) {
      const start = i;
      i++;
      let inClass = false;
      while (i < n && (inClass || source[i] !== "/")) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "[") inClass = true;
        if (source[i] === "]") inClass = false;
        if (source[i] === "\n") break; // unterminated, bail
        i++;
      }
      if (i < n && source[i] === "/") {
        i++;
        lastSignificant = "/";
        void start;
        continue;
      }
      // not actually a regex (unterminated) - treat as division, fall through
      i = start + 1;
      lastSignificant = "/";
      continue;
    }

    if (!/\s/.test(ch)) {
      lastSignificant = ch;
    }
    i++;
  }

  return ranges;
}

function canStartRegex(lastSignificant: string | null): boolean {
  if (lastSignificant === null) return true;
  if (/[a-zA-Z0-9_)\]}]/.test(lastSignificant)) return false;
  return true;
}
