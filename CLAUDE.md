## Silent Code Repository Policies

This repository enforces:

- zero-comments
- zero-coauthor
- zero-ai-attribution

Do not introduce source-code comments.

Do not add AI attribution, AI-generated notices, Co-Authored-By trailers or
agent session links.

Automated hooks enforce these policies at the tool-call, commit and push
level. If a hook rejects a change, correct the violation rather than
bypassing it.
