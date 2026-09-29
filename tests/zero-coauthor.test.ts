import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { checkZeroCoauthor } from "../src/policies/zero-coauthor.js";

const config = DEFAULT_CONFIG.policies["zero-coauthor"];

describe("zero-coauthor", () => {
  it("passes a plain commit message", () => {
    const report = checkZeroCoauthor("Fix off-by-one error in pagination\n", config);
    expect(report.ok).toBe(true);
  });

  it("fails on a Co-Authored-By trailer", () => {
    const report = checkZeroCoauthor(
      "Fix bug\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n",
      config,
    );
    expect(report.ok).toBe(false);
    expect(report.violations).toHaveLength(1);
  });

  it("is case-insensitive", () => {
    const report = checkZeroCoauthor("Fix bug\n\nco-authored-by: ChatGPT\n", config);
    expect(report.ok).toBe(false);
  });

  it("strips instead of blocking in strip mode", () => {
    const stripConfig = { ...config, mode: "strip" as const };
    const report = checkZeroCoauthor(
      "Fix bug\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n",
      stripConfig,
    );
    expect(report.ok).toBe(true);
    expect(report.strippedMessage).not.toContain("Co-Authored-By");
    expect(report.strippedMessage).toContain("Fix bug");
  });

  it("does not false-positive on unrelated trailers", () => {
    const report = checkZeroCoauthor("Fix bug\n\nReviewed-by: Alice\n", config);
    expect(report.ok).toBe(true);
  });
});
