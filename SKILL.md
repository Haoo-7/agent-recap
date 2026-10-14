---
name: agent-recap
description: >-
  Install, update, or remove the end-of-reply recap convention — a final "🏁 recap:" line
  saying what the turn did, plus a "Next:" line with the next step — across the AI coding
  agents installed on this machine (OpenCode, Claude Code, Codex, Grok, Kimi Code, dsh,
  Gemini CLI, and agents following the AGENTS.md convention). Use when the user wants
  agents to close substantive replies with a short recap and next step, asks to set up,
  change (prefix, sentence count, wording), or remove that behavior machine-wide, or
  complains that replies ramble without saying what comes next. Do not use for one-off
  summaries of the current conversation, for changing any other reply behavior, or for
  editing one agent's config by hand.
license: MIT
metadata:
  version: "0.1.0"
---

# Agent Recap

One behavior, every agent: substantive replies end with a compact handoff line.

```text
🏁 recap: Wired the recap convention into every agent found on this machine via its native mechanism.
Next: restart each agent, then run the status command to confirm coverage.
```

## What gets installed

Every agent is configured through its own native mechanism, and the recap rules always land
in a marked region, so the setup stays repeatable and removable. The adapter table, managed
paths, coverage strength, and per-agent verification commands live in
[references/adapters.md](references/adapters.md) — read that file when you need adapter
details. It also records which adapters are verified and against which agent versions.

Never hand-edit an agent's config files. The script is the single source of truth.

## Workflow

Run every command from this skill's directory.

```bash
node scripts/recap.mjs install   # detect installed agents, apply each native mechanism
node scripts/recap.mjs status    # per-agent coverage table
node scripts/recap.mjs remove    # strip everything this skill manages
```

Any subcommand accepts `--dry-run` to print planned changes without writing. Prefer
`--dry-run` first on an unfamiliar machine or when the user seems cautious.

### Rules while running this skill

- Always go through `scripts/recap.mjs`; never edit agent config files by hand.
- `install` is idempotent: managed blocks are wrapped in `<!-- recap:begin -->` /
  `<!-- recap:end -->` markers, so re-running updates in place and never appends a
  duplicate. Legacy unmarked sections (heading "回复收尾" or "Reply Closing") migrate
  automatically.
- After installing, report the coverage table. Say plainly which agents are covered only
  by the convention fallback.
- Tell the user that every agent needs a restart to pick up the change.
- Touch nothing outside the user's home directory. A foreign file sharing a managed path
  (a plugin from another project) is backed up, never deleted.

## Changing the format

Edit `CONFIG` at the top of `scripts/recap.mjs` (`prefix`, `nextLabel`, `maxSentences`),
then re-run `install`. The markers make every agent update in place; there is no
remove-and-reinstall dance.

## Verifying

`status` reports `installed` / `legacy` / `absent` per agent. Per-agent verification
commands are in [references/adapters.md](references/adapters.md).

## Uninstall

`remove` strips the marked regions everywhere, deletes the managed OpenCode plugin file,
and deletes config files this skill created wholesale. Files with pre-existing user
content keep everything except the marked region.

## Compatibility

The script is Node.js with the standard library only, resolving the home directory through
`os.homedir()` — no network, no dependencies, no hardcoded user paths. Verified on macOS
with a current Node.js; other platforms are unverified. Adapters are verified individually
as recorded in [references/adapters.md](references/adapters.md); treat unverified adapters
as best effort.
