import fs from 'node:fs';
import path from 'node:path';
import { createHash, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { canonicalUpdatePayload, embeddedPublicKey } from '/opt/tarkov-operations-companion/scripts/sign-client-release.mjs';

const root = '/opt/tarkov-operations-companion';
const suffix = process.env.REPAIR_RELEASE_SUFFIX || 'recognition-repair';
if (!/^[a-z0-9-]+$/.test(suffix)) throw new Error('Invalid release suffix');
const client = `/opt/raidos-repair-20261008/release-client-${suffix}`;
const owner = `/opt/raidos-repair-20261008/release-owner-${suffix}`;
const downloads = path.join(root, 'website/dist/downloads');
const manifest = JSON.parse(fs.readFileSync(path.join(client, 'release.json'), 'utf8'));
const clientInfo = JSON.parse(fs.readFileSync(path.join(client, 'build-info.json'), 'utf8'));
const ownerInfo = JSON.parse(fs.readFileSync(path.join(owner, 'build-info.json'), 'utf8'));
if (clientInfo.edition !== 'client' || ownerInfo.edition !== 'owner' || manifest.build !== clientInfo.build) throw new Error('Wrong build editions or manifest');
if (!verify(null, Buffer.from(canonicalUpdatePayload(manifest)), embeddedPublicKey(), Buffer.from(manifest.signature, 'base64'))) throw new Error('Invalid update signature');
const clientExe = path.join(client, `Raid OS ${clientInfo.version}.exe`);
const ownerExe = path.join(owner, `Raid OS ${ownerInfo.version}.exe`);
const digest = createHash('sha256');
for await (const chunk of fs.createReadStream(clientExe)) digest.update(chunk);
if (fs.statSync(clientExe).size !== manifest.size || digest.digest('hex') !== manifest.sha256) throw new Error('Client exe does not match signed manifest');
for (const directory of [client, owner]) {
  const native = fs.readFileSync(path.join(directory, 'win-unpacked/resources/koffi/win32_x64/koffi.node'));
  if (native.subarray(0, 2).toString() !== 'MZ') throw new Error('Windows native module is missing');
}
const uid = Number(execFileSync('id', ['-u', 'raidos-api']).toString().trim());
const gid = Number(execFileSync('id', ['-g', 'raidos-api']).toString().trim());
const backup = `/etc/raidos/releases-before-recognition-repair-${Date.now()}`;
fs.mkdirSync(backup, { mode: 0o700 });
const publications = [
  { source: ownerExe, target: '/opt/raidos-private/RaidOSServer.exe', mode: 0o600, uid, gid },
  { source: clientExe, target: path.join(downloads, 'RaidOSClient.exe'), mode: 0o644 },
  { source: path.join(client, 'release.json'), target: path.join(downloads, 'release.json'), mode: 0o644 },
];
for (const [index, file] of publications.entries()) {
  file.backup = path.join(backup, String(index));
  fs.copyFileSync(file.target, file.backup);
  fs.chmodSync(file.backup, 0o600);
  fs.copyFileSync(file.source, `${file.target}.new`);
  fs.chmodSync(`${file.target}.new`, file.mode);
  if (file.uid !== undefined) fs.chownSync(`${file.target}.new`, file.uid, file.gid);
}
try {
  for (const file of publications) fs.renameSync(`${file.target}.new`, file.target);
  const online = await fetch(`https://raidos.app/download/version.json?ts=${Date.now()}`, { cache: 'no-store' }).then(response => response.json());
  if (online.build !== manifest.build || online.sha256 !== manifest.sha256 || online.signature !== manifest.signature) throw new Error('Published manifest mismatch');
  const head = await fetch('https://raidos.app/download/windows', { method: 'HEAD', cache: 'no-store' });
  if (head.status !== 200 || Number(head.headers.get('content-length')) !== manifest.size || !head.headers.get('content-disposition')?.includes('attachment')) throw new Error('Public download verification failed');
  const sample = await fetch('https://raidos.app/download/windows', { headers: { Range: 'bytes=0-1' } });
  if (sample.status !== 206 || Buffer.from(await sample.arrayBuffer()).toString() !== 'MZ') throw new Error('Public exe range verification failed');
  execFileSync('runuser', ['-u', 'raidos-api', '--', 'test', '-r', '/opt/raidos-private/RaidOSServer.exe']);
  const health = await fetch('https://raidos.app/api/health').then(response => response.json());
  if (!health.ok || !health.database) throw new Error('API health check failed');
  console.log(JSON.stringify({ clientBuild: manifest.build, ownerBuild: ownerInfo.build, sizeMiB: Math.round(manifest.size / 1048576), signatureVerified: true, publicDownload: 200, executableRange: 206, ownerDownloadReadable: true, databaseHealthy: true, backupCreated: true }));
} catch (error) {
  for (const file of publications) {
    fs.copyFileSync(file.backup, `${file.target}.restore`);
    fs.chmodSync(`${file.target}.restore`, file.mode);
    if (file.uid !== undefined) fs.chownSync(`${file.target}.restore`, file.uid, file.gid);
    fs.renameSync(`${file.target}.restore`, file.target);
  }
  throw new Error(`Publication reverted: ${error.message}`);
}
