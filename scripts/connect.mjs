import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, '.local/sync-config.json');
await mkdir(path.dirname(configPath), { recursive: true });
let config = {};
try { config = JSON.parse(await readFile(configPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
config.token ||= randomBytes(48).toString('base64url');
config.name ||= 'Shewi';
if (process.argv[2]) {
  const url = new URL(process.argv[2]);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Expected the dashboard HTTPS origin');
  config.url = url.origin;
}
await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
if (!process.argv.includes('--local-only')) {
  // Windows requires cmd to invoke npx.cmd. No secret is passed in argv: the
  // generated value goes only through stdin to the environment command.
  const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npx';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npx --yes vercel@63.1.2 env add SYNC_TOKEN production,preview --sensitive --force --yes']
    : ['--yes', 'vercel@63.1.2', 'env', 'add', 'SYNC_TOKEN', 'production,preview', '--sensitive', '--force', '--yes'];
  const child = spawn(command, args, { cwd: root, stdio: ['pipe', 'inherit', 'inherit'] });
  child.stdin.end(config.token + '\n');
  const exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  if (exitCode !== 0) process.exit(exitCode || 1);
}
console.log('Personal sync configured. The upload secret was stored without printing it.');
