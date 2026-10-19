# Adapters

How `scripts/recap.mjs` configures each agent. `ADAPTERS` in that file is the single source
of truth; this document records what gets touched, how strong the coverage is, and the
evidence behind every landing path.

`<home>` is a placeholder: the script resolves it through `os.homedir()` and never hardcodes
a user directory.

## Evidence tiers

Each adapter carries a `tier`, and `status` prints it:

- `local` — the landing path was read out of that tool's own installed code or data on a
  real machine (a bundle string, a binary string, or a source file in the venv). Where a
  runtime check was also possible, it is noted.
- `docs` — taken from the tool's official documentation, not exercised against a real install.
- `unverified` — guessed from convention. **`install` skips these unless `--experimental`.**

An adapter is only listed here if someone can point at the evidence recorded in the `Basis`
column. When a tool updates and an adapter stops matching, move it down a tier rather than
leaving a stale claim in place.

## Adapter table

| Agent | Mechanism | Managed path | Tier | Basis |
|---|---|---|---|---|
| OpenCode | Plugin hook appending the rules to the system prompt on every request | `<home>/.config/opencode/plugins/recap-line.js` | local | Plugin dir + `experimental.chat.system.transform` hook; the hook is experimental upstream |
| Claude Code | Global user instructions | `<home>/.claude/CLAUDE.md` | local | `CLAUDE.md` user memory file, loaded at session start |
| Codex CLI | Global rules file | `<home>/.codex/AGENTS.md` | local | Global `AGENTS.md` in `~/.codex` |
| Grok Build | Global rules file | `<home>/.grok/AGENTS.md` | local | Global `AGENTS.md` in `~/.grok` |
| Kimi Code | Global instructions collected at startup | `<home>/.kimi-code/AGENTS.md` | local | Verified on the installed build; older builds may not read this path |
| Gemini CLI | Global context file | `<home>/.gemini/GEMINI.md` | docs | gemini-cli docs, global context file `~/.gemini/GEMINI.md`; not exercised against a real install |
| dsh | `system-prompt` plugin override via `personaSuffix`, one patch entry per profile | `<home>/.dsh/profiles/*/cordis.patch.yml` | local | Verified with `dsh --profile headless --dump-config`; coupled to the 0.2.x profile-patch format |
| pi | Global instructions file | `<home>/.pi/agent/AGENTS.md` | local | Bundle lists `AGENTS.md` as a resource file name; global dir is `~/.pi/agent`. **Runtime confirmed** (`pi --print` reproduced the rule) |
| Command Code | Global user memory | `<home>/.commandcode/AGENTS.md` | local | Bundle `getUserMemoryPath()` = `~/.commandcode/AGENTS.md`, loaded as type `user`. **Runtime confirmed** on 1.82.3 |
| Qoder CLI | Global memory file | `<home>/.qoder/AGENTS.md` and/or `<home>/.qoder-cn/AGENTS.md` | local | Binary `[MemoryDiscovery] Found global memory file` = `join(configDir, "AGENTS.md")`; CN builds use `.qoder-cn`. **Runtime confirmed** — the agent named the file back |
| WorkBuddy | Global persona file, injected as `SoulContent` on the first turn | `<home>/.workbuddy/SOUL.md` | local | Bundle reads `IDENTITY.md`, `USER.md`, `SOUL.md`, `MEMORY.md` from the config dir; runtime logs list `SoulContent` / `SoulPath` in the prompt context variables. Persona file: no heading, `remove` never deletes it |
| Cline | Global rules directory | `<home>/Documents/Cline/Rules/recap.md` | local | Binary `resolveGlobalRulesConfigPaths()` / `resolveDocumentsClineDirectoryPath()` reads `~/Documents/Cline/Rules`; Cline also reads `~/.agents/AGENTS.md` |
| ZCode | Global instructions file | `<home>/.zcode/AGENTS.md` | local | Binary `getUserZcodeAgentsFilePath()` = `~/.zcode/AGENTS.md`; the client merges it before the workspace `AGENTS.md` |
| Cursor CLI | User rule file in the rules dir | `<home>/.cursor/rules/recap.mdc` | local | Bundle joins `homedir()` + `.cursor/rules` for scope `user` ("applies to all your projects"). `~/.cursor/AGENTS.md` is **not** read. Runtime unverified: needs an interactive `agent login` |
| Antigravity | Rules in the global customization root | `<home>/.gemini/config/AGENTS.md` | local | `language_server` documents `~/.gemini/config/` as the global customization root and `AGENTS.md`/`GEMINI.md` or `rules/` as its rule files |
| Hermes | Identity file, system-prompt slot #1 | `<home>/.hermes/SOUL.md` | local | `agent/prompt_builder.py` `load_soul_md()`. Persona file: no heading is added, `remove` never deletes it |
| misaka | Shared identity file, loaded before every role | `<home>/.misaka/MISAKA.md` | local | `misaka/config/home.py` `shared_soul` entry. Persona file: same handling as Hermes |
| Convention fallback | Cross-agent AGENTS.md convention, installed on every machine | `<home>/.agents/AGENTS.md` | local | Verified for Kimi Code; covers other convention followers as best effort |

Plus the mainstream adapters below, which stay inert until you actually install one of them.

## Mainstream adapters

Taken from each tool's official documentation. None of these was exercised against a real install, so
they are `docs` tier: `install` writes them when the tool's config dir is present, and nothing
at all happens until it is.

| Agent | Mechanism | Managed path | Basis |
|---|---|---|---|
| GitHub Copilot CLI | Global user instructions file | `<home>/.copilot/copilot-instructions.md` | User-level instructions live under `~/.copilot` (or `$COPILOT_HOME`); **`AGENTS.md` there is repo-scoped, not user-level** |
| Qwen Code | Global context file | `<home>/.qwen/QWEN.md` | Documented user-level context file |
| Crush | Global context files | `<home>/.config/crush/CRUSH.md` and `<home>/.config/AGENTS.md` | `internal/config` default `global_context_paths`; **not** `~/.config/crush/AGENTS.md`, which is not read by default |
| Amp | Global instructions file | `<home>/.config/amp/AGENTS.md` and `<home>/.config/AGENTS.md` | The XDG `~/.config/AGENTS.md` is always included |
| Zed Agent | Global instructions file | `<home>/.config/zed/AGENTS.md` | Documented user-level instructions file |
| Devin CLI | Global rules file | `<home>/.config/devin/AGENTS.md` | Documented rules location (`AGENT.md` also accepted) |
| Goose | Global hints file | `<home>/.config/goose/.goosehints` | Hints file is read by default; goose only reads `AGENTS.md` when `CONTEXT_FILE_NAMES` is configured |
| Windsurf Cascade | Global rules file | `<home>/.codeium/windsurf/memories/global_rules.md` | Documented global rules file; **this file has a 6,000-character cap** |
| Roo Code | Global rules directory | `<home>/.roo/rules/recap.md` | `~/.roo/rules/` is the fixed global rules dir; the file is this skill's own, so removal deletes it instead of editing your rules |
| Kiro CLI | Steering directory | `<home>/.kiro/steering/recap.md` | `~/.kiro/steering/*.md` is the user-level steering mechanism |
| Trae | Global rules directory | `<home>/.trae-cn/user_rules/recap.md` (IDE) and `<home>/.trae-cn/rules/recap.md` (CLI); `<home>/.trae/...` for international builds | docs.trae.cn names `~/.trae-cn/user_rules` as the IDE rule dir; Volcengine's TRAE CLI docs name `~/.trae-cn/rules`. Both are written when both exist |
| Kilo Code | Global rules directory | `<home>/.kilocode/rules/recap.md` | Docs: `~/.kilocode/rules/` is the global rules dir; the older `instructions` key in `~/.config/kilo/kilo.jsonc` is a config key, not a file we can own |
| Continue | Global rules directory | `<home>/.continue/rules/recap.md` | Docs: Config YAML Reference lists `~/.continue/rules` as the rules block dir; older VS Code builds ignored rules, so treat it as advisory |
| AGENTS.md convention | Cross-agent convention, installed on every machine | `<home>/.agents/AGENTS.md` | Covered above under `local` |

`dirmd` adapters (Roo, Kiro) write a file the tool's rules directory owns outright, so there is
no marked region to maintain inside a file the user authored.

## Not included, and why

An adapter that writes a file nobody reads is worse than no adapter, so these are deliberately
absent:

- **iFlow CLI** (`~/.iflow/IFLOW.md`) — the product was shut down; users were told to migrate.
- **Amazon Q Developer CLI** — no longer exists as such; the Q CLI became the Kiro CLI, and the
  old `~/.aws/amazonq/` has no rules file. Covered through Kiro.
- **OpenHands** — always-on user-level instructions have no plain file mechanism; user content
  goes through skills/microagents.
- **CodeBuddy** — shipped but `unverified`, so `install` skips it without `--experimental`: the
  CLI clearly references a `CODEBUDDY.md` user memory, but the home-directory composition is
  obfuscated and was never confirmed.

## Coverage strength

- Deterministic, injected into the system prompt on every request: the OpenCode plugin and
  the dsh `personaSuffix` override.
- Session-level, loaded when the agent starts with advisory wording: every markdown adapter,
  including the Cursor `.mdc` rule, the Roo / Kiro / Trae / Cline / Kilo / Continue
  rules-directory files, and the Hermes / misaka / WorkBuddy identity files.
- Convention fallback, only for agents that collect the convention path:
  `<home>/.agents/AGENTS.md`.

When reporting coverage to the user, name the tier each agent lands in.

## Persona files

Hermes `SOUL.md`, misaka `MISAKA.md` and WorkBuddy `SOUL.md` are identity files, not rules
files. They carry `header: false`, so the block is appended without the "Global Agent
Instructions" heading, and removal strips only the marked region — a persona file this skill
did not create is never deleted. Users who do not want standing task rules inside their
persona should `install --skip=hermes,misaka,workbuddy`.

## Detection

`detect()` answers "is this harness here?" by checking the config dir **or** an executable of
a known name on `PATH`. Writing still requires a real landing dir: an adapter that is detected
but has no landing directory reports `no landing dir` and creates nothing, so a stray binary
never produces a phantom config tree.

## Per-agent verification

- OpenCode: the plugin file exists and starts with `// recap:managed`.
- dsh: `dsh --profile headless --dump-config | grep -A3 system-prompt` shows the new
  `personaSuffix`.
- Markdown adapters: the file contains exactly one `recap:begin` marker.
- Cursor: `<home>/.cursor/rules/recap.mdc` starts with frontmatter containing
  `alwaysApply: true`.
- WorkBuddy: `<home>/.workbuddy/SOUL.md` keeps its frontmatter and contains exactly one
  `recap:begin` marker.
- Trae: `recap.md` exists under `<home>/.trae-cn/user_rules/` and/or `<home>/.trae-cn/rules/`
  (or the `.trae` equivalents).
- Cline: `<home>/Documents/Cline/Rules/recap.md` contains exactly one `recap:begin` marker.
- Kilo Code: `<home>/.kilocode/rules/recap.md` contains exactly one `recap:begin` marker.
- Continue: `<home>/.continue/rules/recap.md` exists and is shaped like a Continue rule file.
- ZCode: `<home>/.zcode/AGENTS.md` contains exactly one `recap:begin` marker.
- Runtime spot-check for markdown adapters, when the CLI has a headless mode:
  `cmd -p --no-session`, `pi --print`, `qoderclicn -p`, `agent -p --mode ask` each answer a
  throwaway question; the reply should end with the `🏁 **recap:**` and `➡️ **Next:**` lines. A missing line on a
  one-word answer is model adherence, not a broken adapter — ask the agent to quote the
  "Reply Closing (Recap)" section instead.

## Drift risks

- The OpenCode hook is marked experimental upstream.
- The dsh patch format and plugin id belong to dsh 0.2.x.
- Kimi, Gemini, Cursor and Qoder paths come from each loader's behavior between versions.
- Qoder keeps two possible config dir names (`.qoder`, `.qoder-cn`); both are written when
  both exist.
- Cursor could ship a real global `AGENTS.md` reader later; that would be the better target.
- Hermes reads `AGENTS.md` per project but only `SOUL.md` globally, so the persona file is the
  only global option there.
- Windsurf's `global_rules.md` is capped at 6,000 characters, so a long hand-edited file can
  push the block out; the product is also rebranding toward Devin Desktop.
- Crush is migrating its config surface (the `crush.json` era is deprecated); its global context
  paths are the ones that moved.
- Kiro inherited the Amazon Q CLI, so older write-ups naming `~/.aws/amazonq` are wrong now.
- Trae's IDE and CLI docs disagree on the global rules directory (`user_rules` vs `rules`);
  the adapter writes every such dir that already exists and defaults to `user_rules`.
- WorkBuddy's UI global rules are injected as `scenarioRules` from its own store, not a file;
  `SOUL.md` is the stable plain-file slot, and it doubles as the persona.
- Cline resolves `~/Documents/Cline` through a redirected-Documents check; an iCloud or
  relocated Documents folder can move the rules dir.
- Continue's rules loading has had regressions in the VS Code extension; the file is written
  as an advisory rule, not a guaranteed injection.
- Kilo Code moved global rules from a JSON `instructions` key to `~/.kilocode/rules/`; the
  adapter targets the directory form.

If an adapter stops working after an agent update, the convention fallback still carries the
rules: report the gap and update the adapter, and drop the tier until the path is re-confirmed.
