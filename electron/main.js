// Proceso principal de la app de escritorio (Electron).
// Abre la ventana con la misma app web y le da, a través de preload.js:
//   - almacenamiento en un archivo del equipo (file-store.js)
//   - diálogos nativos de Windows para guardar y abrir archivos
//   - permiso para usar la cámara (escáner de códigos)
'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } = require('electron');
const path = require('path');
const fsp = require('fs').promises;
const { createFileStore } = require('./file-store');
const Inventory = require('../js/core/inventory.js');

const ROOT = path.join(__dirname, '..');
const MAX_OPEN_FILE_BYTES = 50 * 1024 * 1024;

// Solo para pruebas automáticas (nunca en la app instalada): carpeta de datos aparte.
const TEST_DATA_DIR = !app.isPackaged && process.env.INVENTARIO_DATA_DIR;
if (TEST_DATA_DIR) app.setPath('userData', path.join(TEST_DATA_DIR, 'perfil'));
// En la prueba automática se usa una cámara simulada (no hay una real disponible).
if (!app.isPackaged && process.env.INVENTARIO_SMOKE_TEST) app.commandLine.appendSwitch('use-fake-device-for-media-stream');

const dataDir = () => TEST_DATA_DIR ? path.join(TEST_DATA_DIR, 'datos') : path.join(app.getPath('userData'), 'datos');

let win = null;
let store = null;

// ---------- Comunicación con la ventana ----------

// Responde { ok, value } o { ok: false, error } para que el error llegue con su nombre.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!win || event.sender !== win.webContents) {
      return { ok: false, error: { name: 'SecurityError', message: 'Origen no permitido.' } };
    }
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: { name: err.name || 'Error', message: err.message || String(err) } };
    }
  });
}

// Los datos que llegan de la ventana se limpian igual que en la app web.
const cleanProduct = (p) => {
  if (!p || typeof p !== 'object') throw new TypeError('Producto inválido.');
  const clean = Inventory.normalizeProduct(p, { keepDates: true });
  if (!clean.name) throw new TypeError('El producto no tiene nombre.');
  return clean;
};

function registerIpc() {
  handle('store:listProducts', () => store.listProducts());
  handle('store:saveProduct', (p) => store.saveProduct(cleanProduct(p)));
  handle('store:deleteProduct', (id) => store.deleteProduct(String(id)));
  handle('store:replaceAllProducts', (list) => {
    if (!Array.isArray(list)) throw new TypeError('Lista inválida.');
    return store.replaceAllProducts(list.map(cleanProduct));
  });
  handle('store:getSettings', () => store.getSettings());
  handle('store:saveSettings', (s) => store.saveSettings(Inventory.normalizeSettings(s)));

  handle('file:save', async ({ name, content } = {}) => {
    const safeName = path.basename(String(name || 'archivo'));
    const ext = path.extname(safeName).slice(1).toLowerCase();
    const filters = ext === 'json' ? [{ name: 'Copia de seguridad', extensions: ['json'] }]
      : ext === 'csv' ? [{ name: 'CSV (Excel)', extensions: ['csv'] }]
      : [{ name: 'Todos los archivos', extensions: ['*'] }];
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Guardar',
      defaultPath: path.join(app.getPath('documents'), safeName),
      filters,
    });
    if (canceled || !filePath) return false;
    await fsp.writeFile(filePath, String(content ?? ''), 'utf8');
    return true;
  });

  handle('file:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Restaurar copia de seguridad',
      defaultPath: app.getPath('documents'),
      properties: ['openFile'],
      filters: [{ name: 'Copia de seguridad', extensions: ['json'] }, { name: 'Todos los archivos', extensions: ['*'] }],
    });
    if (canceled || !filePaths[0]) return null;
    const stat = await fsp.stat(filePaths[0]);
    if (stat.size > MAX_OPEN_FILE_BYTES) throw new Error('El archivo es demasiado grande.');
    return { name: path.basename(filePaths[0]), text: await fsp.readFile(filePaths[0], 'utf8') };
  });

  handle('app:info', () => ({ version: app.getVersion(), dataDir: store.dir, backupDir: store.backupDir }));
  handle('app:openDataFolder', async () => {
    const err = await shell.openPath(store.dir);
    if (err) throw new Error(err);
    return true;
  });
}

// ---------- Ventana y menú ----------

function buildMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        { label: 'Abrir carpeta de datos', click: () => shell.openPath(store.dir) },
        { type: 'separator' },
        { label: 'Salir', role: 'quit' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Recargar', role: 'reload' },
        { type: 'separator' },
        { label: 'Acercar', role: 'zoomIn' },
        { label: 'Alejar', role: 'zoomOut' },
        { label: 'Tamaño normal', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Pantalla completa', role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ label: 'Herramientas de desarrollo', role: 'toggleDevTools' }]),
      ],
    },
    {
      label: 'Ayuda',
      submenu: [{
        label: 'Acerca de Inventario',
        click: () => dialog.showMessageBox(win, {
          type: 'info',
          title: 'Acerca de Inventario',
          message: `Inventario ${app.getVersion()}`,
          detail: `Tus datos se guardan en:\n${store.file}\n\nCada día se hace una copia automática en:\n${store.backupDir}`,
        }),
      }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#f5f6f8',
    title: 'Inventario',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // La ventana solo muestra la app: no navega a otras páginas ni abre ventanas nuevas.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => { if (!process.env.INVENTARIO_SMOKE_TEST) win.show(); });
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(ROOT, 'index.html'));
}

// Solo la cámara (video), nada de micrófono, ubicación, etc.
function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const types = (details && details.mediaTypes) || [];
    callback(permission === 'media' && types.length > 0 && types.every(t => t === 'video'));
  });
  ses.setPermissionCheckHandler((wc, permission) => permission === 'media');
}

async function reportLoad(result) {
  if (result.status === 'recovered') {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Datos recuperados',
      message: 'El archivo de datos estaba dañado y se recuperó la copia automática más reciente.',
      detail: `Copia usada: ${path.basename(result.from)}\nEl archivo dañado se guardó aparte en:\n${result.damaged}`,
    });
  } else if (result.status === 'damaged') {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Datos dañados',
      message: 'El archivo de datos estaba dañado y no había copias automáticas para recuperarlo.',
      detail: `La app empieza vacía. Puedes usar "Restaurar" con una copia de seguridad.\nEl archivo dañado se guardó aparte en:\n${result.damaged}`,
    });
  }
}

// ---------- Inicio y cierre ----------

if (!app.requestSingleInstanceLock()) {
  // Ya hay una ventana abierta: dos a la vez podrían pisarse los datos.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    store = createFileStore(dataDir());
    try {
      await reportLoad(await store.load());
    } catch (err) {
      dialog.showErrorBox('No se pudo abrir la carpeta de datos', `${dataDir()}\n\n${err.message}`);
      app.exit(1);
      return;
    }
    setupPermissions();
    registerIpc();
    buildMenu();
    createWindow();
    if (process.env.INVENTARIO_SMOKE_TEST && !app.isPackaged) require('../tests/electron-smoke').run(win, store);
  });

  // Antes de salir, esperar a que termine cualquier guardado pendiente.
  let flushed = false;
  app.on('before-quit', (e) => {
    if (flushed || !store) return;
    e.preventDefault();
    store.flush().finally(() => { flushed = true; app.quit(); });
  });

  app.on('window-all-closed', () => app.quit());
}
