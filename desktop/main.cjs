/**
 * Enterprise IMS — Windows desktop shell (Electron).
 * Serves the built React UI from a local loopback server (SPA-friendly)
 * and talks to the production API (or VITE_API_URL baked at build time).
 */
const { app, BrowserWindow, shell, Menu } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

/** Resolve folder that holds the Vite build (index.html). */
function getDistDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app-dist');
  }
  // Dev: frontend/dist relative to this file
  return path.join(__dirname, '..', 'frontend', 'dist');
}

function startStaticServer(distDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(path.join(distDir, 'index.html'))) {
      reject(
        new Error(
          `UI build not found at ${distDir}. Run: npm run build -w frontend (with VITE_API_URL set).`
        )
      );
      return;
    }

    const server = http.createServer((req, res) => {
      try {
        const rawUrl = req.url || '/';
        const urlPath = decodeURIComponent(rawUrl.split('?')[0].split('#')[0] || '/');
        let rel = urlPath === '/' ? '/index.html' : urlPath;
        // Prevent path traversal
        const safeRel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
        let filePath = path.join(distDir, safeRel);

        if (!filePath.startsWith(distDir)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        const sendFile = (fp) => {
          fs.readFile(fp, (err, data) => {
            if (err) {
              // SPA fallback — React Router BrowserRouter
              const indexPath = path.join(distDir, 'index.html');
              fs.readFile(indexPath, (e2, html) => {
                if (e2) {
                  res.writeHead(404);
                  res.end('Not found');
                  return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(html);
              });
              return;
            }
            const ext = path.extname(fp).toLowerCase();
            res.writeHead(200, {
              'Content-Type': MIME[ext] || 'application/octet-stream',
              'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
            });
            res.end(data);
          });
        };

        fs.stat(filePath, (err, st) => {
          if (!err && st.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
          }
          sendFile(filePath);
        });
      } catch {
        res.writeHead(500);
        res.end('Server error');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind local server'));
        return;
      }
      resolve({ server, port: addr.port });
    });
    server.on('error', reject);
  });
}

let mainWindow = null;
let staticServer = null;

async function createWindow() {
  const distDir = getDistDir();
  const { server, port } = await startStaticServer(distDir);
  staticServer = server;
  const startUrl = `http://127.0.0.1:${port}/`;

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, 'build', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Enterprise IMS',
    backgroundColor: '#0f172a',
    show: false,
    autoHideMenuBar: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Minimal menu (File / Edit / View) — hide default Electron help noise
  const template = [
    {
      label: 'File',
      submenu: [{ role: 'quit', label: 'Exit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // External links (mailto, https docs, etc.) open in the system browser
    if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('mailto:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  await mainWindow.loadURL(startUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow().catch((err) => {
    console.error(err);
    const { dialog } = require('electron');
    dialog.showErrorBox('Enterprise IMS', err.message || String(err));
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch(console.error);
    }
  });
});

app.on('window-all-closed', () => {
  if (staticServer) {
    try {
      staticServer.close();
    } catch {
      /* ignore */
    }
    staticServer = null;
  }
  if (process.platform !== 'darwin') app.quit();
});
