import { loadConfig } from "../core/config.js";
import { lastCommitMessage, repoRoot, resolveDiffContext, workingTreeChangedFiles } from "../core/git.js";
import { emptyReport, formatReport, mergeReports, type CheckReport, type Violation } from "../core/result.js";
import { checkCommitMessage, checkFile } from "../policies/index.js";

interface ClaudeHookInput {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: { type?: string };
  cwd?: string;
}

const COMMIT_COMMAND_RE = /\bgit\b[^&|;\n]*\bcommit\b/;
const PR_COMMAND_RE = /\bgh\b[^&|;\n]*\bpr\b[^&|;\n]*\b(create|edit)\b/;

const GENERIC_HEREDOC_RE = /<<[-~]?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2\b/g;

const FLAG_QUOTED_RE =
  /(?<=^|\s)(?:-[a-zA-Z]*m|--message|--title|--body)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;

const FLAG_FILE_PATH_RE = /(?:-F|--file|--body-file)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/g;

const FILE_WRITING_BASH_RE =
  /(>>?[^&|]|\btee\b|\bsed\s+-[a-zA-Z]*i|\bperl\s+-[a-zA-Z]*i|\bpatch\b|\bgit\s+apply\b|\bcp\s|\bmv\s|\brsync\b)/;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function unescapeShellQuoted(text: string): string {
  return text.replace(/\\(["'\\])/g, "$1");
}

async function extractTextsFromCommand(command: string, cwd: string): Promise<string[]> {
  const texts: string[] = [];
  const seenSpans: [number, number][] = [];

  const heredocRe = new RegExp(GENERIC_HEREDOC_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = heredocRe.exec(command))) {
    texts.push(match[3]);
    seenSpans.push([match.index, match.index + match[0].length]);
  }

  const quotedRe = new RegExp(FLAG_QUOTED_RE.source, "g");
  while ((match = quotedRe.exec(command))) {
    const withinHeredoc = seenSpans.some(([start, end]) => match!.index >= start && match!.index < end);
    if (withinHeredoc) continue;
    texts.push(unescapeShellQuoted(match[1] ?? match[2] ?? ""));
  }

  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const filePathRe = new RegExp(FLAG_FILE_PATH_RE.source, "g");
  while ((match = filePathRe.exec(command))) {
    const filePath = match[1] ?? match[2] ?? match[3] ?? "";
    if (!filePath || filePath === "-") continue;
    const absolute = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
    try {
      texts.push(await readFile(absolute, "utf8"));
    } catch {
      continue;
    }
  }

  return texts;
}

async function checkWrittenFile(cwd: string, filePath: string): Promise<CheckReport> {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const relative = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath;
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);

  let current: string;
  try {
    current = await readFile(absolute, "utf8");
  } catch {
    return emptyReport();
  }

  const config = await loadConfig(cwd);
  const { base } = await resolveDiffContext(cwd, relative, current);
  return checkFile(relative, base, current, config);
}

async function checkBashWrittenFiles(cwd: string, command: string): Promise<CheckReport> {
  if (!FILE_WRITING_BASH_RE.test(command)) return emptyReport();

  const root = (await repoRoot(cwd)) ?? cwd;
  const files = await workingTreeChangedFiles(root);
  if (files.length === 0) return emptyReport();

  const config = await loadConfig(root);
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const reports: CheckReport[] = [];
  for (const file of files) {
    const current = await readFile(path.join(root, file), "utf8").catch(() => null);
    if (current === null) continue;
    const { base } = await resolveDiffContext(root, file, current);
    reports.push(await checkFile(file, base, current, config));
  }
  return mergeReports(reports);
}

function withAmendGuidance(report: CheckReport): CheckReport {
  const amend = (v: Violation): Violation => ({
    ...v,
    action: `${v.action} This commit was already created; fix the message and run: git commit --amend`,
  });
  return { ...report, violations: report.violations.map(amend) };
}

async function checkLastCommitGroundTruth(cwd: string, bashSucceeded: boolean): Promise<CheckReport> {
  if (!bashSucceeded) return emptyReport();
  const root = (await repoRoot(cwd)) ?? cwd;
  const message = await lastCommitMessage(root);
  if (message === null) return emptyReport();
  const config = await loadConfig(root);
  return withAmendGuidance(checkCommitMessage(message, config));
}

async function handlePostToolUse(input: ClaudeHookInput): Promise<CheckReport> {
  const cwd = input.cwd ?? process.cwd();
  const toolName = input.tool_name ?? "";
  const toolInput = input.tool_input ?? {};

  if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(toolName)) {
    const filePath = (toolInput.file_path as string | undefined) ?? "";
    if (!filePath) return emptyReport();
    return checkWrittenFile(cwd, filePath);
  }

  if (toolName === "Bash") {
    const command = (toolInput.command as string | undefined) ?? "";
    const bashSucceeded = input.tool_response?.type !== "error";
    const reports: CheckReport[] = [];
    if (COMMIT_COMMAND_RE.test(command)) {
      reports.push(await checkLastCommitGroundTruth(cwd, bashSucceeded));
    }
    if (bashSucceeded) {
      reports.push(await checkBashWrittenFiles(cwd, command));
    }
    return mergeReports(reports);
  }

  return emptyReport();
}

async function handlePreToolUse(input: ClaudeHookInput): Promise<CheckReport> {
  const cwd = input.cwd ?? process.cwd();
  if (input.tool_name !== "Bash") return emptyReport();
  const command = (input.tool_input?.command as string | undefined) ?? "";

  const isCommit = COMMIT_COMMAND_RE.test(command);
  const isPr = PR_COMMAND_RE.test(command);
  if (!isCommit && !isPr) return emptyReport();

  const texts = await extractTextsFromCommand(command, cwd);
  if (texts.length === 0) return emptyReport();

  const config = await loadConfig(cwd);
  const reports = texts.map((text) => checkCommitMessage(text, config));
  return mergeReports(reports);
}

function normalizeEventName(raw: string): "PreToolUse" | "PostToolUse" {
  return raw.toLowerCase().includes("pre") ? "PreToolUse" : "PostToolUse";
}

export async function runHook(cwd: string, args: string[]): Promise<void> {
  const raw = await readStdin();
  let input: ClaudeHookInput = {};
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    input = {};
  }
  input.cwd = input.cwd ?? cwd;

  const event = normalizeEventName(args[0] ?? input.hook_event_name ?? "");
  const report = event === "PreToolUse" ? await handlePreToolUse(input) : await handlePostToolUse(input);

  if (report.ok) {
    process.stdout.write("{}");
    process.exit(0);
  }

  const reason = formatReport(report);
  const output =
    event === "PreToolUse"
      ? {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason,
          },
        }
      : { decision: "block", reason };

  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}
