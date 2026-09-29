import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "../core/git.js";
import { installGitHooks } from "../integrations/git-hooks.js";

function templatesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, "..", "..", "templates"), path.join(here, "..", "templates")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("Could not locate templates/ directory");
}

async function appendPolicySection(filePath: string, section: string): Promise<string> {
  if (!existsSync(filePath)) {
    await writeFile(filePath, `${section}\n`, "utf8");
    return `created ${path.basename(filePath)}`;
  }
  const content = await readFile(filePath, "utf8");
  if (content.includes("## Silent Code Repository Policies")) {
    return `${path.basename(filePath)} already has the silent-code section`;
  }
  await writeFile(filePath, `${content.trimEnd()}\n\n${section}\n`, "utf8");
  return `appended silent-code section to ${path.basename(filePath)}`;
}

export async function runInit(cwd: string): Promise<void> {
  const root = (await repoRoot(cwd)) ?? cwd;
  const messages: string[] = [];

  const configPath = path.join(root, ".silent-code.yml");
  if (existsSync(configPath)) {
    messages.push(".silent-code.yml already exists, left untouched");
  } else {
    await copyFile(path.join(templatesDir(), ".silent-code.yml"), configPath);
    messages.push("created .silent-code.yml");
  }

  const claudeSection = await readFile(path.join(templatesDir(), "CLAUDE.md"), "utf8");
  messages.push(await appendPolicySection(path.join(root, "CLAUDE.md"), claudeSection.trim()));

  const agentsSection = await readFile(path.join(templatesDir(), "AGENTS.md"), "utf8");
  messages.push(await appendPolicySection(path.join(root, "AGENTS.md"), agentsSection.trim()));

  const hookMessages = await installGitHooks(root);
  messages.push(...hookMessages);

  const workflowsDir = path.join(root, ".github", "workflows");
  const workflowPath = path.join(workflowsDir, "silent-code.yml");
  if (existsSync(workflowPath)) {
    messages.push(".github/workflows/silent-code.yml already exists, left untouched");
  } else if (existsSync(path.join(root, ".github"))) {
    await copyFile(path.join(templatesDir(), "github-actions.yml"), workflowPath);
    messages.push("created .github/workflows/silent-code.yml");
  } else {
    messages.push("skipped GitHub Actions workflow (.github/ not found; copy templates/github-actions.yml manually if needed)");
  }

  console.log("silent-code init\n");
  for (const message of messages) {
    console.log(`- ${message}`);
  }
}
