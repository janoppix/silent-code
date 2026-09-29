import picomatch from "picomatch";

export function isIgnored(file: string, patterns: string[]): boolean {
  const normalized = file.replace(/\\/g, "/").replace(/^\.\//, "");
  return patterns.some((pattern) => picomatch(pattern)(normalized));
}

const GENERATED_MARKER = /@generated\b/;

export function isGeneratedFile(content: string): boolean {
  const head = content.split("\n").slice(0, 20).join("\n");
  return GENERATED_MARKER.test(head);
}
