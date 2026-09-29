import { loadConfig } from "../core/config.js";
import { resolveDiffContext } from "../core/git.js";
import { emptyReport, formatReport, mergeReports, type CheckReport } from "../core/result.js";
import { checkCommitMessage, checkFile } from "../policies/index.js";

interface ClaudeHookInput {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handlePostToolUse(input: ClaudeHookInput): Promise<CheckReport> {
  const cwd = input.cwd ?? process.cwd();
  const toolName = input.tool_name ?? "";
  if (!["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(toolName)) return emptyReport();

  const toolInput = input.tool_input ?? {};
  const filePath = (toolInput.file_path as string | undefined) ?? "";
  if (!filePath) return emptyReport();

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

const COMMIT_COMMAND_RE = /\bgit\s+commit\b/;
const PR_COMMAND_RE = /\bgh\s+pr\s+(create|edit)\b/;

const FLAG_HEREDOC_RE =
  /(-m|-F|--title|--body|--body-file)\s+"?\$\(\s*cat\s+<<[-~]?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\s*\2\s*\)"?/g;

const FLAG_QUOTED_RE = /(-m|--title|--body)\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;

const FLAG_FILE_PATH_RE = /(-F|--body-file)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/g;

function unescapeShellQuoted(text: string): string {
  return text.replace(/\\(["'\\])/g, "$1");
}

async function extractTextsFromCommand(command: string, cwd: string): Promise<string[]> {
  const texts: string[] = [];
  const seenSpans = new Set<string>();

  const heredocRe = new RegExp(FLAG_HEREDOC_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = heredocRe.exec(command))) {
    texts.push(match[3]);
    seenSpans.add(`${match.index}:${match.index + match[0].length}`);
  }

  const quotedRe = new RegExp(FLAG_QUOTED_RE.source, "g");
  while ((match = quotedRe.exec(command))) {
    const withinHeredoc = [...seenSpans].some((span) => {
      const [start, end] = span.split(":").map(Number);
      return match!.index >= start && match!.index < end;
    });
    if (withinHeredoc) continue;
    texts.push(unescapeShellQuoted(match[2] ?? match[3] ?? ""));
  }

  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const filePathRe = new RegExp(FLAG_FILE_PATH_RE.source, "g");
  while ((match = filePathRe.exec(command))) {
    const filePath = match[2] ?? match[3] ?? match[4] ?? "";
    if (!filePath) continue;
    const absolute = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
    try {
      texts.push(await readFile(absolute, "utf8"));
    } catch {
      continue;
    }
  }

  return texts;
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
