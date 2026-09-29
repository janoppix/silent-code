import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";
import type { LanguageSpec } from "./registry.js";

export interface CommentRange {
  startLine: number;
  endLine: number;
  text: string;
}

let initPromise: Promise<void> | null = null;
const languageCache = new Map<string, Language>();
const parserCache = new Map<string, Parser>();

function moduleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function resolveGrammarsDir(): string {
  const here = moduleDir();
  const candidates = [
    path.join(here, "..", "..", "grammars"),
    path.join(here, "..", "grammars"),
    path.join(here, "..", "..", "node_modules", "tree-sitter-wasms", "out"),
    path.join(here, "..", "..", "..", "node_modules", "tree-sitter-wasms", "out"),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "tree-sitter-javascript.wasm"))) return candidate;
  }
  throw new Error("Could not locate tree-sitter grammar directory (grammars/ or tree-sitter-wasms/out)");
}

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    const grammarsDir = resolveGrammarsDir();
    initPromise = Parser.init({
      locateFile(scriptName: string) {
        return path.join(grammarsDir, scriptName);
      },
    });
  }
  await initPromise;
}

async function loadLanguage(spec: LanguageSpec): Promise<Language> {
  const wasmFile = spec.wasmFile;
  if (!wasmFile) throw new Error(`Language ${spec.id} has no tree-sitter wasm mapping`);
  const cached = languageCache.get(spec.id);
  if (cached) return cached;
  await ensureInit();
  const grammarsDir = resolveGrammarsDir();
  const wasmPath = path.join(grammarsDir, `tree-sitter-${wasmFile}.wasm`);
  const lang = await Language.load(wasmPath);
  languageCache.set(spec.id, lang);
  return lang;
}

async function getParser(spec: LanguageSpec): Promise<Parser> {
  const cached = parserCache.get(spec.id);
  if (cached) return cached;
  const lang = await loadLanguage(spec);
  const parser = new Parser();
  parser.setLanguage(lang);
  parserCache.set(spec.id, parser);
  return parser;
}

export async function extractComments(spec: LanguageSpec, source: string): Promise<CommentRange[]> {
  const parser = await getParser(spec);
  const tree = parser.parse(source);
  if (!tree) return [];
  const nodeTypes = new Set(spec.commentNodeTypes ?? ["comment"]);
  const ranges: CommentRange[] = [];

  const cursor = tree.walk();
  const collectCommentNodes = (): void => {
    if (nodeTypes.has(cursor.nodeType)) {
      const node = cursor.currentNode;
      ranges.push({
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        text: node.text,
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
