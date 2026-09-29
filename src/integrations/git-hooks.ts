import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { git } from "../core/git.js";
import { hasMarkedBlock, withMarkers } from "../cli/hooks-common.js";

export type HookName = "pre-commit" | "commit-msg" | "pre-push";
export type HookManager = "husky" | "lefthook" | "pre-commit" | "simple-git-hooks" | "none";

export interface HookManagerDetection {
  manager: HookManager;
  detail: string;
}

function templatesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "..", "templates"),
    path.join(here, "..", "templates"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("Could not locate templates/ directory");
}

export async function detectHookManager(root: string): Promise<HookManagerDetection> {
  if (existsSync(path.join(root, ".husky"))) {
    return { manager: "husky", detail: ".husky/ directory found" };
  }
  if (existsSync(path.join(root, "lefthook.yml")) || existsSync(path.join(root, "lefthook.yaml"))) {
    return { manager: "lefthook", detail: "lefthook.yml found" };
  }
  if (existsSync(path.join(root, ".pre-commit-config.yaml"))) {
    return { manager: "pre-commit", detail: ".pre-commit-config.yaml found (python pre-commit)" };
  }
  const pkgPath = path.join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
      if (pkg["simple-git-hooks"]) {
        return { manager: "simple-git-hooks", detail: "simple-git-hooks field in package.json" };
      }
    } catch {
    }
  }
  const hooksPath = await git(["config", "core.hooksPath"], root);
  if (hooksPath.code === 0 && hooksPath.stdout.trim() && hooksPath.stdout.trim() !== ".git/hooks") {
    return { manager: "none", detail: `core.hooksPath is set to ${hooksPath.stdout.trim()}, hooks will be written there` };
  }
  return { manager: "none", detail: "no hook manager detected, writing directly to .git/hooks" };
}

async function resolveHooksDir(root: string): Promise<string> {
  const hooksPath = await git(["config", "core.hooksPath"], root);
  if (hooksPath.code === 0 && hooksPath.stdout.trim()) {
    return path.isAbsolute(hooksPath.stdout.trim()) ? hooksPath.stdout.trim() : path.join(root, hooksPath.stdout.trim());
  }
  return path.join(root, ".git", "hooks");
}

async function readTemplate(name: HookName): Promise<string> {
  return readFile(path.join(templatesDir(), name), "utf8");
}

async function installDirectHook(root: string, name: HookName): Promise<string> {
  const hooksDir = await resolveHooksDir(root);
  await mkdir(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, name);
  const body = withMarkers(await readTemplate(name));

  let existing = "";
  if (existsSync(hookPath)) {
    existing = await readFile(hookPath, "utf8");
    if (hasMarkedBlock(existing)) {
      return `${name}: already installed at ${hookPath}`;
    }
  }

  const shebang = "#!/usr/bin/env bash\n";
  const content = existing
    ? `${existing.trimEnd()}\n\n${body}\n`
    : `${shebang}\n${body}\n`;

  await writeFile(hookPath, content, "utf8");
  await chmod(hookPath, 0o755);
  return existing
    ? `${name}: appended to existing hook at ${hookPath}`
    : `${name}: installed at ${hookPath}`;
}

async function installHuskyHook(root: string, name: HookName): Promise<string> {
  const huskyDir = path.join(root, ".husky");
  const hookPath = path.join(huskyDir, name);
  const body = withMarkers(await readTemplate(name));

  let existing = "";
  if (existsSync(hookPath)) {
    existing = await readFile(hookPath, "utf8");
    if (hasMarkedBlock(existing)) {
      return `${name}: already installed in .husky/${name}`;
    }
  }

  const content = existing ? `${existing.trimEnd()}\n\n${body}\n` : `${body}\n`;
  await writeFile(hookPath, content, "utf8");
  await chmod(hookPath, 0o755);
  return existing
    ? `${name}: appended to existing .husky/${name}`
    : `${name}: installed at .husky/${name}`;
}

async function installLefthookHook(root: string): Promise<string> {
  const lefthookPath = existsSync(path.join(root, "lefthook.yml"))
    ? path.join(root, "lefthook.yml")
    : path.join(root, "lefthook.yaml");
  const raw = await readFile(lefthookPath, "utf8");
  const doc = (parseYaml(raw) ?? {}) as Record<string, any>;

  const additions: Record<string, { commands: Record<string, { run: string }> }> = {
    "pre-commit": { commands: { "silent-code": { run: "silent-code check --staged" } } },
    "commit-msg": { commands: { "silent-code": { run: "silent-code check-message {1}" } } },
    "pre-push": { commands: { "silent-code": { run: "silent-code check --range $(git rev-parse --abbrev-ref --symbolic-full-name @{u})..HEAD" } } },
  };

  let changed = false;
  for (const [hook, addition] of Object.entries(additions)) {
    doc[hook] = doc[hook] ?? {};
    doc[hook].commands = doc[hook].commands ?? {};
    if (!doc[hook].commands["silent-code"]) {
      doc[hook].commands["silent-code"] = addition.commands["silent-code"];
      changed = true;
    }
  }

  if (changed) {
    await writeFile(lefthookPath, stringifyYaml(doc), "utf8");
  }
  return changed
    ? `lefthook: added silent-code commands to ${path.basename(lefthookPath)}`
    : "lefthook: silent-code commands already present";
}

async function installPreCommitFrameworkHook(root: string): Promise<string> {
  const configPath = path.join(root, ".pre-commit-config.yaml");
  const raw = await readFile(configPath, "utf8");
  const doc = (parseYaml(raw) ?? { repos: [] }) as Record<string, any>;
  doc.repos = doc.repos ?? [];

  const alreadyPresent = doc.repos.some((repo: any) =>
    (repo.hooks ?? []).some((hook: any) => hook.id === "silent-code"),
  );

  if (!alreadyPresent) {
    doc.repos.push({
      repo: "local",
      hooks: [
        {
          id: "silent-code",
          name: "silent-code",
          entry: "silent-code check --staged",
          language: "system",
          pass_filenames: false,
        },
      ],
    });
    await writeFile(configPath, stringifyYaml(doc), "utf8");
    return "pre-commit (python): added local silent-code hook to .pre-commit-config.yaml";
  }
  return "pre-commit (python): silent-code hook already present";
}

async function installSimpleGitHooks(root: string): Promise<string> {
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  pkg["simple-git-hooks"] = pkg["simple-git-hooks"] ?? {};
  let changed = false;
  const mapping: Record<HookName, string> = {
    "pre-commit": "npx silent-code check --staged",
    "commit-msg": 'npx silent-code check-message "$1"',
    "pre-push": "npx silent-code check --range HEAD@{push}..HEAD",
  };
  for (const [hook, command] of Object.entries(mapping)) {
    if (!pkg["simple-git-hooks"][hook]) {
      pkg["simple-git-hooks"][hook] = command;
      changed = true;
    }
  }
  if (changed) {
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  }
  return changed
    ? "simple-git-hooks: added silent-code entries to package.json (run npx simple-git-hooks to apply)"
    : "simple-git-hooks: silent-code entries already present";
}

export async function installGitHooks(root: string): Promise<string[]> {
  const { manager } = await detectHookManager(root);
  const messages: string[] = [];

  switch (manager) {
    case "husky":
      for (const name of ["pre-commit", "commit-msg", "pre-push"] as HookName[]) {
        messages.push(await installHuskyHook(root, name));
      }
      return messages;
    case "lefthook":
      messages.push(await installLefthookHook(root));
      return messages;
    case "pre-commit":
      messages.push(await installPreCommitFrameworkHook(root));
      messages.push("Note: commit-msg and pre-push are not managed by the python pre-commit framework; consider also running silent-code init --direct.");
      return messages;
    case "simple-git-hooks":
      messages.push(await installSimpleGitHooks(root));
      return messages;
    default:
      for (const name of ["pre-commit", "commit-msg", "pre-push"] as HookName[]) {
        messages.push(await installDirectHook(root, name));
      }
      return messages;
  }
}
