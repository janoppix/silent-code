export type LanguageId =
  | "javascript"
  | "typescript"
  | "tsx"
  | "python"
  | "go"
  | "java"
  | "kotlin"
  | "swift"
  | "c"
  | "cpp"
  | "csharp"
  | "php"
  | "ruby"
  | "rust"
  | "bash"
  | "coffeescript";

export type ParserKind = "tree-sitter" | "coffeescript-lexer";

export interface LanguageSpec {
  id: LanguageId;
  kind: ParserKind;
  wasmFile?: string;
  commentNodeTypes?: string[];
}

const EXTENSION_TO_LANGUAGE: Record<string, LanguageId> = {
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
  ".coffee": "coffeescript",
};

const LANGUAGE_SPECS: Record<LanguageId, LanguageSpec> = {
  javascript: {
    id: "javascript",
    kind: "tree-sitter",
    wasmFile: "javascript",
    commentNodeTypes: ["comment"],
  },
  typescript: {
    id: "typescript",
    kind: "tree-sitter",
    wasmFile: "typescript",
    commentNodeTypes: ["comment"],
  },
  tsx: {
    id: "tsx",
    kind: "tree-sitter",
    wasmFile: "tsx",
    commentNodeTypes: ["comment"],
  },
  python: {
    id: "python",
    kind: "tree-sitter",
    wasmFile: "python",
    commentNodeTypes: ["comment"],
  },
  go: {
    id: "go",
    kind: "tree-sitter",
    wasmFile: "go",
    commentNodeTypes: ["comment"],
  },
  java: {
    id: "java",
    kind: "tree-sitter",
    wasmFile: "java",
    commentNodeTypes: ["line_comment", "block_comment"],
  },
  kotlin: {
    id: "kotlin",
    kind: "tree-sitter",
    wasmFile: "kotlin",
    commentNodeTypes: ["line_comment", "multiline_comment", "comment"],
  },
  swift: {
    id: "swift",
    kind: "tree-sitter",
    wasmFile: "swift",
    commentNodeTypes: ["comment", "multiline_comment"],
  },
  c: {
    id: "c",
    kind: "tree-sitter",
    wasmFile: "c",
    commentNodeTypes: ["comment"],
  },
  cpp: {
    id: "cpp",
    kind: "tree-sitter",
    wasmFile: "cpp",
    commentNodeTypes: ["comment"],
  },
  csharp: {
    id: "csharp",
    kind: "tree-sitter",
    wasmFile: "c_sharp",
    commentNodeTypes: ["comment"],
  },
  php: {
    id: "php",
    kind: "tree-sitter",
    wasmFile: "php",
    commentNodeTypes: ["comment"],
  },
  ruby: {
    id: "ruby",
    kind: "tree-sitter",
    wasmFile: "ruby",
    commentNodeTypes: ["comment"],
  },
  rust: {
    id: "rust",
    kind: "tree-sitter",
    wasmFile: "rust",
    commentNodeTypes: ["line_comment", "block_comment"],
  },
  bash: {
    id: "bash",
    kind: "tree-sitter",
    wasmFile: "bash",
    commentNodeTypes: ["comment"],
  },
  coffeescript: {
    id: "coffeescript",
    kind: "coffeescript-lexer",
  },
};

export function languageForFile(file: string): LanguageSpec | null {
  const ext = extname(file);
  const id = EXTENSION_TO_LANGUAGE[ext];
  if (!id) return null;
  return LANGUAGE_SPECS[id];
}

function extname(file: string): string {
  const base = file.split("/").pop() ?? file;
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return "";
  return base.slice(idx).toLowerCase();
}
