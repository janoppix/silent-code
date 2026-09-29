# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added
- Core policy engine: `zero-comments`, `zero-coauthor`, `zero-ai-attribution`.
- Tree-sitter-based comment extraction (JavaScript, TypeScript, JSX, TSX,
  Python, Go, Java, Kotlin, Swift, C, C++, C#, PHP, Ruby, Rust, Shell) plus a
  dedicated CoffeeScript lexer.
- `zero-comments` flags only comments introduced by the current change,
  tolerating moved/reindented pre-existing comments, with a configurable
  technical-exception allowlist (shebang, `@ts-ignore`, `noqa`, Go directives,
  pragmas, custom regexes).
- `zero-coauthor`: blocks (default) or strips `Co-Authored-By:` trailers.
- `zero-ai-attribution`: contextual pattern matching (verb + preposition +
  product, known trailers, `AI-generated`, signature emoji, known session
  URLs), configurable by provider family and custom regexes.
- CLI: `init`, `check` (`--staged` / `--range`), `check-comments`,
  `check-message`, `doctor`, `hook`.
- Claude Code plugin: `PostToolUse` hook on `Write|Edit|MultiEdit|NotebookEdit`
  and `PreToolUse` hook on `Bash`, covering `git commit` (plain `-m`,
  heredoc-composed messages, `-F <file>`) and `gh pr create|edit`
  (`--title`/`--body`/`--body-file`).
- Git hook installer with safe integration for husky, lefthook, python
  pre-commit and simple-git-hooks, falling back to direct `.git/hooks/`
  installation (respecting `core.hooksPath`) without overwriting existing
  hooks.
- GitHub Actions integration: composite `action.yml` and a copyable workflow
  template, both checking the diff, commit messages and PR title/body.
- `dist/` ships fully self-contained (bundle + vendored runtime deps +
  Tree-sitter grammars), so the Claude Code plugin works from a plain
  `git clone` with no `npm install` step.
