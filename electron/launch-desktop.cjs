const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 3000;
const APP_URL = `http://127.0.0.1:${PORT}`;
const PROJECT_ROOT = path.resolve(__dirname, '..');

function checkServerAlive(timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(`${APP_URL}/api/health`, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  const isWin = process.platform === 'win32';
  if (!(await checkServerAlive())) {
    const tsxBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', isWin ? 'tsx.cmd' : 'tsx');
    spawn(tsxBin, ['server.ts'], { cwd: PROJECT_ROOT, stdio: 'inherit', shell: isWin });
    const start = Date.now();
    while (Date.now() - start < 25000) {
      if (await checkServerAlive()) break;
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  const elecBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', isWin ? 'electron.cmd' : 'electron');
  if (fs.existsSync(elecBin)) {
    spawn(elecBin, ['.'], { cwd: PROJECT_ROOT, stdio: 'inherit', shell: isWin });
  } else {
    console.log('Electron binary not found; open browser at:', APP_URL);
  }
}

main();
