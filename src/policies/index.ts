import type { SilentCodeConfig } from "../core/config.js";
import { isGeneratedFile, isIgnored } from "../core/ignore.js";
import { emptyReport, mergeReports, type CheckReport } from "../core/result.js";
import { checkZeroAiAttribution } from "./zero-ai-attribution.js";
import { checkZeroCoauthor } from "./zero-coauthor.js";
import { checkZeroComments } from "./zero-comments.js";

export { checkZeroComments } from "./zero-comments.js";
export { checkZeroCoauthor, type CoauthorCheckResult } from "./zero-coauthor.js";
export { checkZeroAiAttribution } from "./zero-ai-attribution.js";

export async function checkFile(
  file: string,
  base: string,
  current: string,
  config: SilentCodeConfig,
): Promise<CheckReport> {
  if (isIgnored(file, config.ignore) || isGeneratedFile(current)) {
    return emptyReport();
  }

  const reports: CheckReport[] = [];

  if (config.policies["zero-comments"].enabled) {
    reports.push(await checkZeroComments(file, base, current, config.policies["zero-comments"]));
  }

  if (config.policies["zero-ai-attribution"].enabled) {
    const attribution = checkZeroAiAttribution(current, config.policies["zero-ai-attribution"]);
    reports.push(withFile(attribution, file));
  }

  return mergeReports(reports);
}

export function checkCommitMessage(message: string, config: SilentCodeConfig): CheckReport & { strippedMessage?: string } {
  const reports: CheckReport[] = [];
  let strippedMessage: string | undefined;

  if (config.policies["zero-coauthor"].enabled) {
    const result = checkZeroCoauthor(message, config.policies["zero-coauthor"]);
    reports.push(result);
    strippedMessage = result.strippedMessage;
  }

  if (config.policies["zero-ai-attribution"].enabled) {
    reports.push(checkZeroAiAttribution(strippedMessage ?? message, config.policies["zero-ai-attribution"]));
  }

  return { ...mergeReports(reports), strippedMessage };
}

function withFile(report: CheckReport, file: string): CheckReport {
  return {
    ...report,
    violations: report.violations.map((v) => ({ ...v, file })),
  };
}
