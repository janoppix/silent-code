import type { ZeroAiAttributionConfig } from "../core/config.js";
import type { CheckReport, Violation } from "../core/result.js";

interface ProviderDef {
  products: string[];
  urls: string[];
}

const PROVIDER_DEFS: Record<string, ProviderDef> = {
  anthropic: {
    products: ["claude code", "claude", "anthropic claude"],
    urls: ["claude\\.ai", "claude\\.com/claude-code"],
  },
  openai: {
    products: ["chatgpt", "codex", "openai codex", "gpt-4", "gpt-5"],
    urls: ["chatgpt\\.com"],
  },
  "github-copilot": {
    products: ["github copilot", "copilot"],
    urls: [],
  },
  cursor: {
    products: ["cursor ai", "cursor"],
    urls: [],
  },
};

const VERBS = "generated|created|written|made|built|assisted|produced|co-?written|drafted|authored";
const PREPOSITIONS = "by|with|using";

function buildAttributionRegex(products: string[]): RegExp | null {
  if (products.length === 0) return null;
  const productAlt = products.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`\\b(${VERBS})\\s+(${PREPOSITIONS})\\s+(${productAlt})\\b`, "i");
}

function buildUrlRegex(urls: string[]): RegExp | null {
  if (urls.length === 0) return null;
  return new RegExp(`\\b(${urls.join("|")})\\b`, "i");
}

const GENERIC_AI_ATTRIBUTION_RE = /\b(ai|artificial intelligence)[- ]generated\b/i;
const SIGNATURE_TRAILER_RE = /^\s*(assisted-by|generated-by|co-generated-by)\s*:/im;
const SIGNATURE_EMOJI_RE = /🤖\s*(generated|created|written)\b/i;
const SESSION_LINK_RE = /claude-session\s*:/i;

export function checkZeroAiAttribution(text: string, config: ZeroAiAttributionConfig): CheckReport {
  const violations: Violation[] = [];
  const lines = text.split("\n");

  const activeProducts = config.providers.flatMap((p) => PROVIDER_DEFS[p]?.products ?? []);
  const activeUrls = config.providers.flatMap((p) => PROVIDER_DEFS[p]?.urls ?? []);
  const attributionRe = buildAttributionRegex(activeProducts);
  const urlRe = buildUrlRegex(activeUrls);
  const customRes = config["custom-patterns"].map((p) => new RegExp(p, "i"));

  lines.forEach((line, idx) => {
    const checks: { re: RegExp; detail: string }[] = [
      { re: GENERIC_AI_ATTRIBUTION_RE, detail: "Line marks content as AI-generated." },
      { re: SIGNATURE_TRAILER_RE, detail: "Line is an AI attribution trailer." },
      { re: SIGNATURE_EMOJI_RE, detail: "Line contains an AI-generated signature." },
      { re: SESSION_LINK_RE, detail: "Line links to an AI agent session." },
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
          action: "Remove the AI attribution. Do not credit an AI agent, tool or session in code, commits or PRs.",
        });
        break;
      }
    }
  });

  return { ok: violations.length === 0, violations, warnings: [] };
}
