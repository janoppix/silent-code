import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { checkZeroComments } from "../src/policies/zero-comments.js";

const config = DEFAULT_CONFIG.policies["zero-comments"];

describe("zero-comments: JavaScript", () => {
  it("fails on a newly added comment", async () => {
    const base = "fetchUser();\n";
    const current = "// fetch user\nfetchUser();\n";
    const report = await checkZeroComments("src/app.js", base, current, config);
    expect(report.ok).toBe(false);
    expect(report.violations[0].line).toBe(1);
  });

  it("passes a string that looks like a comment", async () => {
    const base = "";
    const current = 'const url = "https://example.com";\n';
    const report = await checkZeroComments("src/app.js", base, current, config);
    expect(report.ok).toBe(true);
  });

  it("passes a string containing //", async () => {
    const base = "";
    const current = 'const text = "// this is text";\n';
    const report = await checkZeroComments("src/app.js", base, current, config);
    expect(report.ok).toBe(true);
  });

  it("passes a regex literal containing //", async () => {
    const base = "";
    const current = "const regex = /\\/\\/foo/;\n";
    const report = await checkZeroComments("src/app.js", base, current, config);
    expect(report.ok).toBe(true);
  });

  it("passes a pre-existing comment untouched by the diff", async () => {
    const base = "// old legacy comment\nfunction start() {\n  player.start();\n}\n";
    const current = "// old legacy comment\nfunction start() {\n  player.start();\n}\n";
    const report = await checkZeroComments("src/player.js", base, current, config);
    expect(report.ok).toBe(true);
  });

  it("fails only the newly introduced comment next to an old one", async () => {
    const base = "// old legacy comment\nfunction start() {\n  player.start();\n}\n";
    const current = "// old legacy comment\nfunction start() {\n  // Start player\n  player.start();\n}\n";
    const report = await checkZeroComments("src/player.js", base, current, config);
    expect(report.ok).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].snippet).toBe("// Start player");
  });

  it("passes a template literal containing //", async () => {
    const base = "";
    const current = "const msg = `see // docs`;\n";
    const report = await checkZeroComments("src/app.js", base, current, config);
    expect(report.ok).toBe(true);
  });

  it("allows a shebang on line 1", async () => {
    const base = "";
    const current = "#!/usr/bin/env node\nconsole.log(1);\n";
    const report = await checkZeroComments("bin/cli.js", base, current, config);
    expect(report.ok).toBe(true);
  });
});

describe("zero-comments: Python", () => {
  it("fails on a new comment", async () => {
    const base = "response = parse(data)\n";
    const current = "# parse response\nresponse = parse(data)\n";
    const report = await checkZeroComments("app.py", base, current, config);
    expect(report.ok).toBe(false);
  });

  it("passes a pre-existing comment", async () => {
    const base = "# old comment\nvalue = 123\n";
    const current = "# old comment\nvalue = 123\n";
    const report = await checkZeroComments("app.py", base, current, config);
    expect(report.ok).toBe(true);
  });

  it("fails a newly added comment alongside an old one", async () => {
    const base = "# old comment\nvalue = 123\n";
    const current = "# old comment\n# new comment\nvalue = 123\n";
    const report = await checkZeroComments("app.py", base, current, config);
    expect(report.ok).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].snippet).toBe("# new comment");
  });

  it("passes a string literal containing #", async () => {
    const base = "";
    const current = 'text = "# not a comment"\n';
    const report = await checkZeroComments("app.py", base, current, config);
    expect(report.ok).toBe(true);
  });

  it("respects noqa allowlist only when enabled", async () => {
    const base = "";
    const current = "import os  # noqa\n";
    const report = await checkZeroComments("app.py", base, current, config);
    expect(report.ok).toBe(false); // noqa disabled by default

    const withNoqa = { ...config, allow: { ...config.allow, noqa: true } };
    const report2 = await checkZeroComments("app.py", base, current, withNoqa);
    expect(report2.ok).toBe(true);
  });
});

describe("zero-comments: Go", () => {
  it("fails on a new comment", async () => {
    const base = "func main() {}\n";
    const current = "// entrypoint\nfunc main() {}\n";
    const report = await checkZeroComments("main.go", base, current, config);
    expect(report.ok).toBe(false);
  });

  it("allows go:generate directives", async () => {
    const base = "";
    const current = "//go:generate stringer -type=Pill\nfunc main() {}\n";
    const report = await checkZeroComments("main.go", base, current, config);
    expect(report.ok).toBe(true);
  });
});

describe("zero-comments: TypeScript", () => {
  it("passes strings and template literals, fails a real comment", async () => {
    const base = "";
    const current = [
      'const a: string = "// not a comment";',
      "const b = `template // also not a comment`;",
      "// but this is",
      "export const x = 1;",
    ].join("\n");
    const report = await checkZeroComments("src/index.ts", base, current, config);
    expect(report.ok).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].snippet).toBe("// but this is");
  });

  it("respects ts-ignore allowlist only when enabled", async () => {
    const base = "";
    const current = "// @ts-ignore\nconst x: number = \"1\";\n";
    const disallowed = await checkZeroComments("src/index.ts", base, current, config);
    expect(disallowed.ok).toBe(false);

    const allowed = { ...config, allow: { ...config.allow, "ts-ignore": true } };
    const report = await checkZeroComments("src/index.ts", base, current, allowed);
    expect(report.ok).toBe(true);
  });
});

describe("zero-comments: ignoring generated / vendored files handled upstream", () => {
  it("still flags comments when the language has no registered parser", async () => {
    const base = "";
    const current = "; a lone comment\n(display \"hi\")\n";
    const report = await checkZeroComments("script.scm", base, current, config);
    expect(report.ok).toBe(true);
    expect(report.warnings).toHaveLength(1);
  });
});
