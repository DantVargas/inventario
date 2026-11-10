// Almacenamiento de la versión de escritorio: un archivo JSON en la carpeta de datos.
//
//   <carpeta de datos>/inventario.json            datos actuales
//   <carpeta de datos>/copias-automaticas/*.json  una copia por día (se guardan las últimas 30)
//
// Cada escritura va primero a un archivo temporal y luego lo reemplaza: si el equipo
// se apaga a mitad de camino, el archivo anterior queda intacto.
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const FILE_VERSION = 1;
const MAX_BACKUPS = 30;

const today = () => new Date().toISOString().slice(0, 10);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function constraintError(message) {
  const err = new Error(message);
  err.name = 'ConstraintError';
  return err;
}

// Igual que el índice único de IndexedDB: dos productos no pueden tener el mismo código.
function checkUniqueSkus(products) {
  const seen = new Set();
  for (const p of products) {
    if (!p.sku) continue;
    if (seen.has(p.sku)) throw constraintError(`Código repetido: ${p.sku}`);
    seen.add(p.sku);
  }
}

function isValidData(d) {
  return d && typeof d === 'object' && Array.isArray(d.products);
}

function createFileStore(dir) {
  const file = path.join(dir, 'inventario.json');
  const backupDir = path.join(dir, 'copias-automaticas');
  let data = { version: FILE_VERSION, settings: null, products: [] };
  let queue = Promise.resolve();

  async function readData(p) {
    const d = JSON.parse(await fsp.readFile(p, 'utf8'));
    if (!isValidData(d)) throw new Error('El archivo no tiene el formato esperado.');
    return { version: FILE_VERSION, settings: d.settings || null, products: d.products };
  }

  // En Windows, un antivirus o el indexador pueden bloquear el archivo un instante: se reintenta.
  async function renameWithRetry(from, to) {
    for (let i = 0; ; i++) {
      try { return await fsp.rename(from, to); } catch (err) {
        if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
        await wait(100 * (i + 1));
      }
    }
  }

  async function writeData(d) {
    const tmp = file + '.tmp';
    const handle = await fsp.open(tmp, 'w');
    try {
      await handle.writeFile(JSON.stringify(d, null, 1), 'utf8');
      await handle.sync(); // asegura que quedó en el disco antes de reemplazar
    } finally {
      await handle.close();
    }
    await renameWithRetry(tmp, file);
  }

  async function listBackups() {
    const names = await fsp.readdir(backupDir).catch(() => []);
    return names.filter(n => /^inventario-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()
      .map(n => path.join(backupDir, n));
  }

  // Copia del estado con que arranca el día; borra las más viejas.
  async function dailyBackup() {
    const target = path.join(backupDir, `inventario-${today()}.json`);
    if (!fs.existsSync(target) && fs.existsSync(file)) await fsp.copyFile(file, target);
    const backups = await listBackups();
    for (const old of backups.slice(0, Math.max(0, backups.length - MAX_BACKUPS))) {
      await fsp.unlink(old).catch(() => {});
    }
  }

  // Devuelve { status: 'new' | 'ok' | 'recovered' | 'damaged', from?, damaged? }.
  async function load() {
    await fsp.mkdir(backupDir, { recursive: true });
    try {
      data = await readData(file);
    } catch (err) {
      if (err.code === 'ENOENT') return { status: 'new' };
      // Archivo dañado: se aparta (no se borra) y se recupera la copia automática más reciente.
      const damaged = `${file}.danado-${stamp()}`;
      await fsp.rename(file, damaged).catch(() => {});
      for (const backup of (await listBackups()).reverse()) {
        try {
          data = await readData(backup);
          await writeData(data);
          return { status: 'recovered', from: backup, damaged };
        } catch { /* probar la anterior */ }
      }
      data = { version: FILE_VERSION, settings: null, products: [] };
      return { status: 'damaged', damaged };
    }
    await dailyBackup();
    return { status: 'ok' };
  }

  // Ejecuta los cambios de a uno. Solo se aplican en memoria si se guardaron bien en el disco.
  function change(fn) {
    const run = queue.then(async () => {
      const next = fn({ ...data, products: [...data.products] });
      await writeData(next);
      data = next;
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    file,
    dir,
    backupDir,
    load,
    flush: () => queue,
    listProducts: async () => data.products,
    getSettings: async () => data.settings,
    saveProduct: (p) => change(d => {
      const i = d.products.findIndex(o => o.id === p.id);
      if (i >= 0) d.products[i] = p; else d.products.push(p);
      checkUniqueSkus(d.products);
      return d;
    }),
    deleteProduct: (id) => change(d => {
      d.products = d.products.filter(o => o.id !== id);
      return d;
    }),
    replaceAllProducts: (list) => change(d => {
      checkUniqueSkus(list);
      d.products = [...list];
      return d;
    }),
    saveSettings: (settings) => change(d => {
      d.settings = settings;
      return d;
    }),
  };
}

module.exports = { createFileStore };
