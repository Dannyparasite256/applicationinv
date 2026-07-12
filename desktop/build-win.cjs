/**
 * Build frontend against production API, then package Windows .exe with electron-builder.
 * Output: desktop/release/*.exe and copy portable to user Desktop.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const desktop = __dirname;
const apiUrl =
  process.env.VITE_API_URL || 'https://eims-api-qe86.onrender.com/api/v1';

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}\n`);
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    cwd: opts.cwd || root,
    env: { ...process.env, ...opts.env },
  });
  if (r.status !== 0) {
    process.exit(r.status || 1);
  }
}

console.log('Enterprise IMS — Windows desktop build');
console.log('API URL:', apiUrl);

// 1) Production web assets with absolute API (required in the Electron shell)
run('npm', ['run', 'build'], {
  cwd: frontend,
  env: {
    VITE_API_URL: apiUrl,
  },
});

const distIndex = path.join(frontend, 'dist', 'index.html');
if (!fs.existsSync(distIndex)) {
  console.error('Frontend dist/index.html missing after build');
  process.exit(1);
}

// 2) Install electron + electron-builder if needed
const electronPkg = path.join(desktop, 'node_modules', 'electron');
if (!fs.existsSync(electronPkg)) {
  run('npm', ['install'], { cwd: desktop });
}

// 3) Unpack dir target, embed the same Android launcher icon, then portable + NSIS
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
run('npx', ['electron-builder', '--win', 'dir', '--x64'], { cwd: desktop });

const rceditCandidates = [
  path.join(
    process.env.LOCALAPPDATA || '',
    'electron-builder',
    'Cache',
    'winCodeSign',
    'winCodeSign-2.6.0',
    'rcedit-x64.exe'
  ),
];
const unpackedExe = path.join(desktop, 'release', 'win-unpacked', 'Enterprise IMS.exe');
const iconIco = path.join(desktop, 'build', 'icon.ico');
const rcedit = rceditCandidates.find((p) => fs.existsSync(p));
if (rcedit && fs.existsSync(unpackedExe) && fs.existsSync(iconIco)) {
  console.log('\nEmbedding app icon into executable…');
  // Quote paths — product name contains a space ("Enterprise IMS.exe")
  run(`"${rcedit}"`, [`"${unpackedExe}"`, '--set-icon', `"${iconIco}"`], { cwd: desktop });
} else {
  console.warn('Skipping rcedit icon embed (tool or files missing)');
}

run(
  'npx',
  ['electron-builder', '--win', 'portable', 'nsis', '--x64', '--prepackaged', 'release/win-unpacked'],
  { cwd: desktop }
);

// 4) Copy convenient names to Desktop
const releaseDir = path.join(desktop, 'release');
const userDesktop = path.join(process.env.USERPROFILE || root, 'Desktop');
const portableSrc = path.join(releaseDir, 'Enterprise-IMS-Portable.exe');
const setupCandidates = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir).filter((f) => f.startsWith('Enterprise-IMS-Setup') && f.endsWith('.exe'))
  : [];

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn('Skip missing:', src);
    return false;
  }
  try {
    fs.copyFileSync(src, dest);
    console.log('Copied →', dest);
    return true;
  } catch (e) {
    const alt = dest.replace(/\.exe$/i, '-New.exe');
    try {
      fs.copyFileSync(src, alt);
      console.log('Destination locked; copied →', alt);
      return true;
    } catch (e2) {
      console.warn('Copy failed:', e.message || e);
      return false;
    }
  }
}

if (fs.existsSync(userDesktop)) {
  copyIfExists(portableSrc, path.join(userDesktop, 'Enterprise-IMS.exe'));
  if (setupCandidates[0]) {
    copyIfExists(
      path.join(releaseDir, setupCandidates[0]),
      path.join(userDesktop, 'Enterprise-IMS-Setup.exe')
    );
  }
}

console.log('\nDone. Run Enterprise-IMS.exe from your Desktop.');
