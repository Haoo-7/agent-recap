# Adapters

How `scripts/recap.mjs` configures each agent. The script is the single source of truth;
this file records what gets touched, how strong the coverage is, and what is verified.

`<home>` is a placeholder: the script resolves it through `os.homedir()` and never
hardcodes a user directory.

## Adapter table

| Agent | Mechanism | Managed path | Verification |
|---|---|---|---|
| OpenCode | Plugin hook appending the rules to the system prompt on every request | `<home>/.config/opencode/plugins/recap-line.js` | Verified. Uses the `experimental.chat.system.transform` hook, which may change between releases |
| Claude Code | Global user instructions | `<home>/.claude/CLAUDE.md` | Verified |
| Codex | Global rules file | `<home>/.codex/AGENTS.md` | Verified |
| Grok | Global rules file | `<home>/.grok/AGENTS.md` | Verified |
| Kimi Code | Global instructions collected at startup | `<home>/.kimi-code/AGENTS.md` | Verified on the installed build; older builds may not read this path |
| dsh | `system-prompt` plugin override via `personaSuffix`, one patch entry per profile | `<home>/.dsh/profiles/*/cordis.patch.yml` | Verified with `dsh --profile headless --dump-config`; coupled to the profile-patch format of dsh 0.2.x |
| Gemini CLI | Global context file following the tool's convention | `<home>/.gemini/GEMINI.md` | Unverified — convention-based, never confirmed against a live install |
| Convention fallback | The cross-agent AGENTS.md convention, installed on every machine | `<home>/.agents/AGENTS.md` | Verified for Kimi Code; covers other convention followers as best effort |

## Coverage strength

- Deterministic, injected into the system prompt on every request: the OpenCode plugin and
  the dsh `personaSuffix` override.
- Session-level, loaded when the agent starts with advisory wording: the markdown
  instruction files.
- Convention fallback, only for agents that collect the convention path:
  `<home>/.agents/AGENTS.md`.

When reporting coverage to the user, name the tier each agent lands in.

## Per-agent verification

- OpenCode: the plugin file exists and starts with `// recap:managed`.
- dsh: `dsh --profile headless --dump-config | grep -A3 system-prompt` shows the new
  `personaSuffix`.
- Markdown adapters: the file contains exactly one `recap:begin` marker.

## Drift risks

- The OpenCode hook is marked experimental upstream.
- The dsh patch format and plugin id belong to dsh 0.2.x.
- Kimi and Gemini adapter paths come from each tool's loader behavior, which can change
  between versions.

If an adapter stops working after an agent update, the convention fallback still carries
the rules: report the gap and update the adapter.
