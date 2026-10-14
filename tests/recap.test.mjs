import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(skillDir, 'scripts', 'recap.mjs');

/** Builds a fake home that mirrors a real multi-agent machine. */
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-recap-test-'));
  for (const dir of [
    '.config/opencode/plugins',
    '.claude',
    '.codex',
    '.grok',
    '.kimi-code',
    '.agents',
    '.gemini',
    '.dsh/profiles/web',
    '.dsh/profiles/node_modules',
  ]) {
    fs.mkdirSync(path.join(home, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(home, '.claude/CLAUDE.md'), '# Global instructions\n\nKeep this rule.\n');
  fs.writeFileSync(
    path.join(home, '.codex/AGENTS.md'),
    '## Rules\n\n- Prefer rg for search.\n\n## 回复收尾（recap）\n\n- 旧版规则\n',
  );
  fs.writeFileSync(path.join(home, '.agents/AGENTS.md'), '# Convention entry\n');
  fs.writeFileSync(
    path.join(home, '.gemini/GEMINI.md'),
    '# Context\n\nExisting user notes.\n',
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
  return home;
}

const run = (home, ...args) =>
  execFileSync(process.execPath, [script, ...args], {
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
const markers = (file) => read(file).split('recap:begin').length - 1;

test('install creates exactly one managed region per agent and migrates legacy sections', () => {
  const home = makeHome();
  run(home, 'install');

  for (const file of [
    '.claude/CLAUDE.md',
    '.codex/AGENTS.md',
    '.grok/AGENTS.md',
    '.kimi-code/AGENTS.md',
    '.agents/AGENTS.md',
    '.gemini/GEMINI.md',
    '.dsh/profiles/web/cordis.patch.yml',
  ]) {
    assert.equal(markers(path.join(home, file)), 1, `${file} should have exactly one region`);
  }

  // legacy unmarked section migrated, user content kept
  const codex = read(path.join(home, '.codex/AGENTS.md'));
  assert.match(codex, /Prefer rg for search\./);
  assert.doesNotMatch(codex, /旧版规则/);

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

test('install is idempotent', () => {
  const home = makeHome();
  run(home, 'install');
  const second = run(home, 'install');
  assert.match(second, /0 change\(s\) applied/);
  for (const file of [
    '.claude/CLAUDE.md',
    '.codex/AGENTS.md',
    '.dsh/profiles/web/cordis.patch.yml',
  ]) {
    assert.equal(markers(path.join(home, file)), 1, `${file} should not gain a duplicate region`);
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
  execFileSync(process.execPath, [tweakedScript, 'install'], {
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });

  const claude = read(path.join(home, '.claude/CLAUDE.md'));
  assert.match(claude, /🎯 recap:/);
  assert.doesNotMatch(claude, /🏁/);
  assert.equal(markers(path.join(home, '.claude/CLAUDE.md')), 1);
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

  // status afterwards reports everything absent
  const status = run(home, 'status');
  assert.match(status, /claude\s+absent/);
});
