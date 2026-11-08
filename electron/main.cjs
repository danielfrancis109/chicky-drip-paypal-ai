const { app, BrowserWindow, Menu, shell } = require('electron');

const SITE = 'https://cluck-gather-rewards.lovable.app';
const isSite = (url) => {
  try { return new URL(url).origin === SITE; } catch { return false; }
};
const openExternal = (url) => {
  try { if (new URL(url).protocol === 'https:') shell.openExternal(url); } catch {}
};

function createWindow() {
  const window = new BrowserWindow({
    width: 1280, height: 900, minWidth: 480, minHeight: 640,
    title: 'Chicky Drip Catering',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isSite(url)) { event.preventDefault(); openExternal(url); }
  });
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Chicky Drip', submenu: [
      { label: 'Home', click: () => window.loadURL(SITE) },
      { label: 'Menu', click: () => window.loadURL(SITE + '/menu') },
      { label: 'Open in browser', click: () => shell.openExternal(SITE) },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
  window.loadURL(SITE);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());