import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(skillDir, 'scripts', 'recap.mjs');
const { ADAPTERS } = await import(pathToFileURL(script).href);

/**
 * Builds a fake home that mirrors a real multi-agent machine: every adapter in the
 * table is detected here unless the test says otherwise. PATH is pointed at an empty
 * fake bin dir so detection is driven by the fixture, not by the developer's machine.
 */
function makeHome({ without = [] } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-recap-test-'));
  for (const dir of [
    '.config/opencode/plugins',
    '.claude',
    '.codex',
    '.grok',
    '.kimi-code',
    '.agents',
    '.gemini',
    '.gemini/config',
    '.gemini/antigravity',
    '.dsh/profiles/web',
    '.dsh/profiles/node_modules',
    '.pi/agent',
    '.commandcode',
    '.qoder',
    '.qoder-cn',
    '.workbuddy',
    '.trae-cn/user_rules',
    '.trae-cn/rules',
    '.cline',
    'Documents/Cline/Hooks',
    '.kilocode',
    '.continue',
    '.zcode',
    '.cursor',
    '.hermes',
    '.misaka',
    '.copilot',
    '.qwen',
    '.config/crush',
    '.config/amp',
    '.config/zed',
    '.config/devin',
    '.config/goose',
    '.codeium/windsurf/memories',
    '.roo',
    '.kiro',
    '.codebuddy',
    'fakebin',
  ]) {
    if (without.includes(dir)) continue;
    fs.mkdirSync(path.join(home, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(home, '.claude/CLAUDE.md'), '# Global instructions\n\nKeep this rule.\n');
  fs.writeFileSync(
    path.join(home, '.codex/AGENTS.md'),
    '## Rules\n\n- Prefer rg for search.\n\n## 回复收尾（recap）\n\n- 旧版规则\n',
  );
  fs.writeFileSync(path.join(home, '.agents/AGENTS.md'), '# Convention entry\n');
  fs.writeFileSync(path.join(home, '.gemini/GEMINI.md'), '# Context\n\nExisting user notes.\n');
  fs.writeFileSync(path.join(home, '.hermes/SOUL.md'), '# Hermes\n\nBe kawaii and precise.\n');
  fs.writeFileSync(path.join(home, '.misaka/MISAKA.md'), '# MISAKA Network\n\nNever invent a source.\n');
  fs.writeFileSync(
    path.join(home, '.workbuddy/SOUL.md'),
    '---\ntitle: "SOUL.md"\n---\n\n# SOUL.md - Who You Are\n\nBe precise.\n',
  );
  fs.writeFileSync(
    path.join(home, '.zcode/AGENTS.md'),
    '# ZCode rules\n\nKeep user content.\n',
  );
  fs.writeFileSync(
    path.join(home, '.dsh/profiles/web/cordis.patch.yml'),
    [
      '- insert:',
      '    - id: hooks',
      "      name: 'existing-entry'",
      '',
      '- id: system-prompt',
      "  name: '@deepseek-ai/dsh-system-prompt'",
      '  config:',
      "    personaSuffix: 'legacy suffix'",
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(home, '.config/opencode/plugins/recap-line.js'), 'export default async () => ({})\n');
  // hasBin() consults the current process PATH, so the parent and the child must agree.
  process.env.PATH = path.join(home, 'fakebin');
  return home;
}

const env = (home) => ({ ...process.env, HOME: home, PATH: path.join(home, 'fakebin') });
const run = (home, ...args) =>
  execFileSync(process.execPath, [script, ...args], { env: env(home), encoding: 'utf8' });

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
const markers = (file) => read(file).split('recap:begin').length - 1;

/** How many managed regions an adapter's landing file holds, per mechanism kind. */
function coverage({ adapter, file }) {
  const text = read(file);
  if (adapter.kind === 'plugin') return text.includes('recap:managed') ? 1 : 0;
  if (adapter.kind === 'dirmd') return text.includes('rules-dir file, managed') ? 1 : 0;
  const begin = adapter.kind === 'dsh' ? '# recap:begin' : '<!-- recap:begin -->';
  return text.split(begin).length - 1;
}

/** Every landing path install would touch in this home, with its adapter. */
function landingPaths(home) {
  const out = [];
  for (const a of ADAPTERS.filter((x) => x.tier !== 'unverified' && x.detect(home))) {
    for (const f of a.files(home)) out.push({ adapter: a, file: f });
  }
  return out;
}

test('install writes exactly one managed region to every landing path in the table', () => {
  const home = makeHome();
  run(home, 'install');

  const paths = landingPaths(home);
  assert.ok(paths.length >= 15, `expected the table to cover 15+ paths, got ${paths.length}`);
  for (const target of paths) {
    assert.equal(coverage(target), 1, `${target.adapter.id} ${target.file} should have one region`);
  }

  // legacy unmarked section migrated, user content kept
  const codex = read(path.join(home, '.codex/AGENTS.md'));
  assert.match(codex, /Prefer rg for search\./);
  assert.doesNotMatch(codex, /旧版规则/);

  // both labels carry their bold markers and the Next arrow
  const claude = read(path.join(home, '.claude/CLAUDE.md'));
  assert.match(claude, /🏁 \*\*recap:\*\*/);
  assert.match(claude, /➡️ \*\*Next:\*\*/);
  assert.match(claude, /Put "---" on its own line with a blank line before and after it/);

  // dsh: managed personaSuffix replaced the legacy entry, other entries survive
  const dsh = read(path.join(home, '.dsh/profiles/web/cordis.patch.yml'));
  assert.match(dsh, /existing-entry/);
  assert.doesNotMatch(dsh, /legacy suffix/);

  // opencode: foreign plugin replaced with managed version and backed up
  const plugin = read(path.join(home, '.config/opencode/plugins/recap-line.js'));
  assert.match(plugin, /recap:managed/);
  const backups = fs
    .readdirSync(path.join(home, '.config/opencode/plugins'))
    .filter((name) => name.includes('.bak-'));
  assert.equal(backups.length, 1, 'foreign plugin should be backed up');
});

test('persona files keep their own shape and are not deleted on remove', () => {
  const home = makeHome();
  run(home, 'install');

  for (const id of ['hermes', 'misaka', 'workbuddy']) {
    const { file } = landingPaths(home).find((p) => p.adapter.id === id);
    const text = read(file);
    assert.doesNotMatch(text, /# Global Agent Instructions/, `${id} is a persona file`);
    assert.match(text, /recap:begin/);
  }
  assert.match(read(path.join(home, '.hermes/SOUL.md')), /Be kawaii and precise\./);
  assert.match(read(path.join(home, '.workbuddy/SOUL.md')), /Be precise\./);

  run(home, 'remove');
  for (const [id, line] of [
    ['hermes', /Be kawaii and precise\./],
    ['misaka', /Never invent a source\./],
    ['workbuddy', /Be precise\./],
  ]) {
    const { file } = landingPaths(home).find((p) => p.adapter.id === id);
    assert.ok(fs.existsSync(file), `${id} file should survive removal`);
    assert.match(read(file), line);
    assert.equal(markers(file), 0);
  }
});

test('cursor lands as an always-apply .mdc user rule', () => {
  const home = makeHome();
  run(home, 'install');
  const file = path.join(home, '.cursor/rules/recap.mdc');
  const text = read(file);
  assert.match(text, /^---\n/, 'frontmatter must start the file');
  assert.match(text, /alwaysApply: true/);
  assert.match(text, /<!-- recap:managed -->/);
  assert.equal(markers(file), 1);

  run(home, 'remove');
  assert.equal(fs.existsSync(file), false, 'a file this skill created is removed wholesale');
});

test('both Qoder config dirs get the block when both exist', () => {
  const home = makeHome();
  run(home, 'install');
  for (const dir of ['.qoder', '.qoder-cn']) {
    assert.equal(markers(path.join(home, dir, 'AGENTS.md')), 1, `${dir}/AGENTS.md`);
  }
});

test('install is idempotent across the whole table', () => {
  const home = makeHome();
  run(home, 'install');
  const second = run(home, 'install');
  assert.match(second, /0 change\(s\) applied/);
  for (const target of landingPaths(home)) {
    assert.equal(coverage(target), 1, `${target.adapter.id} ${target.file} should not gain a duplicate region`);
  }
});

test('changing CONFIG updates every agent in place', () => {
  const home = makeHome();
  run(home, 'install');

  const source = fs.readFileSync(script, 'utf8');
  const tweaked = source.replace(/prefix: '[^']*'/, "prefix: '🎯 recap:'");
  assert.notEqual(tweaked, source, 'test patch should change the prefix');
  const tweakedScript = path.join(home, 'recap-tweaked.mjs');
  fs.writeFileSync(tweakedScript, tweaked);
  execFileSync(process.execPath, [tweakedScript, 'install'], { env: env(home), encoding: 'utf8' });

  const claude = read(path.join(home, '.claude/CLAUDE.md'));
  assert.match(claude, /🎯 recap:/);
  assert.doesNotMatch(claude, /🏁/);
  assert.equal(markers(path.join(home, '.claude/CLAUDE.md')), 1);
});

test('separator can be disabled through CONFIG', () => {
  const home = makeHome();
  run(home, 'install');

  const source = fs.readFileSync(script, 'utf8');
  const tweaked = source.replace(/separator: '[^']*'/, "separator: ''");
  assert.notEqual(tweaked, source, 'test patch should clear the separator');
  const tweakedScript = path.join(home, 'recap-no-separator.mjs');
  fs.writeFileSync(tweakedScript, tweaked);
  execFileSync(process.execPath, [tweakedScript, 'install'], { env: env(home), encoding: 'utf8' });

  const claude = read(path.join(home, '.claude/CLAUDE.md'));
  assert.doesNotMatch(claude, /Put "---" on its own line/);
  assert.equal(markers(path.join(home, '.claude/CLAUDE.md')), 1);
});

test('--skip leaves the named adapter untouched and writes the rest', () => {
  const home = makeHome();
  run(home, 'install', '--skip=hermes,misaka');
  assert.equal(markers(path.join(home, '.hermes/SOUL.md')), 0, 'skipped adapter is untouched');
  assert.equal(read(path.join(home, '.misaka/MISAKA.md')), '# MISAKA Network\n\nNever invent a source.\n');
  assert.equal(markers(path.join(home, '.claude/CLAUDE.md')), 1);
});

test('no phantom writes when an adapter is detected but has no landing dir', () => {
  const home = makeHome({ without: ['.pi/agent'] });
  const out = run(home, 'install');
  assert.equal(fs.existsSync(path.join(home, '.pi')), false, 'nothing is created outside a real dir');
  assert.doesNotMatch(out, /^\+ pi/m, 'pi should report no change without its global dir');
});

test('remove strips regions, deletes wholly-managed files, keeps user content', () => {
  const home = makeHome();
  run(home, 'install');
  const out = run(home, 'remove');
  assert.match(out, /removal to take effect/);

  assert.equal(markers(path.join(home, '.claude/CLAUDE.md')), 0);
  assert.match(read(path.join(home, '.claude/CLAUDE.md')), /Keep this rule\./);
  assert.match(read(path.join(home, '.codex/AGENTS.md')), /Prefer rg for search\./);
  assert.doesNotMatch(read(path.join(home, '.codex/AGENTS.md')), /recap/);
  assert.equal(fs.existsSync(path.join(home, '.kimi-code/AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(home, '.config/opencode/plugins/recap-line.js')), false);
  assert.match(read(path.join(home, '.dsh/profiles/web/cordis.patch.yml')), /existing-entry/);
  assert.doesNotMatch(read(path.join(home, '.dsh/profiles/web/cordis.patch.yml')), /recap:begin/);

  // ZCode keeps its user-authored AGENTS.md and loses only the managed region
  assert.equal(markers(path.join(home, '.zcode/AGENTS.md')), 0);
  assert.match(read(path.join(home, '.zcode/AGENTS.md')), /Keep user content\./);

  for (const target of landingPaths(home)) {
    assert.equal(coverage(target), 0, `${target.adapter.id} ${target.file} should be clean after removal`);
  }

  // status afterwards reports everything absent
  const status = run(home, 'status');
  assert.match(status, /claude\s+absent/);
});

test('status lists every enabled adapter with its tier', () => {
  const home = makeHome({ without: ['.grok'] });
  const status = run(home, 'status');
  for (const a of ADAPTERS.filter((x) => x.tier !== 'unverified')) {
    assert.match(status, new RegExp(`^${a.id}\\b`, 'm'), `${a.id} in status`);
  }
  assert.match(status, /grok \(not detected\)/);
  assert.match(status, /^agent\s+state\s+tier\s+path/m);
});

test('unverified adapters stay out unless --experimental', () => {
  const home = makeHome();
  assert.doesNotMatch(run(home, 'status'), /^codebuddy\b/m);
  run(home, 'install');
  assert.equal(markers(path.join(home, '.codebuddy/CODEBUDDY.md')), 0, 'not written by default');
  assert.match(run(home, 'status', '--experimental'), /^codebuddy\s+absent/m);
  run(home, 'install', '--experimental');
  assert.equal(markers(path.join(home, '.codebuddy/CODEBUDDY.md')), 1);
});

test('rules-dir adapters own a separate managed file and drop it on remove', () => {
  const home = makeHome();
  run(home, 'install');
  const roo = path.join(home, '.roo/rules/recap.md');
  assert.match(read(roo), /rules-dir file, managed by the agent-recap skill/);
  assert.match(read(roo), /Reply Closing \(Recap\)/);
  const kiro = path.join(home, '.kiro/steering/recap.md');
  assert.match(read(kiro), /rules-dir file, managed by the agent-recap skill/);

  // Trae: both the IDE (user_rules) and CLI (rules) dirs get their own owned file
  const traeIde = path.join(home, '.trae-cn/user_rules/recap.md');
  const traeCli = path.join(home, '.trae-cn/rules/recap.md');
  assert.match(read(traeIde), /rules-dir file, managed by the agent-recap skill/);
  assert.match(read(traeCli), /rules-dir file, managed by the agent-recap skill/);

  // Cline, Kilo and Continue own one file inside their global rules dirs
  const ruleFiles = [
    path.join(home, 'Documents/Cline/Rules/recap.md'),
    path.join(home, '.kilocode/rules/recap.md'),
    path.join(home, '.continue/rules/recap.md'),
  ];
  for (const file of ruleFiles) {
    assert.match(read(file), /rules-dir file, managed by the agent-recap skill/, file);
  }

  run(home, 'remove');
  assert.equal(fs.existsSync(roo), false);
  assert.equal(fs.existsSync(kiro), false);
  assert.equal(fs.existsSync(traeIde), false);
  assert.equal(fs.existsSync(traeCli), false);
  for (const file of ruleFiles) assert.equal(fs.existsSync(file), false, file);
});
