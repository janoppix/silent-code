import type { ZeroCoauthorConfig } from "../core/config.js";
import type { CheckReport, Violation } from "../core/result.js";

const TRAILER_RE = /^\s*co-authored-by\s*:/i;

export interface CoauthorCheckResult extends CheckReport {
  strippedMessage?: string;
}

export function checkZeroCoauthor(message: string, config: ZeroCoauthorConfig): CoauthorCheckResult {
  const lines = message.split("\n");
  const matches: { line: number; text: string }[] = [];
  lines.forEach((line, idx) => {
    if (TRAILER_RE.test(line)) matches.push({ line: idx + 1, text: line });
  });

  if (matches.length === 0) {
    return { ok: true, violations: [], warnings: [] };
  }

  if (config.mode === "strip") {
    const stripped = lines.filter((line) => !TRAILER_RE.test(line)).join("\n");
    return { ok: true, violations: [], warnings: [`Stripped ${matches.length} Co-Authored-By trailer(s).`], strippedMessage: stripped };
  }

  const violations: Violation[] = matches.map((m) => ({
    policy: "zero-coauthor",
    line: m.line,
    snippet: m.text,
    detail: "Commit message contains a Co-Authored-By trailer.",
    action:
      "Remove the Co-Authored-By line from the commit message. Authorship trailers for AI agents are not permitted.",
  }));

  return { ok: false, violations, warnings: [] };
}
