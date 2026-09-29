import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

export interface ZeroCommentsAllow {
  shebang: boolean;
  "ts-ignore": boolean;
  "ts-expect-error": boolean;
  "eslint-directives": boolean;
  noqa: boolean;
  "go-directives": boolean;
  "pragma-directives": boolean;
}

export interface ZeroCommentsConfig {
  enabled: boolean;
  "added-lines-only": boolean;
  "python-docstrings": "allow" | "block";
  allow: ZeroCommentsAllow;
  "custom-allow": string[];
}

export interface ZeroCoauthorConfig {
  enabled: boolean;
  mode: "block" | "strip";
}

export interface ZeroAiAttributionConfig {
  enabled: boolean;
  providers: string[];
  "custom-patterns": string[];
}

export interface SilentCodeConfig {
  version: 1;
  policies: {
    "zero-comments": ZeroCommentsConfig;
    "zero-coauthor": ZeroCoauthorConfig;
    "zero-ai-attribution": ZeroAiAttributionConfig;
  };
  ignore: string[];
}

export const DEFAULT_CONFIG: SilentCodeConfig = {
  version: 1,
  policies: {
    "zero-comments": {
      enabled: true,
      "added-lines-only": true,
      "python-docstrings": "allow",
      allow: {
        shebang: true,
        "ts-ignore": false,
        "ts-expect-error": false,
        "eslint-directives": false,
        noqa: false,
        "go-directives": true,
        "pragma-directives": true,
      },
      "custom-allow": [],
    },
    "zero-coauthor": {
      enabled: true,
      mode: "block",
    },
    "zero-ai-attribution": {
      enabled: true,
      providers: ["anthropic", "openai", "github-copilot", "cursor"],
      "custom-patterns": [],
    },
  },
  ignore: [
    "**/dist/**",
    "**/build/**",
    "**/vendor/**",
    "**/node_modules/**",
    "**/*.min.js",
    "**/*.min.css",
    "**/package-lock.json",
    "**/pnpm-lock.yaml",
    "**/yarn.lock",
  ],
};

function deepMerge<T>(base: T, override: unknown): T {
  if (typeof override !== "object" || override === null || Array.isArray(override)) {
    return (override as T) ?? base;
  }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    const baseValue = (base as Record<string, unknown>)[key];
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof baseValue === "object" &&
      baseValue !== null &&
      !Array.isArray(baseValue)
    ) {
      result[key] = deepMerge(baseValue, value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

export async function loadConfig(cwd: string): Promise<SilentCodeConfig> {
  const configPath = path.join(cwd, ".silent-code.yml");
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = parseYaml(raw) ?? {};
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_CONFIG;
    }
    throw new Error(`Failed to read .silent-code.yml: ${(err as Error).message}`);
  }
}
