import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = path.join(process.cwd(), "dist", "cli.mjs");

function runCheck(cwd: string, args: string[] = []): { code: number; stdout: string } {
  try {
    const stdout = execFileSync("node", [CLI, "check", ...args], { cwd, encoding: "utf8" });
    return { code: 0, stdout };
  } catch (err: any) {
    return { code: err.status ?? 1, stdout: err.stdout ?? "" };
  }
}

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "silent-code-cli-check-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "a@a.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "a"], { cwd: repo });
  writeFileSync(path.join(repo, "player.js"), "function start() {\n  player.start();\n}\n");
  execFileSync("git", ["add", "player.js"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "add player"], { cwd: repo });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("silent-code check (default working-tree mode)", () => {
  it("flags an unstaged modification to a tracked file", () => {
    writeFileSync(path.join(repo, "player.js"), "function start() {\n  // Start player\n  player.start();\n}\n");
    const result = runCheck(repo);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("zero-comments");
  });

  it("flags a brand-new untracked file", () => {
    writeFileSync(path.join(repo, "new.js"), "// generated\nfunction f() {}\n");
    const result = runCheck(repo);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("zero-comments");
  });

  it("passes when the working tree is clean", () => {
    const result = runCheck(repo);
    expect(result.code).toBe(0);
  });

  it("--staged still only looks at the index", () => {
    writeFileSync(path.join(repo, "player.js"), "function start() {\n  // Start player\n  player.start();\n}\n");
    const result = runCheck(repo, ["--staged"]);
    expect(result.code).toBe(0);
  });
});
