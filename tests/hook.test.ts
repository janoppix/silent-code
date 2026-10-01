import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = path.join(process.cwd(), "dist", "cli.mjs");

function runHook(event: string, input: Record<string, unknown>): { code: number; json: any } {
  try {
    const stdout = execFileSync("node", [CLI, "hook", event], {
      input: JSON.stringify(input),
      encoding: "utf8",
    });
    return { code: 0, json: JSON.parse(stdout || "{}") };
  } catch (err: any) {
    return { code: err.status ?? 1, json: JSON.parse(err.stdout || "{}") };
  }
}

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "silent-code-hook-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "a@a.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "a"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("PreToolUse: git commit", () => {
  it("blocks a plain -m with Co-Authored-By", () => {
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: "git commit -m 'fix bug' -m 'Co-Authored-By: Claude <noreply@anthropic.com>'" },
    });
    expect(result.json.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("allows a plain clean -m", () => {
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: "git commit -m 'fix bug'" },
    });
    expect(result.json.hookSpecificOutput).toBeUndefined();
  });

  it("blocks a heredoc-composed message with a Claude Code signature", () => {
    const command = [
      'git commit -m "$(cat <<\'EOF\'',
      "Fix pagination bug",
      "",
      "🤖 Generated with Claude Code",
      "EOF",
      ')"',
    ].join("\n");
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command },
    });
    expect(result.json.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("allows a clean heredoc-composed message", () => {
    const command = ['git commit -m "$(cat <<\'EOF\'', "Fix pagination bug", "EOF", ')"'].join("\n");
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command },
    });
    expect(result.json.hookSpecificOutput).toBeUndefined();
  });

  it("reads message from -F <file>", () => {
    const messagePath = path.join(repo, "msg.txt");
    writeFileSync(messagePath, "Fix bug\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n");
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: "git commit -F msg.txt" },
    });
    expect(result.json.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("does not scan unrelated commands for -m", () => {
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: "curl -m 30 https://example.com" },
    });
    expect(result.json.hookSpecificOutput).toBeUndefined();
  });

  it("blocks -F - fed by a heredoc on stdin", () => {
    const command = ["git commit -F - <<'EOF'", "Fix bug", "", "Co-Authored-By: Claude <noreply@anthropic.com>", "EOF"].join("\n");
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command },
    });
    expect(result.json.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("blocks --message=... equals-sign form", () => {
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: 'git commit --message="Co-Authored-By: Claude <noreply@anthropic.com>"' },
    });
    expect(result.json.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("blocks a bundled -am short flag", () => {
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: "git commit -am '🤖 Generated with Claude Code'" },
    });
    expect(result.json.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("blocks git -C <dir> commit", () => {
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: `git -C ${repo} commit -m 'Co-Authored-By: Claude <noreply@anthropic.com>'` },
    });
    expect(result.json.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("does not false-positive on --amend alone", () => {
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: "git commit --amend --no-edit" },
    });
    expect(result.code).toBe(0);
    expect(result.json.hookSpecificOutput).toBeUndefined();
  });
});

describe("PreToolUse: gh pr create/edit", () => {
  it("blocks a PR body with AI attribution", () => {
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: "gh pr create --title 'Fix bug' --body 'Generated by Claude'" },
    });
    expect(result.json.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("blocks a heredoc PR body with AI attribution", () => {
    const command = [
      "gh pr edit 42 --body \"$(cat <<'EOF'",
      "This fixes the pagination bug.",
      "",
      "https://claude.ai/chat/abc",
      "EOF",
      ')"',
    ].join("\n");
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command },
    });
    expect(result.json.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("allows a clean PR title and body", () => {
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: "gh pr create --title 'Fix pagination bug' --body 'Fixes off-by-one'" },
    });
    expect(result.json.hookSpecificOutput).toBeUndefined();
  });
});

describe("PostToolUse", () => {
  it("blocks a newly added comment", () => {
    const filePath = path.join(repo, "player.js");
    writeFileSync(filePath, "function start() {\n  player.start();\n}\n");
    execFileSync("git", ["add", "player.js"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "add player"], { cwd: repo });
    writeFileSync(filePath, "function start() {\n  // Start player\n  player.start();\n}\n");

    const result = runHook("PostToolUse", {
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      cwd: repo,
      tool_input: { file_path: filePath },
    });
    expect(result.json.decision).toBe("block");
  });

  it("allows a clean file", () => {
    const filePath = path.join(repo, "clean.js");
    writeFileSync(filePath, "function start() {\n  player.start();\n}\n");

    const result = runHook("PostToolUse", {
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      cwd: repo,
      tool_input: { file_path: filePath },
    });
    expect(result.json.decision).toBeUndefined();
  });
});

describe("PostToolUse: Bash file-writing commands", () => {
  it("catches a comment introduced by sed -i", () => {
    const filePath = path.join(repo, "player.js");
    writeFileSync(filePath, "function start() {\n  player.start();\n}\n");
    execFileSync("git", ["add", "player.js"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "add player"], { cwd: repo });
    writeFileSync(filePath, "function start() {\n  // Start player\n  player.start();\n}\n");

    const result = runHook("PostToolUse", {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: `sed -i '1a\\  // Start player' ${filePath}` },
      tool_response: { type: "success" },
    });
    expect(result.json.decision).toBe("block");
    expect(result.json.reason).toContain("zero-comments");
  });

  it("catches an untracked file written via a heredoc redirect", () => {
    const filePath = path.join(repo, "new.js");
    writeFileSync(filePath, "// generated\nfunction f() {}\n");

    const result = runHook("PostToolUse", {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: `cat > ${filePath} <<'EOF'\n// generated\nfunction f() {}\nEOF` },
      tool_response: { type: "success" },
    });
    expect(result.json.decision).toBe("block");
  });

  it("does not scan on a read-only Bash call", () => {
    const filePath = path.join(repo, "player.js");
    writeFileSync(filePath, "// pre-existing dirty comment\nfunction start() {}\n");

    const result = runHook("PostToolUse", {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: "git status" },
      tool_response: { type: "success" },
    });
    expect(result.json.decision).toBeUndefined();
  });

  it("skips the scan when the Bash command failed", () => {
    const filePath = path.join(repo, "new.js");
    writeFileSync(filePath, "// generated\nfunction f() {}\n");

    const result = runHook("PostToolUse", {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: `cat > ${filePath} <<'EOF'\n// generated\nfunction f() {}\nEOF` },
      tool_response: { type: "error" },
    });
    expect(result.json.decision).toBeUndefined();
  });
});

describe("PostToolUse: git commit ground truth", () => {
  it("blocks when the actual last commit message has a violation the PreToolUse parser missed", () => {
    execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "Co-Authored-By: Claude <noreply@anthropic.com>"], {
      cwd: repo,
    });

    const result = runHook("PostToolUse", {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: "git commit -F - <<'EOF'\nignored\nEOF" },
      tool_response: { type: "success" },
    });
    expect(result.json.decision).toBe("block");
    expect(result.json.reason).toContain("git commit --amend");
  });

  it("does not check the ground truth when the commit command failed", () => {
    execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "Co-Authored-By: Claude <noreply@anthropic.com>"], {
      cwd: repo,
    });

    const result = runHook("PostToolUse", {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: "git commit -m 'this attempt failed'" },
      tool_response: { type: "error" },
    });
    expect(result.json.decision).toBeUndefined();
  });
});

describe("PreToolUse: raw command text scan (printf-before-file-read bypass)", () => {
  it("blocks a trailer assembled with printf before -F reads the file", () => {
    const command = [
      "printf 'Fix bug\\n\\nCo-Authored-By: Claude <noreply@anthropic.com>\\n' >> msg.txt",
      "git commit --amend -F msg.txt",
    ].join(" && ");
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command },
    });
    expect(result.json.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("allows a clean printf-composed message", () => {
    const command = ["printf 'Fix bug\\n' >> msg.txt", "git commit --amend -F msg.txt"].join(" && ");
    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command },
    });
    expect(result.json.hookSpecificOutput).toBeUndefined();
  });
});

describe("PreToolUse: git push", () => {
  it("blocks pushing an unpushed commit with a Co-Authored-By trailer", () => {
    execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "Co-Authored-By: Claude <noreply@anthropic.com>"], {
      cwd: repo,
    });

    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: "git push origin main" },
    });
    expect(result.json.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("allows pushing when no unpushed commit has a violation", () => {
    execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "Fix pagination bug"], { cwd: repo });

    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: "git push origin main" },
    });
    expect(result.json.hookSpecificOutput).toBeUndefined();
  });

  it("blocks a bare git push with no explicit remote/branch using the --not --remotes fallback", () => {
    execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "🤖 Generated with Claude Code"], { cwd: repo });

    const result = runHook("PreToolUse", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repo,
      tool_input: { command: "git push" },
    });
    expect(result.json.hookSpecificOutput?.permissionDecision).toBe("deny");
  });
});
