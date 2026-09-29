export type PolicyName = "zero-comments" | "zero-coauthor" | "zero-ai-attribution";

export interface Violation {
  policy: PolicyName;
  file?: string;
  line?: number;
  snippet: string;
  detail: string;
  action: string;
}

export interface CheckReport {
  ok: boolean;
  violations: Violation[];
  warnings: string[];
}

export function mergeReports(reports: CheckReport[]): CheckReport {
  const violations = reports.flatMap((r) => r.violations);
  const warnings = reports.flatMap((r) => r.warnings);
  return { ok: violations.length === 0, violations, warnings };
}

export function emptyReport(): CheckReport {
  return { ok: true, violations: [], warnings: [] };
}

export function formatViolation(v: Violation): string {
  const lines = [`POLICY_VIOLATION: ${v.policy}`, ""];
  if (v.file) {
    lines.push("File:", v.file, "");
  }
  if (v.line !== undefined) {
    lines.push("Line:", String(v.line), "");
  }
  lines.push(v.detail, "", v.snippet, "", "Required action:", "", v.action);
  return lines.join("\n");
}

export function formatReport(report: CheckReport): string {
  if (report.ok) {
    return report.warnings.length
      ? report.warnings.map((w) => `WARNING: ${w}`).join("\n")
      : "OK: no policy violations";
  }
  const blocks = report.violations.map(formatViolation);
  const warnings = report.warnings.map((w) => `WARNING: ${w}`);
  return [...blocks, ...warnings].join("\n\n---\n\n");
}
