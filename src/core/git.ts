import { spawn } from "node:child_process";

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function git(args: string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const res = await git(["rev-parse", "--is-inside-work-tree"], cwd);
  return res.code === 0 && res.stdout.trim() === "true";
}

export async function repoRoot(cwd: string): Promise<string | null> {
  const res = await git(["rev-parse", "--show-toplevel"], cwd);
  if (res.code !== 0) return null;
  return res.stdout.trim();
}

export async function showFileAtRef(cwd: string, ref: string, file: string): Promise<string> {
  const spec = ref === ":0" ? `:${file}` : `${ref}:${file}`;
  const res = await git(["show", spec], cwd);
  if (res.code !== 0) return "";
  return res.stdout;
}

export async function isFileTracked(cwd: string, file: string): Promise<boolean> {
  const res = await git(["ls-files", "--error-unmatch", file], cwd);
  return res.code === 0;
}

export async function isFileStaged(cwd: string, file: string): Promise<boolean> {
  const res = await git(["diff", "--cached", "--name-only", "--", file], cwd);
  return res.code === 0 && res.stdout.trim().length > 0;
}

export interface DiffContext {
  base: string;
  current: string;
}

export async function resolveDiffContext(
  cwd: string,
  file: string,
  current: string,
): Promise<DiffContext> {
  const tracked = await isFileTracked(cwd, file);
  if (!tracked) {
    return { base: "", current };
  }
  const staged = await isFileStaged(cwd, file);
  const base = staged ? await showFileAtRef(cwd, ":0", file) : await showFileAtRef(cwd, "HEAD", file);
  return { base, current };
}

export async function stagedFileContent(cwd: string, file: string): Promise<string> {
  return showFileAtRef(cwd, ":0", file);
}

export async function stagedFiles(cwd: string): Promise<string[]> {
  const res = await git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"], cwd);
  if (res.code !== 0) return [];
  return res.stdout.split("\n").filter(Boolean);
}

export async function workingTreeChangedFiles(cwd: string): Promise<string[]> {
  const res = await git(["status", "--porcelain", "--untracked-files=all"], cwd);
  if (res.code !== 0) return [];
  const files: string[] = [];
  for (const line of res.stdout.split("\n")) {
    if (!line) continue;
    const status = line.slice(0, 2);
    let rest = line.slice(3);
    if (status.includes("D")) continue;
    if (rest.includes(" -> ")) {
      rest = rest.split(" -> ")[1];
    }
    files.push(unquoteGitPath(rest));
  }
  return files;
}

function unquoteGitPath(path: string): string {
  if (path.startsWith('"') && path.endsWith('"')) {
    return path.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return path;
}

export async function changedFilesInRange(cwd: string, range: string): Promise<string[]> {
  const res = await git(["diff", "--name-only", "--diff-filter=ACMR", range], cwd);
  if (res.code !== 0) return [];
  return res.stdout.split("\n").filter(Boolean);
}

export async function fileAtRevision(cwd: string, revision: string, file: string): Promise<string> {
  return showFileAtRef(cwd, revision, file);
}

export async function lastCommitMessage(cwd: string): Promise<string | null> {
  const res = await git(["log", "-1", "--format=%B"], cwd);
  if (res.code !== 0) return null;
  return res.stdout;
}

export async function commitMessagesInRange(cwd: string, range: string): Promise<{ sha: string; message: string }[]> {
  const res = await git(["log", "--format=%H%x01%B%x02", range], cwd);
  if (res.code !== 0) return [];
  return res.stdout
    .split("\x02")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [sha, ...rest] = chunk.split("\x01");
      return { sha, message: rest.join("\x01").trim() };
    });
}
