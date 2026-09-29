import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../core/config.js";
import { isGitRepo, repoRoot } from "../core/git.js";
import { resolveGrammarsDir } from "../parsers/treesitter.js";
import { MARKER_START } from "./hooks-common.js";

interface CheckLine {
  label: string;
  status: "OK" | "MISSING" | "WARN";
  detail?: string;
}

export async function runDoctor(cwd: string): Promise<void> {
  const lines: CheckLine[] = [];

  lines.push(await checkClaudePlugin());

  const gitRepo = await isGitRepo(cwd);
  lines.push({ label: "Git repository", status: gitRepo ? "OK" : "MISSING" });

  const root = gitRepo ? await repoRoot(cwd) : null;
  if (root) {
    lines.push(await checkHook(root, "pre-commit"));
    lines.push(await checkHook(root, "commit-msg"));
    lines.push(await checkHook(root, "pre-push"));
  }

  lines.push(await checkTreeSitter());

  console.log("Silent Code\n");
  for (const line of lines) {
    console.log(formatLine(line));
  }

  console.log("\nPolicies\n");
  const config = await loadConfig(cwd);
  for (const [name, policy] of Object.entries(config.policies)) {
    console.log(`${name.padEnd(20)} ${policy.enabled ? "enabled" : "disabled"}`);
  }
}

function formatLine(line: CheckLine): string {
  const status = line.status.padEnd(8);
  const text = `${line.label.padEnd(20)} ${status}`;
  return line.detail ? `${text} (${line.detail})` : text;
}

async function checkClaudePlugin(): Promise<CheckLine> {
  const installedPath = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
  try {
    const raw = await readFile(installedPath, "utf8");
    const installed = JSON.parse(raw) as Record<string, unknown>;
    const found = JSON.stringify(installed).includes("silent-code");
    return found
      ? { label: "Claude plugin", status: "OK" }
      : { label: "Claude plugin", status: "MISSING", detail: "run /plugin install silent-code@silent-code" };
  } catch {
    return { label: "Claude plugin", status: "WARN", detail: "could not read installed_plugins.json" };
  }
}

async function checkHook(root: string, name: string): Promise<CheckLine> {
  const hookPath = path.join(root, ".git", "hooks", name);
  if (!existsSync(hookPath)) {
    return { label: `${name} hook`, status: "MISSING", detail: "run silent-code init" };
  }
  const content = await readFile(hookPath, "utf8").catch(() => "");
  return content.includes(MARKER_START)
    ? { label: `${name} hook`, status: "OK" }
    : { label: `${name} hook`, status: "WARN", detail: "hook exists but not managed by silent-code" };
}

async function checkTreeSitter(): Promise<CheckLine> {
  try {
    resolveGrammarsDir();
    return { label: "Tree-sitter", status: "OK" };
  } catch (err) {
    return { label: "Tree-sitter", status: "MISSING", detail: (err as Error).message };
  }
}
