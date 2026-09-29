import { build } from "esbuild";
import { cp, copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const USED_GRAMMARS = [
  "javascript",
  "typescript",
  "tsx",
  "python",
  "go",
  "java",
  "kotlin",
  "swift",
  "c",
  "cpp",
  "c_sharp",
  "php",
  "ruby",
  "rust",
  "bash",
];

async function copyGrammars(): Promise<void> {
  const outDir = path.join(root, "grammars");
  await mkdir(outDir, { recursive: true });
  const sourceDir = path.join(root, "node_modules", "tree-sitter-wasms", "out");
  for (const grammar of USED_GRAMMARS) {
    const file = `tree-sitter-${grammar}.wasm`;
    await copyFile(path.join(sourceDir, file), path.join(outDir, file));
  }
  await copyFile(
    path.join(root, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
    path.join(outDir, "tree-sitter.wasm"),
  );
}

async function bundle(): Promise<void> {
  await build({
    entryPoints: [path.join(root, "src", "cli", "index.ts")],
    outfile: path.join(root, "dist", "cli.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    // These ship as real dependencies (see package.json) so the plugin works whether it is
    // installed via `npm install` or checked out directly from git with node_modules committed;
    // bundling their CJS internals into an ESM output breaks Node's dynamic-require shim for
    // built-ins (e.g. yaml requiring "process").
    external: ["yaml", "picomatch", "diff", "web-tree-sitter"],
  });
}

const VENDORED_RUNTIME_DEPS = ["yaml", "picomatch", "diff", "web-tree-sitter"];

/**
 * Vendors the handful of production dependencies that stay external to the esbuild bundle
 * (see the comment above `external` in `bundle()`) into dist/node_modules, so `dist/` is
 * self-contained for a plugin installed via a plain `git clone`, with no separate
 * `npm install` step required.
 */
async function vendorRuntimeDeps(): Promise<void> {
  const destRoot = path.join(root, "dist", "node_modules");
  await rm(destRoot, { recursive: true, force: true });
  await mkdir(destRoot, { recursive: true });
  for (const dep of VENDORED_RUNTIME_DEPS) {
    await cp(path.join(root, "node_modules", dep), path.join(destRoot, dep), { recursive: true });
  }
}

async function main(): Promise<void> {
  await mkdir(path.join(root, "dist"), { recursive: true });
  await bundle();
  await copyGrammars();
  await vendorRuntimeDeps();
  console.log("Build complete: dist/cli.mjs + dist/node_modules/ + grammars/");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
