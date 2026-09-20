const { spawnSync } = require('node:child_process');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');

const projectRoot = process.cwd();
const executable = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'supabase.cmd' : 'supabase',
);
const target = path.join(projectRoot, 'src', 'types', 'database.generated.ts');
const temporaryTarget = `${target}.tmp`;

const result = spawnSync(executable, ['gen', 'types', 'typescript', '--local'], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  process.stderr.write(
    result.stderr || result.stdout || result.error?.message || 'Database type generation failed.\n',
  );
  process.exit(result.status ?? 1);
}

if (!result.stdout.includes('export type Database')) {
  process.stderr.write('Supabase returned an unexpected database type payload.\n');
  process.exit(1);
}

if (process.argv.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== result.stdout) {
    process.stderr.write('Database types differ from the local schema. Run pnpm db:types.\n');
    process.exit(1);
  }
  process.stdout.write('Database types match the local schema.\n');
  process.exit(0);
}

mkdirSync(path.dirname(target), { recursive: true });
try {
  writeFileSync(temporaryTarget, result.stdout, 'utf8');
  renameSync(temporaryTarget, target);
} finally {
  rmSync(temporaryTarget, { force: true });
}
