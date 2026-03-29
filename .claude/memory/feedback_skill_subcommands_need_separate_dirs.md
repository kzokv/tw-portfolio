---
name: skill subcommands need separate directories
description: Claude Code skills with subcommands (e.g. /aaa:init) must be separate directories, not sections in one skill.md
type: feedback
---

Claude Code skills with subcommand-style invocation (e.g. `/aaa:init`, `/aaa:add`) must each be a separate directory under `.codex/skills/`, not sections within a single `skill.md`.

Pattern: `aaa-init/skill.md`, `aaa-add/skill.md`, etc. — matching the `si-review`, `si-promote` pattern.

Skills must be created in `/Users/lume/repos/agent-dock/.codex/skills/` (the agent-dock source), not directly in `~/.claude/skills/` (the symlink target).

**Why:** A single `skill.md` with subcommand sections only registers the top-level skill name in the autocomplete dropdown. Individual subcommands don't appear unless they're separate skill directories.

**How to apply:** When creating skills with subcommands, create one directory per invocable command. The base skill can remain as a shared reference.
