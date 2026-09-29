#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../core/config.js";
import {
  changedFilesInRange,
  commitMessagesInRange,
  fileAtRevision,
  isGitRepo,
  resolveDiffContext,
  stagedFileContent,
  stagedFiles,
} from "../core/git.js";
import { emptyReport, formatReport, mergeReports, type CheckReport } from "../core/result.js";
import { checkCommitMessage, checkFile } from "../policies/index.js";
import { runDoctor } from "./doctor.js";
import { runHook } from "./hook.js";
import { runInit } from "./init.js";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  const cwd = process.cwd();

  switch (command) {
    case "init":
      await runInit(cwd);
      return;
    case "doctor":
      await runDoctor(cwd);
      return;
    case "check":
      await cmdCheck(cwd, args);
      return;
    case "check-comments":
      await cmdCheckComments(cwd, args);
      return;
    case "check-message":
      await cmdCheckMessage(cwd, args);
      return;
    case "hook":
      await runHook(cwd, args);
      return;
    default:
      printUsage();
      process.exitCode = command ? 1 : 0;
  }
}

function printUsage(): void {
  console.log(`silent-code - deterministic zero-comments / zero-coauthor / zero-ai-attribution enforcement

Usage:
  silent-code init
  silent-code check [--staged | --working-tree | --range <a>..<b>]
  silent-code check-comments <file>
  silent-code check-message <path-to-message-file>
  silent-code doctor
`);
}

async function cmdCheck(cwd: string, args: string[]): Promise<void> {
  const config = await loadConfig(cwd);
  const mode = args.includes("--staged") ? "staged" : args.includes("--range") ? "range" : "working-tree";

  if (!(await isGitRepo(cwd))) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  const reports: CheckReport[] = [];

  if (mode === "range") {
    const rangeIdx = args.indexOf("--range");
    const range = args[rangeIdx + 1];
    if (!range) {
      console.error("--range requires a value, e.g. --range origin/main...HEAD");
      process.exitCode = 1;
      return;
    }
    const [fromRef, toRef] = splitRange(range);
    const files = await changedFilesInRange(cwd, range);
    for (const file of files) {
      const base = await fileAtRevision(cwd, fromRef, file);
      const current = await fileAtRevision(cwd, toRef, file);
      reports.push(await checkFile(file, base, current, config));
    }
    for (const commit of await commitMessagesInRange(cwd, range)) {
      const messageReport = checkCommitMessage(commit.message, config);
      reports.push({
        ok: messageReport.ok,
        violations: messageReport.violations.map((v) => ({ ...v, file: v.file ?? `commit ${commit.sha.slice(0, 8)}` })),
        warnings: messageReport.warnings,
      });
    }
  } else if (mode === "staged") {
    const files = await stagedFiles(cwd);
    for (const file of files) {
      const base = await fileAtRevision(cwd, "HEAD", file);
      const current = await stagedFileContent(cwd, file);
      reports.push(await checkFile(file, base, current, config));
    }
  } else {
    const files = await stagedFiles(cwd);
    for (const file of files) {
      const current = await readFile(path.join(cwd, file), "utf8").catch(() => "");
      const { base } = await resolveDiffContext(cwd, file, current);
      reports.push(await checkFile(file, base, current, config));
    }
  }

  const merged = mergeReports(reports.length ? reports : [emptyReport()]);
  console.log(formatReport(merged));
  process.exitCode = merged.ok ? 0 : 1;
}

async function cmdCheckComments(cwd: string, args: string[]): Promise<void> {
  const [file] = args;
  if (!file) {
    console.error("Usage: silent-code check-comments <file>");
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(cwd);
  const current = await readFile(path.join(cwd, file), "utf8");
  const { base } = await resolveDiffContext(cwd, file, current);
  const report = await checkFile(file, base, current, config);
  console.log(formatReport(report));
  process.exitCode = report.ok ? 0 : 1;
}

async function cmdCheckMessage(cwd: string, args: string[]): Promise<void> {
  const [messagePath] = args;
  if (!messagePath) {
    console.error("Usage: silent-code check-message <path-to-message-file>");
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(cwd);
  const absolute = path.isAbsolute(messagePath) ? messagePath : path.join(cwd, messagePath);
  const message = await readFile(absolute, "utf8");
  const report = checkCommitMessage(message, config);

  if (report.strippedMessage !== undefined && report.strippedMessage !== message) {
    await writeFile(absolute, report.strippedMessage, "utf8");
  }

  console.log(formatReport(report));
  process.exitCode = report.ok ? 0 : 1;
}

function splitRange(range: string): [string, string] {
  if (range.includes("...")) {
    const [a, b] = range.split("...");
    return [a, b || "HEAD"];
  }
  if (range.includes("..")) {
    const [a, b] = range.split("..");
    return [a, b || "HEAD"];
  }
  return [range, "HEAD"];
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
