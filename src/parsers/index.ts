import { languageForFile } from "./registry.js";
import { extractCoffeeScriptComments } from "./coffeescript.js";
import { extractComments, type CommentRange } from "./treesitter.js";

export type { CommentRange } from "./treesitter.js";
export { languageForFile } from "./registry.js";
export type { LanguageSpec, LanguageId } from "./registry.js";

export interface CommentExtractionResult {
  supported: boolean;
  comments: CommentRange[];
}

export async function extractCommentsForFile(file: string, source: string): Promise<CommentExtractionResult> {
  const spec = languageForFile(file);
  if (!spec) return { supported: false, comments: [] };

  if (spec.kind === "coffeescript-lexer") {
    return { supported: true, comments: extractCoffeeScriptComments(source) };
  }

  const comments = await extractComments(spec, source);
  return { supported: true, comments };
}
