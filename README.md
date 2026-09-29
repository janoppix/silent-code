# silent-code

[![CI](https://github.com/janoppix/silent-code/actions/workflows/ci.yml/badge.svg)](https://github.com/janoppix/silent-code/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/silent-code.svg)](https://www.npmjs.com/package/silent-code)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Deterministic enforcement of three policies for AI coding agents:

```
zero-comments
zero-coauthor
zero-ai-attribution
```

This is not a prompt. `CLAUDE.md`/`AGENTS.md` instructions are preventive only;
enforcement is a Tree-sitter/AST-aware policy engine wired into native Claude
Code hooks, git hooks and CI.

```
Agent instructions
        v
native agent hooks   (Claude Code PostToolUse / PreToolUse)
        v
AST-aware policy engine
        v
Git hooks             (pre-commit / commit-msg / pre-push)
        v
CI validation          (GitHub Actions)
```

## Install (Claude Code plugin)

```
/plugin marketplace add janoppix/silent-code
/plugin install silent-code@silent-code
```

The plugin registers a `PostToolUse` hook on `Write|Edit|MultiEdit|NotebookEdit`
that runs `zero-comments` + `zero-ai-attribution` against the file just
touched, and a `PreToolUse` hook on `Bash` that inspects `git commit -m "..."`
invocations before they run. A violation is returned to Claude as structured
feedback so it can self-correct instead of silently failing.

## Install (git hooks + CI, any repo)

```
npx silent-code init
```

This writes `.silent-code.yml`, appends a short policy note to
`CLAUDE.md`/`AGENTS.md`, and installs `pre-commit` / `commit-msg` / `pre-push`
hooks. It detects `husky`, `lefthook`, python `pre-commit` and
`simple-git-hooks` first and integrates with whichever is present instead of
overwriting anything; with none present it writes directly to `.git/hooks/`
(or wherever `core.hooksPath` points), appending to any existing hook rather
than replacing it.

## CLI

```
silent-code init
silent-code check [--staged | --range <a>..<b>]
silent-code check-comments <file>
silent-code check-message <path-to-message-file>
silent-code doctor
```

## How zero-comments avoids false positives

Comments are found with Tree-sitter (a real per-language grammar), not regex,
so strings, template literals and regex literals that merely *contain* `//`
or `#` are never mistaken for comments. CoffeeScript ships a small dedicated
lexer since no maintained Tree-sitter grammar exists for it.

Only comments *introduced by the current change* are flagged: the file's
previous content (from `HEAD`, the index, or a CI base ref, depending on
context) is diffed against the new content, and a comment only violates the
policy if one of its lines is new **and** that line's text did not already
exist anywhere in the previous version (so moving/reindenting an old comment
is not a violation).

Configurable technical exceptions (`.silent-code.yml`): shebang, `@ts-ignore`,
`@ts-expect-error`, ESLint directives, `noqa`, Go directives (`//go:...`,
`// +build`), `#region`/`SPDX` pragmas, plus arbitrary `custom-allow` regexes.

Supported languages: JavaScript, TypeScript, JSX, TSX, CoffeeScript, Python,
Go, Java, Kotlin, Swift, C, C++, C#, PHP, Ruby, Rust, Shell — via prebuilt
Tree-sitter grammars in `grammars/*.wasm` (no native compilation, fully
offline) plus the CoffeeScript lexer. Adding a language is one entry in
`src/parsers/registry.ts`.

## zero-coauthor

Blocks (`mode: block`, the default) any `Co-Authored-By:` trailer,
case-insensitive, via `commit-msg`. `mode: strip` rewrites the message instead
of blocking — the violation is never silently swallowed either way; `strip`
still reports what it removed.

## zero-ai-attribution

Pattern-matches attribution *context* (`generated|created|assisted ... by|with
... <product>`, known trailers, `AI-generated`, the 🤖 signature, known session
URLs), not bare provider names — `const provider = "Anthropic"` passes.
Provider families are configurable (`anthropic`, `openai`, `github-copilot`,
`cursor`), and `custom-patterns` accepts arbitrary regexes.

## Configuration

See `.silent-code.yml` at the repo root for the full default configuration
and comments on every option (this file documents the tool's own config
shape; it is not itself subject to zero-comments).

## Architecture

```
src/
  cli/            entrypoint, init, doctor, Claude hook handler
  core/            git plumbing, diff, config, ignore globs, result types
  policies/        zero-comments, zero-coauthor, zero-ai-attribution
  parsers/         language registry, Tree-sitter loader, CoffeeScript lexer
  integrations/    git-hooks (manager detection + safe install)
```

The core (`core/`, `policies/`, `parsers/`) has no dependency on Claude Code;
`cli/hook.ts` is the only Claude-specific integration point, so wiring this up
for Codex, OpenCode or Cursor is a new thin entrypoint over the same core.

`npm run build` produces `dist/cli.mjs` plus `dist/node_modules/` (the four
pure-JS runtime dependencies that stay external to the esbuild bundle,
vendored in so the plugin works from a plain `git clone` with no separate
`npm install` step) and `grammars/*.wasm`. All three are committed, since the
plugin is installed straight from this repository.
