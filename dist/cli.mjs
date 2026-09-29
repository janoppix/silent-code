#!/usr/bin/env node

// src/cli/index.ts
import { readFile as readFile5, writeFile as writeFile3 } from "node:fs/promises";
import path6 from "node:path";

// src/core/config.ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
var DEFAULT_CONFIG = {
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
        "pragma-directives": true
      },
      "custom-allow": []
    },
    "zero-coauthor": {
      enabled: true,
      mode: "block"
    },
    "zero-ai-attribution": {
      enabled: true,
      providers: ["anthropic", "openai", "github-copilot", "cursor"],
      "custom-patterns": []
    }
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
    "**/yarn.lock"
  ]
};
function deepMerge(base, override) {
  if (typeof override !== "object" || override === null || Array.isArray(override)) {
    return override ?? base;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = base[key];
    if (typeof value === "object" && value !== null && !Array.isArray(value) && typeof baseValue === "object" && baseValue !== null && !Array.isArray(baseValue)) {
      result[key] = deepMerge(baseValue, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
async function loadConfig(cwd) {
  const configPath = path.join(cwd, ".silent-code.yml");
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = parseYaml(raw) ?? {};
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch (err) {
    if (err.code === "ENOENT") {
      return DEFAULT_CONFIG;
    }
    throw new Error(`Failed to read .silent-code.yml: ${err.message}`);
  }
}

// src/core/git.ts
import { spawn } from "node:child_process";
function git(args, cwd) {
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
async function isGitRepo(cwd) {
  const res = await git(["rev-parse", "--is-inside-work-tree"], cwd);
  return res.code === 0 && res.stdout.trim() === "true";
}
async function repoRoot(cwd) {
  const res = await git(["rev-parse", "--show-toplevel"], cwd);
  if (res.code !== 0) return null;
  return res.stdout.trim();
}
async function showFileAtRef(cwd, ref, file) {
  const spec = ref === ":0" ? `:${file}` : `${ref}:${file}`;
  const res = await git(["show", spec], cwd);
  if (res.code !== 0) return "";
  return res.stdout;
}
async function isFileTracked(cwd, file) {
  const res = await git(["ls-files", "--error-unmatch", file], cwd);
  return res.code === 0;
}
async function isFileStaged(cwd, file) {
  const res = await git(["diff", "--cached", "--name-only", "--", file], cwd);
  return res.code === 0 && res.stdout.trim().length > 0;
}
async function resolveDiffContext(cwd, file, current) {
  const tracked = await isFileTracked(cwd, file);
  if (!tracked) {
    return { base: "", current };
  }
  const staged = await isFileStaged(cwd, file);
  const base = staged ? await showFileAtRef(cwd, ":0", file) : await showFileAtRef(cwd, "HEAD", file);
  return { base, current };
}
async function stagedFileContent(cwd, file) {
  return showFileAtRef(cwd, ":0", file);
}
async function stagedFiles(cwd) {
  const res = await git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"], cwd);
  if (res.code !== 0) return [];
  return res.stdout.split("\n").filter(Boolean);
}
async function changedFilesInRange(cwd, range) {
  const res = await git(["diff", "--name-only", "--diff-filter=ACMR", range], cwd);
  if (res.code !== 0) return [];
  return res.stdout.split("\n").filter(Boolean);
}
async function fileAtRevision(cwd, revision, file) {
  return showFileAtRef(cwd, revision, file);
}
async function commitMessagesInRange(cwd, range) {
  const res = await git(["log", "--format=%H%x01%B%x02", range], cwd);
  if (res.code !== 0) return [];
  return res.stdout.split("").map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => {
    const [sha, ...rest] = chunk.split("");
    return { sha, message: rest.join("").trim() };
  });
}

// src/core/result.ts
function mergeReports(reports) {
  const violations = reports.flatMap((r) => r.violations);
  const warnings = reports.flatMap((r) => r.warnings);
  return { ok: violations.length === 0, violations, warnings };
}
function emptyReport() {
  return { ok: true, violations: [], warnings: [] };
}
function formatViolation(v) {
  const lines = [`POLICY_VIOLATION: ${v.policy}`, ""];
  if (v.file) {
    lines.push("File:", v.file, "");
  }
  if (v.line !== void 0) {
    lines.push("Line:", String(v.line), "");
  }
  lines.push(v.detail, "", v.snippet, "", "Required action:", "", v.action);
  return lines.join("\n");
}
function formatReport(report) {
  if (report.ok) {
    return report.warnings.length ? report.warnings.map((w) => `WARNING: ${w}`).join("\n") : "OK: no policy violations";
  }
  const blocks = report.violations.map(formatViolation);
  const warnings = report.warnings.map((w) => `WARNING: ${w}`);
  return [...blocks, ...warnings].join("\n\n---\n\n");
}

// src/core/ignore.ts
import picomatch from "picomatch";
function isIgnored(file, patterns) {
  const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
  return patterns.some((pattern) => picomatch(pattern)(normalized));
}
var GENERATED_MARKER = /@generated\b/;
function isGeneratedFile(content) {
  const head = content.split("\n").slice(0, 20).join("\n");
  return GENERATED_MARKER.test(head);
}

// src/policies/zero-ai-attribution.ts
var PROVIDER_DEFS = {
  anthropic: {
    products: ["claude code", "claude", "anthropic claude"],
    urls: ["claude\\.ai", "claude\\.com/claude-code"]
  },
  openai: {
    products: ["chatgpt", "codex", "openai codex", "gpt-4", "gpt-5"],
    urls: ["chatgpt\\.com"]
  },
  "github-copilot": {
    products: ["github copilot", "copilot"],
    urls: []
  },
  cursor: {
    products: ["cursor ai", "cursor"],
    urls: []
  }
};
var VERBS = "generated|created|written|made|built|assisted|produced|co-?written|drafted|authored";
var PREPOSITIONS = "by|with|using";
function buildAttributionRegex(products) {
  if (products.length === 0) return null;
  const productAlt = products.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`\\b(${VERBS})\\s+(${PREPOSITIONS})\\s+(${productAlt})\\b`, "i");
}
function buildUrlRegex(urls) {
  if (urls.length === 0) return null;
  return new RegExp(`\\b(${urls.join("|")})\\b`, "i");
}
var GENERIC_AI_ATTRIBUTION_RE = /\b(ai|artificial intelligence)[- ]generated\b/i;
var SIGNATURE_TRAILER_RE = /^\s*(assisted-by|generated-by|co-generated-by)\s*:/im;
var SIGNATURE_EMOJI_RE = /🤖\s*(generated|created|written)\b/i;
var SESSION_LINK_RE = /claude-session\s*:/i;
function checkZeroAiAttribution(text, config) {
  const violations = [];
  const lines = text.split("\n");
  const activeProducts = config.providers.flatMap((p) => PROVIDER_DEFS[p]?.products ?? []);
  const activeUrls = config.providers.flatMap((p) => PROVIDER_DEFS[p]?.urls ?? []);
  const attributionRe = buildAttributionRegex(activeProducts);
  const urlRe = buildUrlRegex(activeUrls);
  const customRes = config["custom-patterns"].map((p) => new RegExp(p, "i"));
  lines.forEach((line, idx) => {
    const checks = [
      { re: GENERIC_AI_ATTRIBUTION_RE, detail: "Line marks content as AI-generated." },
      { re: SIGNATURE_TRAILER_RE, detail: "Line is an AI attribution trailer." },
      { re: SIGNATURE_EMOJI_RE, detail: "Line contains an AI-generated signature." },
      { re: SESSION_LINK_RE, detail: "Line links to an AI agent session." }
    ];
    if (attributionRe) checks.push({ re: attributionRe, detail: "Line attributes content to an AI coding agent." });
    if (urlRe) checks.push({ re: urlRe, detail: "Line references a known AI agent URL." });
    for (const custom of customRes) checks.push({ re: custom, detail: "Line matches a custom AI attribution pattern." });
    for (const { re, detail } of checks) {
      if (re.test(line)) {
        violations.push({
          policy: "zero-ai-attribution",
          line: idx + 1,
          snippet: line.trim(),
          detail,
          action: "Remove the AI attribution. Do not credit an AI agent, tool or session in code, commits or PRs."
        });
        break;
      }
    }
  });
  return { ok: violations.length === 0, violations, warnings: [] };
}

// src/policies/zero-coauthor.ts
var TRAILER_RE = /^\s*co-authored-by\s*:/i;
function checkZeroCoauthor(message, config) {
  const lines = message.split("\n");
  const matches = [];
  lines.forEach((line, idx) => {
    if (TRAILER_RE.test(line)) matches.push({ line: idx + 1, text: line });
  });
  if (matches.length === 0) {
    return { ok: true, violations: [], warnings: [] };
  }
  if (config.mode === "strip") {
    const stripped = lines.filter((line) => !TRAILER_RE.test(line)).join("\n");
    return { ok: true, violations: [], warnings: [`Stripped ${matches.length} Co-Authored-By trailer(s).`], strippedMessage: stripped };
  }
  const violations = matches.map((m) => ({
    policy: "zero-coauthor",
    line: m.line,
    snippet: m.text,
    detail: "Commit message contains a Co-Authored-By trailer.",
    action: "Remove the Co-Authored-By line from the commit message. Authorship trailers for AI agents are not permitted."
  }));
  return { ok: false, violations, warnings: [] };
}

// src/core/diff.ts
import { diffLines } from "diff";
function addedLineNumbers(base, current) {
  const added = /* @__PURE__ */ new Set();
  if (base === current) return added;
  const parts = diffLines(base, current);
  let lineNo = 0;
  for (const part of parts) {
    const count = part.value.split("\n").length - (part.value.endsWith("\n") ? 1 : 0);
    if (part.added) {
      for (let i = 0; i < count; i++) {
        added.add(lineNo + i + 1);
      }
    }
    if (!part.removed) {
      lineNo += count;
    }
  }
  return added;
}
function baseLineSet(base) {
  return new Set(base.split("\n").map((l) => l.trim()));
}

// src/parsers/registry.ts
var EXTENSION_TO_LANGUAGE = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".rb": "ruby",
  ".rs": "rust",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".coffee": "coffeescript"
};
var LANGUAGE_SPECS = {
  javascript: {
    id: "javascript",
    kind: "tree-sitter",
    wasmFile: "javascript",
    commentNodeTypes: ["comment"]
  },
  typescript: {
    id: "typescript",
    kind: "tree-sitter",
    wasmFile: "typescript",
    commentNodeTypes: ["comment"]
  },
  tsx: {
    id: "tsx",
    kind: "tree-sitter",
    wasmFile: "tsx",
    commentNodeTypes: ["comment"]
  },
  python: {
    id: "python",
    kind: "tree-sitter",
    wasmFile: "python",
    commentNodeTypes: ["comment"]
  },
  go: {
    id: "go",
    kind: "tree-sitter",
    wasmFile: "go",
    commentNodeTypes: ["comment"]
  },
  java: {
    id: "java",
    kind: "tree-sitter",
    wasmFile: "java",
    commentNodeTypes: ["line_comment", "block_comment"]
  },
  kotlin: {
    id: "kotlin",
    kind: "tree-sitter",
    wasmFile: "kotlin",
    commentNodeTypes: ["line_comment", "multiline_comment", "comment"]
  },
  swift: {
    id: "swift",
    kind: "tree-sitter",
    wasmFile: "swift",
    commentNodeTypes: ["comment", "multiline_comment"]
  },
  c: {
    id: "c",
    kind: "tree-sitter",
    wasmFile: "c",
    commentNodeTypes: ["comment"]
  },
  cpp: {
    id: "cpp",
    kind: "tree-sitter",
    wasmFile: "cpp",
    commentNodeTypes: ["comment"]
  },
  csharp: {
    id: "csharp",
    kind: "tree-sitter",
    wasmFile: "c_sharp",
    commentNodeTypes: ["comment"]
  },
  php: {
    id: "php",
    kind: "tree-sitter",
    wasmFile: "php",
    commentNodeTypes: ["comment"]
  },
  ruby: {
    id: "ruby",
    kind: "tree-sitter",
    wasmFile: "ruby",
    commentNodeTypes: ["comment"]
  },
  rust: {
    id: "rust",
    kind: "tree-sitter",
    wasmFile: "rust",
    commentNodeTypes: ["line_comment", "block_comment"]
  },
  bash: {
    id: "bash",
    kind: "tree-sitter",
    wasmFile: "bash",
    commentNodeTypes: ["comment"]
  },
  coffeescript: {
    id: "coffeescript",
    kind: "coffeescript-lexer"
  }
};
function languageForFile(file) {
  const ext = extname(file);
  const id = EXTENSION_TO_LANGUAGE[ext];
  if (!id) return null;
  return LANGUAGE_SPECS[id];
}
function extname(file) {
  const base = file.split("/").pop() ?? file;
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return "";
  return base.slice(idx).toLowerCase();
}

// src/parsers/coffeescript.ts
function extractCoffeeScriptComments(source) {
  const ranges = [];
  let i = 0;
  let line = 1;
  const n = source.length;
  let lastNonSpaceChar = null;
  const advanceThrough = (text, from) => {
    let l = line;
    for (let k = from; k < text.length; k++) {
      if (text[k] === "\n") l++;
    }
    line = l;
    return text.length;
  };
  while (i < n) {
    const ch = source[i];
    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (source.startsWith("###", i)) {
      const start = i;
      const startLine = line;
      const end = source.indexOf("###", i + 3);
      const stop = end === -1 ? n : end + 3;
      const text = source.slice(start, stop);
      advanceThrough(text, 0);
      ranges.push({ startLine, endLine: line, text });
      i = stop;
      lastNonSpaceChar = null;
      continue;
    }
    if (ch === "#") {
      const start = i;
      const startLine = line;
      let end = source.indexOf("\n", i);
      if (end === -1) end = n;
      ranges.push({ startLine, endLine: startLine, text: source.slice(start, end) });
      i = end;
      lastNonSpaceChar = null;
      continue;
    }
    if (source.startsWith("'''", i) || source.startsWith('"""', i)) {
      const quote = source.slice(i, i + 3);
      const start = i + 3;
      const end = source.indexOf(quote, start);
      const stop = end === -1 ? n : end + 3;
      advanceThrough(source.slice(i, stop), 0);
      i = stop;
      lastNonSpaceChar = "'";
      continue;
    }
    if (ch === "'") {
      i++;
      while (i < n && source[i] !== "'") {
        if (source[i] === "\\") i++;
        if (source[i] === "\n") line++;
        i++;
      }
      i++;
      lastNonSpaceChar = "'";
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < n && source[i] !== '"') {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "#" && source[i + 1] === "{") {
          i += 2;
          let interpolationDepth = 1;
          while (i < n && interpolationDepth > 0) {
            if (source[i] === "{") interpolationDepth++;
            if (source[i] === "}") interpolationDepth--;
            if (source[i] === "\n") line++;
            i++;
          }
          continue;
        }
        if (source[i] === "\n") line++;
        i++;
      }
      i++;
      lastNonSpaceChar = '"';
      continue;
    }
    if (source.startsWith("///", i)) {
      const start = i;
      const end = source.indexOf("///", i + 3);
      const stop = end === -1 ? n : end + 3;
      advanceThrough(source.slice(start, stop), 0);
      i = stop;
      lastNonSpaceChar = "/";
      continue;
    }
    if (ch === "/" && canStartRegex(lastNonSpaceChar)) {
      const start = i;
      i++;
      let inCharacterClass = false;
      let closed = false;
      while (i < n) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "[") inCharacterClass = true;
        if (source[i] === "]") inCharacterClass = false;
        if (source[i] === "\n") break;
        if (!inCharacterClass && source[i] === "/") {
          closed = true;
          i++;
          break;
        }
        i++;
      }
      if (closed) {
        lastNonSpaceChar = "/";
        continue;
      }
      i = start + 1;
      lastNonSpaceChar = "/";
      continue;
    }
    if (!/\s/.test(ch)) {
      lastNonSpaceChar = ch;
    }
    i++;
  }
  return ranges;
}
function canStartRegex(lastNonSpaceChar) {
  if (lastNonSpaceChar === null) return true;
  if (/[a-zA-Z0-9_)\]}]/.test(lastNonSpaceChar)) return false;
  return true;
}

// src/parsers/treesitter.ts
import { existsSync } from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";
var initPromise = null;
var languageCache = /* @__PURE__ */ new Map();
var parserCache = /* @__PURE__ */ new Map();
function moduleDir() {
  return path2.dirname(fileURLToPath(import.meta.url));
}
function resolveGrammarsDir() {
  const here = moduleDir();
  const candidates = [
    path2.join(here, "..", "..", "grammars"),
    path2.join(here, "..", "grammars"),
    path2.join(here, "..", "..", "node_modules", "tree-sitter-wasms", "out"),
    path2.join(here, "..", "..", "..", "node_modules", "tree-sitter-wasms", "out")
  ];
  for (const candidate of candidates) {
    if (existsSync(path2.join(candidate, "tree-sitter-javascript.wasm"))) return candidate;
  }
  throw new Error("Could not locate tree-sitter grammar directory (grammars/ or tree-sitter-wasms/out)");
}
async function ensureInit() {
  if (!initPromise) {
    const grammarsDir = resolveGrammarsDir();
    initPromise = Parser.init({
      locateFile(scriptName) {
        return path2.join(grammarsDir, scriptName);
      }
    });
  }
  await initPromise;
}
async function loadLanguage(spec) {
  const wasmFile = spec.wasmFile;
  if (!wasmFile) throw new Error(`Language ${spec.id} has no tree-sitter wasm mapping`);
  const cached = languageCache.get(spec.id);
  if (cached) return cached;
  await ensureInit();
  const grammarsDir = resolveGrammarsDir();
  const wasmPath = path2.join(grammarsDir, `tree-sitter-${wasmFile}.wasm`);
  const lang = await Language.load(wasmPath);
  languageCache.set(spec.id, lang);
  return lang;
}
async function getParser(spec) {
  const cached = parserCache.get(spec.id);
  if (cached) return cached;
  const lang = await loadLanguage(spec);
  const parser = new Parser();
  parser.setLanguage(lang);
  parserCache.set(spec.id, parser);
  return parser;
}
async function extractComments(spec, source) {
  const parser = await getParser(spec);
  const tree = parser.parse(source);
  if (!tree) return [];
  const nodeTypes = new Set(spec.commentNodeTypes ?? ["comment"]);
  const ranges = [];
  const cursor = tree.walk();
  const collectCommentNodes = () => {
    if (nodeTypes.has(cursor.nodeType)) {
      const node = cursor.currentNode;
      ranges.push({
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        text: node.text
      });
      return;
    }
    if (cursor.gotoFirstChild()) {
      do {
        collectCommentNodes();
      } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  };
  collectCommentNodes();
  return ranges;
}

// src/parsers/index.ts
async function extractCommentsForFile(file, source) {
  const spec = languageForFile(file);
  if (!spec) return { supported: false, comments: [] };
  if (spec.kind === "coffeescript-lexer") {
    return { supported: true, comments: extractCoffeeScriptComments(source) };
  }
  const comments = await extractComments(spec, source);
  return { supported: true, comments };
}

// src/policies/zero-comments.ts
var ALLOW_RULES = [
  { configKey: "shebang", test: (line, isFirstLine) => isFirstLine && line.startsWith("#!") },
  { configKey: "ts-ignore", test: (line) => /@ts-ignore\b/.test(line) },
  { configKey: "ts-expect-error", test: (line) => /@ts-expect-error\b/.test(line) },
  {
    configKey: "eslint-directives",
    test: (line) => /eslint-(disable|enable)(-next-line)?\b/.test(line) || /eslint-env\b/.test(line)
  },
  { configKey: "noqa", test: (line) => /\bnoqa\b/i.test(line) },
  { configKey: "go-directives", test: (line) => /^\/\/go:\w+/.test(line.trim()) || /^\/\/\s*\+build\b/.test(line.trim()) },
  {
    configKey: "pragma-directives",
    test: (line) => /^#\s*region\b/i.test(line.trim()) || /^#\s*endregion\b/i.test(line.trim()) || /\bSPDX-License-Identifier\b/.test(line)
  }
];
function isAllowed(line, isFirstLine, config) {
  for (const rule of ALLOW_RULES) {
    if (config.allow[rule.configKey] && rule.test(line, isFirstLine)) return true;
  }
  return config["custom-allow"].some((pattern) => new RegExp(pattern).test(line));
}
async function checkZeroComments(file, base, current, config) {
  const violations = [];
  const warnings = [];
  const extraction = await extractCommentsForFile(file, current);
  if (!extraction.supported) {
    warnings.push(`No parser registered for ${file}; skipped zero-comments check.`);
    return { ok: true, violations, warnings };
  }
  const added = config["added-lines-only"] ? addedLineNumbers(base, current) : null;
  const baseLines = baseLineSet(base);
  const currentLines = current.split("\n");
  for (const comment of extraction.comments) {
    let violatingLine = null;
    for (let lineNo = comment.startLine; lineNo <= comment.endLine; lineNo++) {
      const isNew = added ? added.has(lineNo) : true;
      if (!isNew) continue;
      const rawLine = currentLines[lineNo - 1] ?? "";
      const trimmed = rawLine.trim();
      if (baseLines.has(trimmed)) continue;
      if (isAllowed(rawLine, lineNo === 1, config)) continue;
      violatingLine = lineNo;
      break;
    }
    if (violatingLine === null) continue;
    violations.push({
      policy: "zero-comments",
      file,
      line: violatingLine,
      snippet: comment.text,
      detail: "Added code comment.",
      action: "Remove the comment. Express the intent through naming, structure or implementation. Do not bypass this policy."
    });
  }
  return { ok: violations.length === 0, violations, warnings };
}

// src/policies/index.ts
var PROSE_EXTENSIONS_EXEMPT_FROM_ATTRIBUTION_SCAN = /* @__PURE__ */ new Set([".md", ".mdx", ".txt", ".rst", ".adoc"]);
function isExemptFromAttributionScan(file) {
  const base = file.split("/").pop() ?? file;
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return false;
  return PROSE_EXTENSIONS_EXEMPT_FROM_ATTRIBUTION_SCAN.has(base.slice(idx).toLowerCase());
}
async function checkFile(file, base, current, config) {
  if (isIgnored(file, config.ignore) || isGeneratedFile(current)) {
    return emptyReport();
  }
  const reports = [];
  if (config.policies["zero-comments"].enabled) {
    reports.push(await checkZeroComments(file, base, current, config.policies["zero-comments"]));
  }
  if (config.policies["zero-ai-attribution"].enabled && !isExemptFromAttributionScan(file)) {
    const attribution = checkZeroAiAttribution(current, config.policies["zero-ai-attribution"]);
    reports.push(withFile(attribution, file));
  }
  return mergeReports(reports);
}
function checkCommitMessage(message, config) {
  const reports = [];
  let strippedMessage;
  if (config.policies["zero-coauthor"].enabled) {
    const result = checkZeroCoauthor(message, config.policies["zero-coauthor"]);
    reports.push(result);
    strippedMessage = result.strippedMessage;
  }
  if (config.policies["zero-ai-attribution"].enabled) {
    reports.push(checkZeroAiAttribution(strippedMessage ?? message, config.policies["zero-ai-attribution"]));
  }
  return { ...mergeReports(reports), strippedMessage };
}
function withFile(report, file) {
  return {
    ...report,
    violations: report.violations.map((v) => ({ ...v, file }))
  };
}

// src/cli/doctor.ts
import { existsSync as existsSync2 } from "node:fs";
import { readFile as readFile2 } from "node:fs/promises";
import os from "node:os";
import path3 from "node:path";

// src/cli/hooks-common.ts
var MARKER_START = "# >>> silent-code hook >>>";
var MARKER_END = "# <<< silent-code hook <<<";
function withMarkers(body) {
  return `${MARKER_START}
${body.trim()}
${MARKER_END}`;
}
function hasMarkedBlock(content) {
  return content.includes(MARKER_START);
}

// src/cli/doctor.ts
async function runDoctor(cwd) {
  const lines = [];
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
function formatLine(line) {
  const status = line.status.padEnd(8);
  const text = `${line.label.padEnd(20)} ${status}`;
  return line.detail ? `${text} (${line.detail})` : text;
}
async function checkClaudePlugin() {
  const installedPath = path3.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
  try {
    const raw = await readFile2(installedPath, "utf8");
    const installed = JSON.parse(raw);
    const found = JSON.stringify(installed).includes("silent-code");
    return found ? { label: "Claude plugin", status: "OK" } : { label: "Claude plugin", status: "MISSING", detail: "run /plugin install silent-code@silent-code" };
  } catch {
    return { label: "Claude plugin", status: "WARN", detail: "could not read installed_plugins.json" };
  }
}
async function checkHook(root, name) {
  const hookPath = path3.join(root, ".git", "hooks", name);
  if (!existsSync2(hookPath)) {
    return { label: `${name} hook`, status: "MISSING", detail: "run silent-code init" };
  }
  const content = await readFile2(hookPath, "utf8").catch(() => "");
  return content.includes(MARKER_START) ? { label: `${name} hook`, status: "OK" } : { label: `${name} hook`, status: "WARN", detail: "hook exists but not managed by silent-code" };
}
async function checkTreeSitter() {
  try {
    resolveGrammarsDir();
    return { label: "Tree-sitter", status: "OK" };
  } catch (err) {
    return { label: "Tree-sitter", status: "MISSING", detail: err.message };
  }
}

// src/cli/hook.ts
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function handlePostToolUse(input) {
  const cwd = input.cwd ?? process.cwd();
  const toolName = input.tool_name ?? "";
  if (!["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(toolName)) return emptyReport();
  const toolInput = input.tool_input ?? {};
  const filePath = toolInput.file_path ?? "";
  if (!filePath) return emptyReport();
  const { readFile: readFile6 } = await import("node:fs/promises");
  const path7 = await import("node:path");
  const relative = path7.isAbsolute(filePath) ? path7.relative(cwd, filePath) : filePath;
  const absolute = path7.isAbsolute(filePath) ? filePath : path7.join(cwd, filePath);
  let current;
  try {
    current = await readFile6(absolute, "utf8");
  } catch {
    return emptyReport();
  }
  const config = await loadConfig(cwd);
  const { base } = await resolveDiffContext(cwd, relative, current);
  return checkFile(relative, base, current, config);
}
var COMMIT_COMMAND_RE = /\bgit\s+commit\b/;
var PR_COMMAND_RE = /\bgh\s+pr\s+(create|edit)\b/;
var FLAG_HEREDOC_RE = /(-m|-F|--title|--body|--body-file)\s+"?\$\(\s*cat\s+<<[-~]?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\s*\2\s*\)"?/g;
var FLAG_QUOTED_RE = /(-m|--title|--body)\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;
var FLAG_FILE_PATH_RE = /(-F|--body-file)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/g;
function unescapeShellQuoted(text) {
  return text.replace(/\\(["'\\])/g, "$1");
}
async function extractTextsFromCommand(command, cwd) {
  const texts = [];
  const seenSpans = /* @__PURE__ */ new Set();
  const heredocRe = new RegExp(FLAG_HEREDOC_RE.source, "g");
  let match;
  while (match = heredocRe.exec(command)) {
    texts.push(match[3]);
    seenSpans.add(`${match.index}:${match.index + match[0].length}`);
  }
  const quotedRe = new RegExp(FLAG_QUOTED_RE.source, "g");
  while (match = quotedRe.exec(command)) {
    const withinHeredoc = [...seenSpans].some((span) => {
      const [start, end] = span.split(":").map(Number);
      return match.index >= start && match.index < end;
    });
    if (withinHeredoc) continue;
    texts.push(unescapeShellQuoted(match[2] ?? match[3] ?? ""));
  }
  const { readFile: readFile6 } = await import("node:fs/promises");
  const path7 = await import("node:path");
  const filePathRe = new RegExp(FLAG_FILE_PATH_RE.source, "g");
  while (match = filePathRe.exec(command)) {
    const filePath = match[2] ?? match[3] ?? match[4] ?? "";
    if (!filePath) continue;
    const absolute = path7.isAbsolute(filePath) ? filePath : path7.join(cwd, filePath);
    try {
      texts.push(await readFile6(absolute, "utf8"));
    } catch {
      continue;
    }
  }
  return texts;
}
async function handlePreToolUse(input) {
  const cwd = input.cwd ?? process.cwd();
  if (input.tool_name !== "Bash") return emptyReport();
  const command = input.tool_input?.command ?? "";
  const isCommit = COMMIT_COMMAND_RE.test(command);
  const isPr = PR_COMMAND_RE.test(command);
  if (!isCommit && !isPr) return emptyReport();
  const texts = await extractTextsFromCommand(command, cwd);
  if (texts.length === 0) return emptyReport();
  const config = await loadConfig(cwd);
  const reports = texts.map((text) => checkCommitMessage(text, config));
  return mergeReports(reports);
}
function normalizeEventName(raw) {
  return raw.toLowerCase().includes("pre") ? "PreToolUse" : "PostToolUse";
}
async function runHook(cwd, args) {
  const raw = await readStdin();
  let input = {};
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    input = {};
  }
  input.cwd = input.cwd ?? cwd;
  const event = normalizeEventName(args[0] ?? input.hook_event_name ?? "");
  const report = event === "PreToolUse" ? await handlePreToolUse(input) : await handlePostToolUse(input);
  if (report.ok) {
    process.stdout.write("{}");
    process.exit(0);
  }
  const reason = formatReport(report);
  const output = event === "PreToolUse" ? {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  } : { decision: "block", reason };
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

// src/cli/init.ts
import { existsSync as existsSync4 } from "node:fs";
import { copyFile, readFile as readFile4, writeFile as writeFile2 } from "node:fs/promises";
import path5 from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// src/integrations/git-hooks.ts
import { existsSync as existsSync3 } from "node:fs";
import { chmod, mkdir, readFile as readFile3, writeFile } from "node:fs/promises";
import path4 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { parse as parseYaml2, stringify as stringifyYaml } from "yaml";
function templatesDir() {
  const here = path4.dirname(fileURLToPath2(import.meta.url));
  const candidates = [
    path4.join(here, "..", "..", "templates"),
    path4.join(here, "..", "templates")
  ];
  for (const candidate of candidates) {
    if (existsSync3(candidate)) return candidate;
  }
  throw new Error("Could not locate templates/ directory");
}
async function detectHookManager(root) {
  if (existsSync3(path4.join(root, ".husky"))) {
    return { manager: "husky", detail: ".husky/ directory found" };
  }
  if (existsSync3(path4.join(root, "lefthook.yml")) || existsSync3(path4.join(root, "lefthook.yaml"))) {
    return { manager: "lefthook", detail: "lefthook.yml found" };
  }
  if (existsSync3(path4.join(root, ".pre-commit-config.yaml"))) {
    return { manager: "pre-commit", detail: ".pre-commit-config.yaml found (python pre-commit)" };
  }
  const pkgPath = path4.join(root, "package.json");
  if (existsSync3(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile3(pkgPath, "utf8"));
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
async function resolveHooksDir(root) {
  const hooksPath = await git(["config", "core.hooksPath"], root);
  if (hooksPath.code === 0 && hooksPath.stdout.trim()) {
    return path4.isAbsolute(hooksPath.stdout.trim()) ? hooksPath.stdout.trim() : path4.join(root, hooksPath.stdout.trim());
  }
  return path4.join(root, ".git", "hooks");
}
async function readTemplate(name) {
  return readFile3(path4.join(templatesDir(), name), "utf8");
}
async function installDirectHook(root, name) {
  const hooksDir = await resolveHooksDir(root);
  await mkdir(hooksDir, { recursive: true });
  const hookPath = path4.join(hooksDir, name);
  const body = withMarkers(await readTemplate(name));
  let existing = "";
  if (existsSync3(hookPath)) {
    existing = await readFile3(hookPath, "utf8");
    if (hasMarkedBlock(existing)) {
      return `${name}: already installed at ${hookPath}`;
    }
  }
  const shebang = "#!/usr/bin/env bash\n";
  const content = existing ? `${existing.trimEnd()}

${body}
` : `${shebang}
${body}
`;
  await writeFile(hookPath, content, "utf8");
  await chmod(hookPath, 493);
  return existing ? `${name}: appended to existing hook at ${hookPath}` : `${name}: installed at ${hookPath}`;
}
async function installHuskyHook(root, name) {
  const huskyDir = path4.join(root, ".husky");
  const hookPath = path4.join(huskyDir, name);
  const body = withMarkers(await readTemplate(name));
  let existing = "";
  if (existsSync3(hookPath)) {
    existing = await readFile3(hookPath, "utf8");
    if (hasMarkedBlock(existing)) {
      return `${name}: already installed in .husky/${name}`;
    }
  }
  const content = existing ? `${existing.trimEnd()}

${body}
` : `${body}
`;
  await writeFile(hookPath, content, "utf8");
  await chmod(hookPath, 493);
  return existing ? `${name}: appended to existing .husky/${name}` : `${name}: installed at .husky/${name}`;
}
async function installLefthookHook(root) {
  const lefthookPath = existsSync3(path4.join(root, "lefthook.yml")) ? path4.join(root, "lefthook.yml") : path4.join(root, "lefthook.yaml");
  const raw = await readFile3(lefthookPath, "utf8");
  const doc = parseYaml2(raw) ?? {};
  const additions = {
    "pre-commit": { commands: { "silent-code": { run: "silent-code check --staged" } } },
    "commit-msg": { commands: { "silent-code": { run: "silent-code check-message {1}" } } },
    "pre-push": { commands: { "silent-code": { run: "silent-code check --range $(git rev-parse --abbrev-ref --symbolic-full-name @{u})..HEAD" } } }
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
  return changed ? `lefthook: added silent-code commands to ${path4.basename(lefthookPath)}` : "lefthook: silent-code commands already present";
}
async function installPreCommitFrameworkHook(root) {
  const configPath = path4.join(root, ".pre-commit-config.yaml");
  const raw = await readFile3(configPath, "utf8");
  const doc = parseYaml2(raw) ?? { repos: [] };
  doc.repos = doc.repos ?? [];
  const alreadyPresent = doc.repos.some(
    (repo) => (repo.hooks ?? []).some((hook) => hook.id === "silent-code")
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
          pass_filenames: false
        }
      ]
    });
    await writeFile(configPath, stringifyYaml(doc), "utf8");
    return "pre-commit (python): added local silent-code hook to .pre-commit-config.yaml";
  }
  return "pre-commit (python): silent-code hook already present";
}
async function installSimpleGitHooks(root) {
  const pkgPath = path4.join(root, "package.json");
  const pkg = JSON.parse(await readFile3(pkgPath, "utf8"));
  pkg["simple-git-hooks"] = pkg["simple-git-hooks"] ?? {};
  let changed = false;
  const mapping = {
    "pre-commit": "npx silent-code check --staged",
    "commit-msg": 'npx silent-code check-message "$1"',
    "pre-push": "npx silent-code check --range HEAD@{push}..HEAD"
  };
  for (const [hook, command] of Object.entries(mapping)) {
    if (!pkg["simple-git-hooks"][hook]) {
      pkg["simple-git-hooks"][hook] = command;
      changed = true;
    }
  }
  if (changed) {
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}
`, "utf8");
  }
  return changed ? "simple-git-hooks: added silent-code entries to package.json (run npx simple-git-hooks to apply)" : "simple-git-hooks: silent-code entries already present";
}
async function installGitHooks(root) {
  const { manager } = await detectHookManager(root);
  const messages = [];
  switch (manager) {
    case "husky":
      for (const name of ["pre-commit", "commit-msg", "pre-push"]) {
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
      for (const name of ["pre-commit", "commit-msg", "pre-push"]) {
        messages.push(await installDirectHook(root, name));
      }
      return messages;
  }
}

// src/cli/init.ts
function templatesDir2() {
  const here = path5.dirname(fileURLToPath3(import.meta.url));
  const candidates = [path5.join(here, "..", "..", "templates"), path5.join(here, "..", "templates")];
  for (const candidate of candidates) {
    if (existsSync4(candidate)) return candidate;
  }
  throw new Error("Could not locate templates/ directory");
}
async function appendPolicySection(filePath, section) {
  if (!existsSync4(filePath)) {
    await writeFile2(filePath, `${section}
`, "utf8");
    return `created ${path5.basename(filePath)}`;
  }
  const content = await readFile4(filePath, "utf8");
  if (content.includes("## Silent Code Repository Policies")) {
    return `${path5.basename(filePath)} already has the silent-code section`;
  }
  await writeFile2(filePath, `${content.trimEnd()}

${section}
`, "utf8");
  return `appended silent-code section to ${path5.basename(filePath)}`;
}
async function runInit(cwd) {
  const root = await repoRoot(cwd) ?? cwd;
  const messages = [];
  const configPath = path5.join(root, ".silent-code.yml");
  if (existsSync4(configPath)) {
    messages.push(".silent-code.yml already exists, left untouched");
  } else {
    await copyFile(path5.join(templatesDir2(), ".silent-code.yml"), configPath);
    messages.push("created .silent-code.yml");
  }
  const claudeSection = await readFile4(path5.join(templatesDir2(), "CLAUDE.md"), "utf8");
  messages.push(await appendPolicySection(path5.join(root, "CLAUDE.md"), claudeSection.trim()));
  const agentsSection = await readFile4(path5.join(templatesDir2(), "AGENTS.md"), "utf8");
  messages.push(await appendPolicySection(path5.join(root, "AGENTS.md"), agentsSection.trim()));
  const hookMessages = await installGitHooks(root);
  messages.push(...hookMessages);
  const workflowsDir = path5.join(root, ".github", "workflows");
  const workflowPath = path5.join(workflowsDir, "silent-code.yml");
  if (existsSync4(workflowPath)) {
    messages.push(".github/workflows/silent-code.yml already exists, left untouched");
  } else if (existsSync4(path5.join(root, ".github"))) {
    await copyFile(path5.join(templatesDir2(), "github-actions.yml"), workflowPath);
    messages.push("created .github/workflows/silent-code.yml");
  } else {
    messages.push("skipped GitHub Actions workflow (.github/ not found; copy templates/github-actions.yml manually if needed)");
  }
  console.log("silent-code init\n");
  for (const message of messages) {
    console.log(`- ${message}`);
  }
}

// src/cli/index.ts
async function main() {
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
function printUsage() {
  console.log(`silent-code - deterministic zero-comments / zero-coauthor / zero-ai-attribution enforcement

Usage:
  silent-code init
  silent-code check [--staged | --working-tree | --range <a>..<b>]
  silent-code check-comments <file>
  silent-code check-message <path-to-message-file>
  silent-code doctor
`);
}
async function cmdCheck(cwd, args) {
  const config = await loadConfig(cwd);
  const mode = args.includes("--staged") ? "staged" : args.includes("--range") ? "range" : "working-tree";
  if (!await isGitRepo(cwd)) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }
  const reports = [];
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
        warnings: messageReport.warnings
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
      const current = await readFile5(path6.join(cwd, file), "utf8").catch(() => "");
      const { base } = await resolveDiffContext(cwd, file, current);
      reports.push(await checkFile(file, base, current, config));
    }
  }
  const merged = mergeReports(reports.length ? reports : [emptyReport()]);
  console.log(formatReport(merged));
  process.exitCode = merged.ok ? 0 : 1;
}
async function cmdCheckComments(cwd, args) {
  const [file] = args;
  if (!file) {
    console.error("Usage: silent-code check-comments <file>");
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(cwd);
  const current = await readFile5(path6.join(cwd, file), "utf8");
  const { base } = await resolveDiffContext(cwd, file, current);
  const report = await checkFile(file, base, current, config);
  console.log(formatReport(report));
  process.exitCode = report.ok ? 0 : 1;
}
async function cmdCheckMessage(cwd, args) {
  const [messagePath] = args;
  if (!messagePath) {
    console.error("Usage: silent-code check-message <path-to-message-file>");
    process.exitCode = 1;
    return;
  }
  const config = await loadConfig(cwd);
  const absolute = path6.isAbsolute(messagePath) ? messagePath : path6.join(cwd, messagePath);
  const message = await readFile5(absolute, "utf8");
  const report = checkCommitMessage(message, config);
  if (report.strippedMessage !== void 0 && report.strippedMessage !== message) {
    await writeFile3(absolute, report.strippedMessage, "utf8");
  }
  console.log(formatReport(report));
  process.exitCode = report.ok ? 0 : 1;
}
function splitRange(range) {
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
