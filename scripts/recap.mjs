#!/usr/bin/env node
/**
 * recap.mjs — manage the end-of-reply recap convention across AI coding agents.
 *
 *   node recap.mjs install [--dry-run] [--skip=id,id] [--experimental]
 *   node recap.mjs status  [--skip=id,id] [--experimental]
 *   node recap.mjs remove  [--dry-run] [--skip=id,id] [--experimental]
 *
 * Idempotent by design: every managed block is wrapped in recap:begin / recap:end
 * markers, so re-running install updates the region in place instead of appending
 * a duplicate. Unmarked legacy sections (heading "回复收尾" or "Reply Closing") are
 * migrated automatically on install.
 *
 * Each adapter records the evidence for its landing path (`basis`) and how far to
 * trust it (`tier`):
 *   local      — read out of the installed tool's own code or data on this machine
 *   docs       — from the tool's official documentation, not exercised here
 *   unverified — best effort; skipped unless --experimental
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const HOME = os.homedir();
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const EXPERIMENTAL = argv.includes('--experimental');
const CMD = argv.find((a) => ['install', 'status', 'remove'].includes(a)) ?? 'install';
const SKIP = new Set(argv.filter((a) => a.startsWith('--skip='))
  .flatMap((a) => a.slice('--skip='.length).split(','))
  .filter(Boolean));

const CONFIG = {
  prefix: '🏁 recap:',
  nextLabel: 'Next:',
  maxSentences: 2,
};

const BEGIN = '<!-- recap:begin -->';
const END = '<!-- recap:end -->';
const MANAGED = '<!-- recap:managed -->';
const DSH_BEGIN = '# recap:begin';
const DSH_END = '# recap:end';

const RULES = [
  `End every substantive reply with a final line beginning "${CONFIG.prefix}" as a handoff summary.`,
  'First sentence: what this turn was about and why, not a completion receipt like "done".',
  `Second sentence beginning "${CONFIG.nextLabel}": the immediate state, blocker, decision, or recommended next move; write "none" if there is nothing.`,
  'Write it like a verbal handoff between collaborators: specific and context-continuing, not a status report.',
  `Keep the whole recap to at most ${CONFIG.maxSentences} sentences.`,
  'Skip greetings and pure clarifying questions.',
];

const RECAP_HEADING = 'Reply Closing (Recap)';

const mdRegion = () =>
  [BEGIN, `## ${RECAP_HEADING}`, '', ...RULES.map((r) => `- ${r}`), '', END].join('\n');

const flatRules = () => RULES.join(' ');

const abs = (root, ...segs) => path.join(root, ...segs);
const tilde = (p) => p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p;
const exists = (p) => fs.existsSync(p);
const dir = (root, ...segs) => {
  try { return fs.statSync(abs(root, ...segs)).isDirectory(); } catch { return false; }
};
const hasBin = (...names) =>
  (process.env.PATH ?? '').split(path.delimiter).some((bin) =>
    names.some((name) => {
      try {
        const p = path.join(bin, name);
        fs.accessSync(p, fs.constants.X_OK);
        return fs.statSync(p).isFile();
      } catch { return false; }
    }));

// Landing paths live inside the tool's own config dir. A stray binary must never create
// that tree: detection may use hasBin, but writing requires the dir.
const inConfigDir = (root, configDir, ...rest) =>
  dir(root, configDir) ? [abs(root, configDir, ...rest)] : [];

// Some tools keep rules in a subdirectory that only appears once the first rule is saved.
// Writing there is fine while the tool's own config dir is present; a stray binary or an
// unconfirmed alternate dir must not create the whole tree.
const underAny = (root, pairs) => {
  const hit = pairs.find(([parent]) => dir(root, parent));
  return hit ? [abs(root, hit[1])] : [];
};

function write(p, content) {
  if (DRY) return;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

const stripRegion = (text, begin, end) =>
  text.replace(new RegExp(`\\n?${begin}[\\s\\S]*?${end}\\n?`), '');

function stripLegacySection(text) {
  const out = [];
  let skipping = false;
  for (const line of text.split('\n')) {
    if (/^#{1,6}\s*(回复收尾|Reply Closing)/.test(line)) { skipping = true; continue; }
    if (skipping && /^#{1,6}\s/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

// ---- per-agent managed content ------------------------------------------------

function pluginSource() {
  return `// recap:managed by the agent-recap skill. Delete this file to disable the recap convention.
const recapConfig = {
  prefix: ${JSON.stringify(CONFIG.prefix)},
  maxCharacters: 280,
};

const recapInstruction = ${JSON.stringify(flatRules())};

const RecapLinePlugin = async () => ({
  "experimental.chat.system.transform": async (_input, output) => {
    output.system.push(recapInstruction);
  },
});

export default RecapLinePlugin;
`;
}

function dshBlock() {
  const suffix = `Your working directory is {{cwd}}. ${flatRules()}`;
  return [
    DSH_BEGIN,
    '- id: system-prompt',
    "  name: '@deepseek-ai/dsh-system-prompt'",
    '  config:',
    '    personaPrefix: You are a coding agent powered by the {{model}} model.',
    `    personaSuffix: '${suffix}'`,
    DSH_END,
  ].join('\n');
}

function mdcSource() {
  return [
    '---',
    'description: End-of-reply recap convention (managed by the agent-recap skill)',
    'globs:',
    'alwaysApply: true',
    '---',
    '',
    MANAGED,
    mdRegion(),
    '',
  ].join('\n');
}

// ---- markdown-file agents ------------------------------------------------------

const FRESH_HEADER = `${MANAGED}\n# Global Agent Instructions\n\n`;

function ensureMd(file, { header = true } = {}) {
  const fresh = !exists(file);
  const before = fresh ? (header ? FRESH_HEADER : `${MANAGED}\n`) : fs.readFileSync(file, 'utf8');
  let text = stripRegion(before, BEGIN, END);
  text = stripLegacySection(text);
  text = text.replace(/\s+$/, '') + '\n\n' + mdRegion() + '\n';
  const changed = text !== before;
  if (changed) write(file, text);
  const state = !changed ? 'ok' : fresh ? 'created' : DRY ? 'would-change' : 'updated';
  return { file, state };
}

function removeMd(file) {
  if (!exists(file)) return { file, state: 'absent' };
  const before = fs.readFileSync(file, 'utf8');
  const text = stripRegion(before, BEGIN, END);
  const onlyManaged = text
    .split('\n')
    .every((l) => ['', MANAGED, '# Global Agent Instructions'].includes(l.trim()));
  if (onlyManaged) {
    if (!DRY) fs.rmSync(file);
    return { file, state: DRY ? 'would-delete' : 'deleted' };
  }
  const changed = text !== before;
  if (changed) write(file, text);
  return { file, state: changed ? (DRY ? 'would-strip' : 'stripped') : 'ok' };
}

function mdState(file) {
  if (!exists(file)) return 'absent';
  const t = fs.readFileSync(file, 'utf8');
  if (t.includes(BEGIN) && t.includes(END)) return 'installed';
  if (/^#{1,6}\s*(回复收尾|Reply Closing)/m.test(t)) return 'legacy';
  return 'absent';
}

// ---- cursor user rules (.mdc) ---------------------------------------------------

function ensureMdc(file) {
  if (!exists(file)) {
    write(file, mdcSource());
    return { file, state: DRY ? 'would-create' : 'created' };
  }
  const cur = fs.readFileSync(file, 'utf8');
  if (cur.includes(MANAGED)) {
    const changed = cur !== mdcSource();
    if (changed) write(file, mdcSource());
    return { file, state: !changed ? 'ok' : DRY ? 'would-change' : 'updated' };
  }
  const bak = DRY ? '<backup path not written in dry-run>'
    : (fs.copyFileSync(file, `${file}.bak-${Date.now()}`), `${tilde(file)}.bak-${Date.now()}`);
  write(file, mdcSource());
  return { file, state: DRY ? 'would-replace' : `replaced (backup: ${bak})` };
}

function removeMdc(file) {
  if (!exists(file)) return { file, state: 'absent' };
  if (!fs.readFileSync(file, 'utf8').includes(MANAGED)) return { file, state: 'foreign, kept' };
  if (!DRY) fs.rmSync(file);
  return { file, state: DRY ? 'would-delete' : 'deleted' };
}

function mdcState(file) {
  if (!exists(file)) return 'absent';
  const t = fs.readFileSync(file, 'utf8');
  if (t.includes(MANAGED) && t.includes(BEGIN) && t.includes(END)) return 'installed';
  return 'foreign';
}

// ---- rules-directory agents (one dedicated file per convention) ------------------
// Roo / Kiro style tools apply every *.md in a global rules dir. These adapters own one
// file inside that dir, so removal deletes the file instead of editing user rules.

const DIR_MANAGED = `${MANAGED} rules-dir file, managed by the agent-recap skill`;

function dirMdSource() {
  return [DIR_MANAGED, '', `# ${RECAP_HEADING}`, '', ...RULES.map((r) => `- ${r}`), ''].join('\n');
}

function ensureDirMd(file) {
  if (!exists(file)) {
    write(file, dirMdSource());
    return { file, state: DRY ? 'would-create' : 'created' };
  }
  const cur = fs.readFileSync(file, 'utf8');
  if (cur.includes(DIR_MANAGED)) {
    const changed = cur !== dirMdSource();
    if (changed) write(file, dirMdSource());
    return { file, state: !changed ? 'ok' : DRY ? 'would-change' : 'updated' };
  }
  const bak = DRY ? '<backup path not written in dry-run>'
    : (fs.copyFileSync(file, `${file}.bak-${Date.now()}`), `${tilde(file)}.bak-${Date.now()}`);
  write(file, dirMdSource());
  return { file, state: DRY ? 'would-replace' : `replaced (backup: ${bak})` };
}

function removeDirMd(file) {
  if (!exists(file)) return { file, state: 'absent' };
  if (!fs.readFileSync(file, 'utf8').includes(DIR_MANAGED)) return { file, state: 'foreign, kept' };
  if (!DRY) fs.rmSync(file);
  return { file, state: DRY ? 'would-delete' : 'deleted' };
}

function dirMdState(file) {
  if (!exists(file)) return 'absent';
  const t = fs.readFileSync(file, 'utf8');
  return t.includes(DIR_MANAGED) ? 'installed' : 'foreign';
}

// ---- dsh ------------------------------------------------------------------------

function dshProfiles(root) {
  const dirRoot = abs(root, '.dsh/profiles');
  if (!exists(dirRoot)) return [];
  try {
    if (!fs.statSync(dirRoot).isDirectory()) return [];
  } catch { return []; }
  return fs.readdirSync(dirRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'node_modules')
    .map((d) => path.join(dirRoot, d.name, 'cordis.patch.yml'));
}

function stripLegacyDsh(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (/^- id:\s*system-prompt\b/.test(lines[i])) {
      if (out.length && /^#.*(recap|回复收尾)/i.test(out[out.length - 1])) out.pop();
      i++;
      while (i < lines.length && !/^(- id:|^- insert:|# recap:)/.test(lines[i])) i++;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join('\n');
}

function ensureDsh(file) {
  const fresh = !exists(file);
  const before = fresh
    ? '# Your patch layer for this dsh profile.\n'
    : fs.readFileSync(file, 'utf8');
  let text = stripRegion(before, DSH_BEGIN, DSH_END);
  text = stripLegacyDsh(text);
  text = text.replace(/\s+$/, '') + '\n\n' + dshBlock() + '\n';
  const changed = text !== before;
  if (changed) write(file, text);
  return { file, state: !changed ? 'ok' : fresh ? 'created' : DRY ? 'would-change' : 'updated' };
}

function removeDsh(file) {
  if (!exists(file)) return { file, state: 'absent' };
  const before = fs.readFileSync(file, 'utf8');
  let text = stripRegion(before, DSH_BEGIN, DSH_END);
  text = stripLegacyDsh(text);
  const changed = text.replace(/\s+$/, '') !== before.replace(/\s+$/, '');
  if (changed) write(file, text);
  return { file, state: changed ? (DRY ? 'would-strip' : 'stripped') : 'ok' };
}

function dshState(file) {
  if (!exists(file)) return 'absent';
  const t = fs.readFileSync(file, 'utf8');
  if (t.includes(DSH_BEGIN) && t.includes(DSH_END)) return 'installed';
  if (/^- id:\s*system-prompt\b/m.test(t)) return 'legacy';
  return 'absent';
}

// ---- opencode plugin ------------------------------------------------------------

function ensurePlugin(file) {
  if (!exists(file)) {
    write(file, pluginSource());
    return { file, state: DRY ? 'would-create' : 'created' };
  }
  const cur = fs.readFileSync(file, 'utf8');
  if (cur.includes('recap:managed')) {
    const changed = cur !== pluginSource();
    if (changed) write(file, pluginSource());
    return { file, state: !changed ? 'ok' : DRY ? 'would-change' : 'updated' };
  }
  const bak = DRY ? '<backup path not written in dry-run>'
    : (fs.copyFileSync(file, `${file}.bak-${Date.now()}`), `${tilde(file)}.bak-${Date.now()}`);
  write(file, pluginSource());
  return { file, state: DRY ? 'would-replace' : `replaced (backup: ${bak})` };
}

function removePlugin(file) {
  if (!exists(file)) return { file, state: 'absent' };
  if (!fs.readFileSync(file, 'utf8').includes('recap:managed')) {
    return { file, state: 'foreign, kept' };
  }
  if (!DRY) fs.rmSync(file);
  return { file, state: DRY ? 'would-delete' : 'deleted' };
}

function pluginState(file) {
  if (!exists(file)) return 'absent';
  return fs.readFileSync(file, 'utf8').includes('recap:managed') ? 'installed' : 'foreign';
}

// ---- agent table -----------------------------------------------------------------
// One entry per harness. `detect(root)` answers "is this harness here?", `files(root)`
// returns the landing paths to write, `basis` is the evidence for that path.

export const ADAPTERS = [
  {
    id: 'opencode', label: 'OpenCode', kind: 'plugin', tier: 'local',
    detect: (h) => dir(h, '.config/opencode') || dir(h, '.opencode') || hasBin('opencode'),
    files: (h) => [abs(h, '.config/opencode/plugins/recap-line.js')],
    basis: 'plugin dir; experimental.chat.system.transform hook (experimental upstream)',
  },
  {
    id: 'claude', label: 'Claude Code', kind: 'md', tier: 'local',
    detect: (h) => dir(h, '.claude') || hasBin('claude'),
    files: (h) => inConfigDir(h, '.claude', 'CLAUDE.md'),
    basis: 'CLAUDE.md user memory file, loaded at session start',
  },
  {
    id: 'codex', label: 'Codex CLI', kind: 'md', tier: 'local',
    detect: (h) => dir(h, '.codex') || hasBin('codex'),
    files: (h) => inConfigDir(h, '.codex', 'AGENTS.md'),
    basis: 'global AGENTS.md in ~/.codex',
  },
  {
    id: 'grok', label: 'Grok Build', kind: 'md', tier: 'local',
    detect: (h) => dir(h, '.grok') || hasBin('grok'),
    files: (h) => inConfigDir(h, '.grok', 'AGENTS.md'),
    basis: 'global AGENTS.md in ~/.grok',
  },
  {
    id: 'kimi', label: 'Kimi Code', kind: 'md', tier: 'local',
    detect: (h) => dir(h, '.kimi-code') || dir(h, '.kimi') || hasBin('kimi'),
    files: (h) => inConfigDir(h, '.kimi-code', 'AGENTS.md'),
    basis: 'global instructions collected at startup (older builds may miss this path)',
  },
  {
    id: 'gemini', label: 'Gemini CLI', kind: 'md', tier: 'docs',
    detect: (h) => dir(h, '.gemini') || hasBin('gemini'),
    files: (h) => inConfigDir(h, '.gemini', 'GEMINI.md'),
    basis: 'gemini-cli docs: global context file ~/.gemini/GEMINI.md',
  },
  {
    id: 'dsh', label: 'DeepSeek Harness', kind: 'dsh', tier: 'local',
    detect: (h) => dir(h, '.dsh/profiles'),
    files: dshProfiles,
    basis: 'system-prompt plugin personaSuffix in per-profile cordis.patch.yml (0.2.x)',
  },
  {
    id: 'pi', label: 'pi', kind: 'md', tier: 'local',
    detect: (h) => dir(h, '.pi/agent') || hasBin('pi'),
    files: (h) => inConfigDir(h, '.pi/agent', 'AGENTS.md'),
    basis: 'bundle: AGENTS.md is a resource file name; global dir is ~/.pi/agent',
  },
  {
    id: 'commandcode', label: 'Command Code', kind: 'md', tier: 'local',
    detect: (h) => dir(h, '.commandcode') || hasBin('cmd', 'cmdc', 'command-code', 'commandcode'),
    files: (h) => inConfigDir(h, '.commandcode', 'AGENTS.md'),
    basis: 'bundle: getUserMemoryPath() = ~/.commandcode/AGENTS.md, loaded as type "user"',
  },
  {
    id: 'qoder', label: 'Qoder CLI', kind: 'md', tier: 'local',
    detect: (h) => dir(h, '.qoder') || dir(h, '.qoder-cn') || hasBin('qoder', 'qoderclicn'),
    files: (h) => ['.qoder', '.qoder-cn'].filter((d) => dir(h, d)).map((d) => abs(h, d, 'AGENTS.md')),
    basis: 'binary: MemoryDiscovery global memory = join(configDir, "AGENTS.md"); CN dir is .qoder-cn',
  },
  {
    id: 'antigravity', label: 'Antigravity', kind: 'md', tier: 'local',
    detect: (h) => dir(h, '.gemini/antigravity') || dir(h, '.antigravity'),
    files: (h) => underAny(h, [['.gemini', '.gemini/config/AGENTS.md']]),
    basis: 'language_server docs: global customization root is ~/.gemini/config/, rules are '
      + 'standalone AGENTS.md / GEMINI.md or a rules/ dir',
  },
  {
    id: 'cursor', label: 'Cursor CLI', kind: 'mdc', tier: 'local',
    detect: (h) => dir(h, '.cursor') || hasBin('cursor-agent'),
    files: (h) => underAny(h, [['.cursor', '.cursor/rules/recap.mdc']]),
    basis: 'bundle: join(homedir, ".cursor", "rules") is the scope-"user" rules dir; '
      + '~/.cursor/AGENTS.md is never read',
  },
  {
    id: 'hermes', label: 'Hermes', kind: 'md', tier: 'local', header: false,
    detect: (h) => dir(h, '.hermes') || hasBin('hermes'),
    files: (h) => inConfigDir(h, '.hermes', 'SOUL.md'),
    basis: 'prompt_builder.load_soul_md(): SOUL.md is identity slot #1 of the system prompt',
  },
  {
    id: 'misaka', label: 'misaka', kind: 'md', tier: 'local', header: false,
    detect: (h) => dir(h, '.misaka') || hasBin('misaka'),
    files: (h) => inConfigDir(h, '.misaka', 'MISAKA.md'),
    basis: 'config/home.py shared_soul = MISAKA.md, loaded before every role SOUL.md',
  },
  {
    id: 'copilot', label: 'GitHub Copilot CLI', kind: 'md', tier: 'docs',
    detect: (h) => dir(h, '.copilot') || hasBin('copilot'),
    files: (h) => inConfigDir(h, '.copilot', 'copilot-instructions.md'),
    basis: 'docs: user-level instructions live under ~/.copilot (or $COPILOT_HOME) as '
      + 'copilot-instructions.md; AGENTS.md there is repo-scoped, not user-level',
  },
  {
    id: 'qwen', label: 'Qwen Code', kind: 'md', tier: 'docs',
    detect: (h) => dir(h, '.qwen') || hasBin('qwen'),
    files: (h) => inConfigDir(h, '.qwen', 'QWEN.md'),
    basis: 'docs: ~/.qwen/QWEN.md is the user-level context file',
  },
  {
    id: 'crush', label: 'Crush', kind: 'md', tier: 'docs',
    detect: (h) => dir(h, '.config/crush') || hasBin('crush'),
    files: (h) => inConfigDir(h, '.config/crush', 'CRUSH.md').concat(inConfigDir(h, '.config', 'AGENTS.md')),
    basis: 'docs (internal/config): default global_context_paths are '
      + '~/.config/crush/CRUSH.md and ~/.config/AGENTS.md',
  },
  {
    id: 'amp', label: 'Amp', kind: 'md', tier: 'docs',
    detect: (h) => dir(h, '.config/amp') || dir(h, '.amp') || hasBin('amp'),
    files: (h) => inConfigDir(h, '.config/amp', 'AGENTS.md').concat(inConfigDir(h, '.config', 'AGENTS.md')),
    basis: 'docs: ~/.config/amp/AGENTS.md plus ~/.config/AGENTS.md, which is always included',
  },
  {
    id: 'zed', label: 'Zed Agent', kind: 'md', tier: 'docs',
    detect: (h) => dir(h, '.config/zed') || hasBin('zed'),
    files: (h) => inConfigDir(h, '.config/zed', 'AGENTS.md'),
    basis: 'docs: ~/.config/zed/AGENTS.md is the user-level instructions file',
  },
  {
    id: 'devin', label: 'Devin CLI', kind: 'md', tier: 'docs',
    detect: (h) => dir(h, '.config/devin') || hasBin('devin'),
    files: (h) => inConfigDir(h, '.config/devin', 'AGENTS.md'),
    basis: 'docs: ~/.config/devin/AGENTS.md (AGENT.md also accepted)',
  },
  {
    id: 'goose', label: 'Goose', kind: 'md', tier: 'docs',
    detect: (h) => dir(h, '.config/goose') || hasBin('goose'),
    files: (h) => inConfigDir(h, '.config/goose', '.goosehints'),
    basis: 'docs: global hints file ~/.config/goose/.goosehints; AGENTS.md needs '
      + 'CONTEXT_FILE_NAMES, so hints is the mechanism that works out of the box',
  },
  {
    id: 'windsurf', label: 'Windsurf Cascade', kind: 'md', tier: 'docs',
    detect: (h) => dir(h, '.codeium/windsurf') || dir(h, '.windsurf'),
    files: (h) => underAny(h, [['.codeium/windsurf', '.codeium/windsurf/memories/global_rules.md']]),
    basis: 'docs: global_rules.md in the memories dir; note the 6,000-character cap on that file',
  },
  {
    id: 'roo', label: 'Roo Code', kind: 'dirmd', tier: 'docs',
    detect: (h) => dir(h, '.roo'),
    files: (h) => underAny(h, [['.roo', '.roo/rules/recap.md']]),
    basis: 'docs: ~/.roo/rules/ is the global rules dir (fixed path, mode-specific '
      + 'rules-<mode>/ also read)',
  },
  {
    id: 'kiro', label: 'Kiro CLI', kind: 'dirmd', tier: 'docs',
    detect: (h) => dir(h, '.kiro') || hasBin('kiro'),
    files: (h) => underAny(h, [['.kiro', '.kiro/steering/recap.md']]),
    basis: 'docs: ~/.kiro/steering/*.md is the user-level steering dir (the Amazon Q CLI '
      + 'became Kiro, so ~/.aws/amazonq has no rules file)',
  },
  {
    id: 'agents-convention', label: 'AGENTS.md convention', kind: 'md', tier: 'local',
    detect: () => true,
    files: (h) => [abs(h, '.agents/AGENTS.md')],
    basis: 'cross-agent convention dir; covers convention-following harnesses',
  },
  {
    id: 'codebuddy', label: 'CodeBuddy', kind: 'md', tier: 'unverified',
    detect: (h) => dir(h, '.codebuddy') || hasBin('codebuddy'),
    files: (h) => inConfigDir(h, '.codebuddy', 'CODEBUDDY.md'),
    basis: 'weakest link: the CLI references CODEBUDDY.md and a userMemory scope, but the '
      + 'home-dir join is obfuscated and never confirmed. Needs --experimental',
  },
];

const ops = {
  install: { md: ensureMd, dsh: ensureDsh, plugin: ensurePlugin, mdc: ensureMdc, dirmd: ensureDirMd },
  remove: { md: removeMd, dsh: removeDsh, plugin: removePlugin, mdc: removeMdc, dirmd: removeDirMd },
};
const probes = { md: mdState, dsh: dshState, plugin: pluginState, mdc: mdcState, dirmd: dirMdState };

export const activeAdapters = () =>
  ADAPTERS.filter((a) => (EXPERIMENTAL || a.tier !== 'unverified') && !SKIP.has(a.id));

function main() {
  if (CMD === 'status') {
    const rows = [];
    for (const a of activeAdapters()) {
      const det = a.detect(HOME);
      const files = a.files(HOME);
      const states = files.map((f) => probes[a.kind](f));
      rows.push({
        agent: det ? a.id : `${a.id} (not detected)`,
        state: !det ? '-'
          : files.length === 0 ? 'no landing dir'
            : states.every((s) => s === 'absent') ? 'absent'
              : states.some((s) => s === 'installed') ? 'installed' : states.join(', '),
        tier: a.tier,
        // a not-detected harness shows no path, even when part of its path exists on disk
        path: !det ? '-'
          : files.length === 0 ? '-'
            : files.length === 1 ? tilde(files[0]) : `${files.length} targets`,
      });
    }
    const w = Math.max(12, ...rows.map((r) => r.agent.length)) + 1;
    console.log(`${'agent'.padEnd(w)} ${'state'.padEnd(18)} ${'tier'.padEnd(8)} path`);
    for (const r of rows) {
      console.log(`${r.agent.padEnd(w)} ${r.state.padEnd(18)} ${r.tier.padEnd(8)} ${r.path}`);
    }
    return;
  }

  const op = ops[CMD];
  let changed = 0;
  for (const a of activeAdapters()) {
    if (!a.detect(HOME)) continue;
    for (const f of a.files(HOME)) {
      const { state } = a.kind === 'md' ? op.md(f, { header: a.header !== false }) : op[a.kind](f);
      if (!['ok', 'absent'].includes(state)) changed++;
      console.log(`${CMD === 'install' ? '+' : '-'} ${a.id.padEnd(20)} ${tilde(f).padEnd(48)} ${state}`);
    }
  }
  const done =
    CMD === 'remove'
      ? 'Restart each agent for the removal to take effect.'
      : 'Restart each agent for the convention to take effect.';
  console.log(
    DRY
      ? `\n[dry-run] ${changed} change(s) planned. Re-run without --dry-run to apply.`
      : `\n${changed} change(s) applied. ${done}`,
  );
}

// Run only as a CLI, so tests can import the table. macOS tmpdirs are symlinks, hence
// realpath before comparing.
const entry = process.argv[1] ? (() => {
  try { return fs.realpathSync(process.argv[1]); } catch { return process.argv[1]; }
})() : '';
if (entry && import.meta.url === pathToFileURL(entry).href) main();
