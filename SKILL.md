---
name: agent-recap
description: >-
  Install, update, or remove the end-of-reply recap convention — a final "🏁 **recap:**" line
  saying what the turn did, plus a "➡️ **Next:**" line with the next step — across the AI coding
  agents installed on this machine: OpenCode, Claude Code, Codex, Gemini CLI, Grok, Kimi
  Code, dsh, pi, Command Code, Qoder CLI, Cursor CLI, Antigravity, Hermes and misaka, plus
  documentation-backed adapters for GitHub Copilot CLI, Qwen Code, Crush, Amp, Zed, Devin
  CLI, Goose, Windsurf, Roo Code and Kiro, and the AGENTS.md convention. Use when the user
  wants agents to close substantive replies with a short recap and next step, asks to set
  up, change (prefix, sentence count, wording), skip, or remove that behavior machine-wide,
  or complains that replies ramble without saying what comes next. Do not use for one-off
  summaries of the current conversation, for changing any other reply behavior, or for
  editing one agent's config by hand.
license: MIT
metadata:
  version: "0.2.0"
---

# Agent Recap

One behavior, every agent: substantive replies end with a compact handoff line.

```text
🏁 **recap:** Wired the recap convention into every agent found on this machine via its native mechanism.
➡️ **Next:** restart each agent, then run the status command to confirm coverage.
```

## What gets installed

Every agent is configured through its own native mechanism — a marked region in its global
instruction file, a Cursor `.mdc` user rule, a file inside a rules directory, the OpenCode
plugin, or a dsh profile patch — so the setup stays repeatable and removable. The adapter
table, managed paths, coverage strength, evidence tier and per-agent verification commands
live in [references/adapters.md](references/adapters.md) — read that file when you need
adapter details.

Each adapter records the evidence for its landing path. `local` means the path was read out of
that tool's installed code on a real machine, `docs` means it comes from official documentation,
and `unverified` adapters are skipped unless `--experimental`. Never add a path you cannot cite.

Never hand-edit an agent's config files. The script is the single source of truth.

## Workflow

Run every command from this skill's directory.

```bash
node scripts/recap.mjs install                    # detect installed agents, apply each native mechanism
node scripts/recap.mjs status                     # per-agent coverage table, with the evidence tier
node scripts/recap.mjs remove                     # strip everything this skill manages
node scripts/recap.mjs install --skip=hermes,misaka   # leave named agents untouched
node scripts/recap.mjs install --experimental     # also write unverified adapters
```

Any subcommand accepts `--dry-run` to print planned changes without writing. Prefer
`--dry-run` first on an unfamiliar machine or when the user seems cautious.

### Rules while running this skill

- Always go through `scripts/recap.mjs`; never edit agent config files by hand.
- `install` is idempotent: managed blocks are wrapped in `<!-- recap:begin -->` /
  `<!-- recap:end -->` markers, so re-running updates in place and never appends a
  duplicate. Legacy unmarked sections (heading "回复收尾" or "Reply Closing") migrate
  automatically. Rules-directory adapters (Roo, Kiro) own their whole file instead.
- After installing, report the coverage table. Say plainly which agents are covered only
  by the convention fallback, and which landed in the `docs` tier rather than being read
  out of installed code.
- Hermes `SOUL.md` and misaka `MISAKA.md` are identity files. The block is appended without a
  heading, and removal never deletes them. If the user does not want task rules inside a
  persona, use `--skip=hermes,misaka`.
- A harness that is detected but has no landing directory gets nothing written: report it as
  `no landing dir`, do not create the tool's config tree.
- Tell the user that every agent needs a restart to pick up the change.
- Touch nothing outside the user's home directory. A foreign file sharing a managed path
  (a plugin or rule from another project) is backed up, never deleted.

## Changing the format

Edit `CONFIG` at the top of `scripts/recap.mjs` (`prefix`, `nextLabel`, `maxSentences`),
then re-run `install`. The markers make every agent update in place; there is no
remove-and-reinstall dance.

## Verifying

`status` reports `installed` / `legacy` / `absent` / `no landing dir` per agent, plus its
evidence tier. Per-agent verification commands, including the headless spot-check that proves a
markdown adapter is really loaded, are in [references/adapters.md](references/adapters.md).

## Uninstall

`remove` strips the marked regions everywhere, deletes the managed OpenCode plugin, the Cursor
`.mdc` rule and the rules-directory files, and deletes config files this skill created
wholesale. Files with pre-existing user content — including the Hermes and misaka persona
files — keep everything except the marked region.

## Compatibility

The script is Node.js with the standard library only, resolving the home directory through
`os.homedir()` — no network, no dependencies, no hardcoded user paths. Verified on macOS
with a current Node.js; other platforms are unverified. Adapters carry their own evidence
tier, and `unverified` ones stay off unless `--experimental`; mainstream adapters that are not
installed here are documented, not exercised. See
[references/adapters.md](references/adapters.md) for what has actually been confirmed.
