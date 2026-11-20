const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 3000;
const APP_URL = `http://127.0.0.1:${PORT}`;
const PROJECT_ROOT = path.resolve(__dirname, '..');

let serverProcess = null;
let mainWindow = null;

function checkServerAlive(timeoutMs = 1500) {
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

async function ensureBackendRunning() {
  if (await checkServerAlive()) return;
  const isWin = process.platform === 'win32';
  const tsxBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', isWin ? 'tsx.cmd' : 'tsx');
  serverProcess = spawn(tsxBin, ['server.ts'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, NODE_ENV: app.isPackaged ? 'production' : (process.env.NODE_ENV || 'development') },
    stdio: 'inherit',
    shell: isWin,
  });

  const start = Date.now();
  while (Date.now() - start < 25000) {
    if (await checkServerAlive()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function createWindow() {
  await ensureBackendRunning();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#020617',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  await mainWindow.loadURL(APP_URL);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
  if (process.platform !== 'darwin') app.quit();
});
