import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const project = fileURLToPath(new URL('../', import.meta.url));
const parent = join(project, 'dist', 'backup-disk-tests');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'run-'));
await mkdir(join(root, 'fixtures'));
await mkdir(join(root, 'backup'));
const run = (binary, args, options = {}) => {
  const result = spawnSync(binary, args, { cwd: project, encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) throw new Error(`${binary} failed: ${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  return result.stdout;
};
console.log(`隔离磁盘目录：${root}`);
for (const [i, frequency] of [440, 550, 660].entries()) {
  run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=0.25:sample_rate=24000`,
    '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '48k', '-map_metadata', '-1', join(root, 'fixtures', `tone-${i}.mp3`)]);
}
const phases = ['backup', 'recover', 'expired', 'all-expired', 'merge'];
const results = [];
for (const phase of phases) {
  const output = run(process.execPath, [join(project, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/local-backup-disk.test.ts'], {
    cwd: join(project, 'apps/extension'),
    env: { ...process.env, LEXISIDE_DISK_TEST_ROOT: root, LEXISIDE_DISK_TEST_PHASE: phase },
  });
  const result = JSON.parse(await readFile(join(root, `result-${phase}.json`), 'utf8'));
  assert.equal(result.passed, true);
  results.push(result);
  console.log(`通过 ${phase}：${result.checks.length} 项检查，进程 ${result.pid}`);
  if (phase === 'backup') {
    await cp(join(root, 'backup'), join(root, 'initial-backup'), { recursive: true });
    await rm(join(root, 'profiles', 'backup'), { recursive: true });
  }
}
assert.equal(new Set(results.map((result) => result.pid)).size, phases.length, 'Each phase must run in a separate process');
const decoded = [];
for (const phase of ['recover', 'expired']) {
  const directory = join(root, 'profiles', phase);
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.mp3')) continue;
    const path = join(directory, name);
    run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', path, '-f', 'null', '-']);
    decoded.push({ phase, path, decoded: true });
  }
}
assert.equal(decoded.length, 3);
const report = {
  runAt: new Date().toISOString(), passed: true, root,
  method: 'Production backup/storage/cache/TTS cache-hit functions, actual filesystem files, five independent Node processes. Source test profile deleted before recovery.',
  limitations: ['Chrome File System Access permission/handle boundary is a test adapter, not a native Chrome picker.', 'Chrome storage is backed by isolated JSON files; IndexedDB is provided by fake-indexeddb.', 'MP3 fixtures are locally generated tones, not paid Doubao synthesis; native browser playback and reinstall UI are not exercised.'],
  decoded, phases: results,
};
const reportPath = join(root, 'report.json');
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(`MP3 解码通过：${decoded.length} 个恢复文件`);
console.log(`测试报告：${resolve(reportPath)}`);
