import { addedLineNumbers, baseLineSet } from "../core/diff.js";
import type { ZeroCommentsConfig } from "../core/config.js";
import type { CheckReport, Violation } from "../core/result.js";
import { extractCommentsForFile } from "../parsers/index.js";

interface AllowRule {
  test: (line: string, isFirstLine: boolean) => boolean;
  configKey: keyof ZeroCommentsConfig["allow"];
}

const ALLOW_RULES: AllowRule[] = [
  { configKey: "shebang", test: (line, isFirstLine) => isFirstLine && line.startsWith("#!") },
  { configKey: "ts-ignore", test: (line) => /@ts-ignore\b/.test(line) },
  { configKey: "ts-expect-error", test: (line) => /@ts-expect-error\b/.test(line) },
  {
    configKey: "eslint-directives",
    test: (line) => /eslint-(disable|enable)(-next-line)?\b/.test(line) || /eslint-env\b/.test(line),
  },
  { configKey: "noqa", test: (line) => /\bnoqa\b/i.test(line) },
  { configKey: "go-directives", test: (line) => /^\/\/go:\w+/.test(line.trim()) || /^\/\/\s*\+build\b/.test(line.trim()) },
  {
    configKey: "pragma-directives",
    test: (line) => /^#\s*region\b/i.test(line.trim()) || /^#\s*endregion\b/i.test(line.trim()) || /\bSPDX-License-Identifier\b/.test(line),
  },
];

function isAllowed(line: string, isFirstLine: boolean, config: ZeroCommentsConfig): boolean {
  for (const rule of ALLOW_RULES) {
    if (config.allow[rule.configKey] && rule.test(line, isFirstLine)) return true;
  }
  return config["custom-allow"].some((pattern) => new RegExp(pattern).test(line));
}

export async function checkZeroComments(
  file: string,
  base: string,
  current: string,
  config: ZeroCommentsConfig,
): Promise<CheckReport> {
  const violations: Violation[] = [];
  const warnings: string[] = [];

  const extraction = await extractCommentsForFile(file, current);
  if (!extraction.supported) {
    warnings.push(`No parser registered for ${file}; skipped zero-comments check.`);
    return { ok: true, violations, warnings };
  }

  const added = config["added-lines-only"] ? addedLineNumbers(base, current) : null;
  const baseLines = baseLineSet(base);
  const currentLines = current.split("\n");

  for (const comment of extraction.comments) {
    let violatingLine: number | null = null;
    for (let lineNo = comment.startLine; lineNo <= comment.endLine; lineNo++) {
      const isNew = added ? added.has(lineNo) : true;
      if (!isNew) continue;
      const rawLine = currentLines[lineNo - 1] ?? "";
      const trimmed = rawLine.trim();
      if (baseLines.has(trimmed)) continue;
      if (isAllowed(rawLine, lineNo === 1, config)) continue;
      violatingLine = lineNo;
      break;
    }
    if (violatingLine === null) continue;

    violations.push({
      policy: "zero-comments",
      file,
      line: violatingLine,
      snippet: comment.text,
      detail: "Added code comment.",
      action:
        "Remove the comment. Express the intent through naming, structure or implementation. Do not bypass this policy.",
    });
  }

  return { ok: violations.length === 0, violations, warnings };
}
