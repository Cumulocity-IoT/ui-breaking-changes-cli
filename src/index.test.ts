import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = join(__dirname, 'index.ts');
const loader = '--import=tsx/esm';

function runCli(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [loader, entry, ...args], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

// ── --help-json ───────────────────────────────────────────────────────────────

describe('--help-json', () => {
  it('exits 0', () => {
    const { status } = runCli(['--help-json']);
    assert.equal(status, 0);
  });

  it('emits valid JSON', () => {
    const { stdout } = runCli(['--help-json']);
    assert.doesNotThrow(() => JSON.parse(stdout));
  });

  it('schema has name and description at the top level', () => {
    const { stdout } = runCli(['--help-json']);
    const schema = JSON.parse(stdout) as Record<string, unknown>;
    assert.equal(typeof schema.name, 'string');
    assert.equal(typeof schema.description, 'string');
  });

  it('schema has a commands array with check and versions', () => {
    const { stdout } = runCli(['--help-json']);
    const schema = JSON.parse(stdout) as { commands: Array<{ name: string }> };
    const names = schema.commands.map((c) => c.name);
    assert.ok(names.includes('check'), `expected "check" in ${JSON.stringify(names)}`);
    assert.ok(names.includes('versions'), `expected "versions" in ${JSON.stringify(names)}`);
  });

  it('check command lists --from and --to options', () => {
    const { stdout } = runCli(['--help-json']);
    const schema = JSON.parse(stdout) as { commands: Array<{ name: string; options?: Array<{ flags: string }> }> };
    const check = schema.commands.find((c) => c.name === 'check');
    assert.ok(check, 'check command not found');
    const flags = (check.options ?? []).map((o) => o.flags);
    assert.ok(flags.some((f) => f.includes('--from')), `--from not found in ${JSON.stringify(flags)}`);
    assert.ok(flags.some((f) => f.includes('--to')),   `--to not found in ${JSON.stringify(flags)}`);
  });

  it('schema includes versionAliasFormats array', () => {
    const { stdout } = runCli(['--help-json']);
    const schema = JSON.parse(stdout) as { versionAliasFormats: unknown[] };
    assert.ok(Array.isArray(schema.versionAliasFormats) && schema.versionAliasFormats.length > 0);
  });
});

// ── --help ────────────────────────────────────────────────────────────────────

describe('--help', () => {
  it('exits 0', () => {
    const { status } = runCli(['--help']);
    assert.equal(status, 0);
  });

  it('output includes --from and --to', () => {
    const { stdout } = runCli(['--help']);
    assert.ok(stdout.includes('--from'), '--from not in help output');
    assert.ok(stdout.includes('--to'),   '--to not in help output');
  });

  it('output includes the subcommand name', () => {
    const { stdout } = runCli(['--help']);
    assert.ok(stdout.includes('check') || stdout.includes('versions'), 'subcommand names not in help output');
  });
});

describe('check --help', () => {
  it('exits 0', () => {
    const { status } = runCli(['check', '--help']);
    assert.equal(status, 0);
  });

  it('output includes all key options', () => {
    const { stdout } = runCli(['check', '--help']);
    for (const flag of ['--from', '--to', '--format', '--breaking-only', '--category', '--show-grep', '--no-npm', '--no-color']) {
      assert.ok(stdout.includes(flag), `${flag} not found in check --help`);
    }
  });

  it('--help-json is not shown (hidden flag)', () => {
    const { stdout } = runCli(['check', '--help']);
    assert.ok(!stdout.includes('--help-json'), '--help-json should be hidden from help output');
  });
});
