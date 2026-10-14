#!/usr/bin/env node
/**
 * recap.mjs — manage the end-of-reply recap convention across AI coding agents.
 *
 *   node recap.mjs install [--dry-run]
 *   node recap.mjs status
 *   node recap.mjs remove  [--dry-run]
 *
 * Idempotent by design: every managed block is wrapped in recap:begin / recap:end
 * markers, so re-running install updates the region in place instead of appending
 * a duplicate. Unmarked legacy sections (heading "回复收尾" or "Reply Closing") are
 * migrated automatically on install.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const CMD = argv.find((a) => ['install', 'status', 'remove'].includes(a)) ?? 'install';

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

const mdRegion = () =>
  [BEGIN, '## Reply Closing (Recap)', '', ...RULES.map((r) => `- ${r}`), '', END].join('\n');

const flatRules = () => RULES.join(' ');

const tilde = (p) => p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p;
const exists = (p) => fs.existsSync(p);
const dirExists = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
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

const pluginFile = () => path.join(HOME, '.config/opencode/plugins/recap-line.js');

// ---- markdown-file agents ------------------------------------------------------

function ensureMd(file) {
  const fresh = !exists(file);
  const before = fresh ? `${MANAGED}\n# Global Agent Instructions\n\n` : fs.readFileSync(file, 'utf8');
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

// ---- dsh ------------------------------------------------------------------------

function dshProfiles() {
  const root = path.join(HOME, '.dsh/profiles');
  if (!dirExists(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'node_modules')
    .map((d) => path.join(root, d.name, 'cordis.patch.yml'));
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

function ensurePlugin() {
  const file = pluginFile();
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

function removePlugin() {
  const file = pluginFile();
  if (!exists(file)) return { file, state: 'absent' };
  if (!fs.readFileSync(file, 'utf8').includes('recap:managed')) {
    return { file, state: 'foreign, kept' };
  }
  if (!DRY) fs.rmSync(file);
  return { file, state: DRY ? 'would-delete' : 'deleted' };
}

function pluginState() {
  const file = pluginFile();
  if (!exists(file)) return 'absent';
  const t = fs.readFileSync(file, 'utf8');
  if (t.includes('recap:managed')) return 'installed';
  return 'foreign';
}

// ---- agent table -----------------------------------------------------------------

const AGENTS = [
  { id: 'opencode', detect: () => dirExists(path.join(HOME, '.config/opencode')),
    kind: 'plugin' },
  { id: 'claude', detect: () => dirExists(path.join(HOME, '.claude')),
    file: () => path.join(HOME, '.claude/CLAUDE.md') },
  { id: 'codex', detect: () => dirExists(path.join(HOME, '.codex')),
    file: () => path.join(HOME, '.codex/AGENTS.md') },
  { id: 'grok', detect: () => dirExists(path.join(HOME, '.grok')),
    file: () => path.join(HOME, '.grok/AGENTS.md') },
  { id: 'kimi', detect: () => dirExists(path.join(HOME, '.kimi-code')),
    file: () => path.join(HOME, '.kimi-code/AGENTS.md') },
  { id: 'gemini', detect: () => dirExists(path.join(HOME, '.gemini')),
    file: () => path.join(HOME, '.gemini/GEMINI.md') },
  { id: 'dsh', detect: () => dirExists(path.join(HOME, '.dsh/profiles')),
    files: dshProfiles },
  { id: 'agents-convention', detect: () => true,
    file: () => path.join(HOME, '.agents/AGENTS.md') },
];

const ops = {
  install: { md: ensureMd, dsh: ensureDsh, plugin: ensurePlugin },
  remove: { md: removeMd, dsh: removeDsh, plugin: removePlugin },
};
const probes = { md: mdState, dsh: dshState, plugin: () => pluginState() };

function targets(agent) {
  if (agent.files) return { kind: 'dsh', files: agent.files() };
  if (agent.kind === 'plugin') return { kind: 'plugin', files: [pluginFile()] };
  return { kind: 'md', files: [agent.file()] };
}

// ---- commands ----------------------------------------------------------------------

if (CMD === 'status') {
  const rows = [];
  for (const a of AGENTS) {
    const det = a.detect();
    const { kind, files } = targets(a);
    const states = files.map((f) => probes[kind](f));
    rows.push({
      agent: det ? a.id : `${a.id} (not detected)`,
      state: !det ? '-' : states.every((s) => s === 'absent') ? 'absent'
        : states.some((s) => s === 'installed') ? 'installed' : states.join(', '),
      path: files.length === 1 ? tilde(files[0]) : `${files.length} profiles`,
    });
  }
  console.log(`${'agent'.padEnd(24)} ${'state'.padEnd(22)} path`);
  for (const r of rows) console.log(`${r.agent.padEnd(24)} ${r.state.padEnd(22)} ${r.path}`);
  process.exit(0);
}

const op = ops[CMD];
let changed = 0;
for (const a of AGENTS) {
  if (!a.detect()) continue;
  const { kind, files } = targets(a);
  for (const f of files) {
    const { state } = op[kind](f);
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
