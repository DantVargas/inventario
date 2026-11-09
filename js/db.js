// Capa de almacenamiento: IndexedDB del navegador.
// Los datos quedan guardados en este navegador y este equipo.
const DB = (() => {
  const NAME = 'inventario';
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('products')) {
            const store = db.createObjectStore('products', { keyPath: 'id' });
            // Índice único: dos productos no pueden tener el mismo código.
            // Los productos sin código (undefined) no entran en el índice.
            store.createIndex('sku', 'sku', { unique: true });
          }
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings', { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  // Ejecuta fn dentro de una transacción y resuelve cuando termina.
  async function run(storeName, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const out = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    getAllProducts: () => run('products', 'readonly', s => s.getAll()),
    putProduct: (p) => run('products', 'readwrite', s => s.put(p)),
    deleteProduct: (id) => run('products', 'readwrite', s => s.delete(id)),
    replaceAllProducts: (list) => run('products', 'readwrite', s => {
      s.clear();
      list.forEach(p => s.put(p));
    }),
    getSetting: async (key) => {
      const row = await run('settings', 'readonly', s => s.get(key));
      return row ? row.value : undefined;
    },
    setSetting: (key, value) => run('settings', 'readwrite', s => s.put({ key, value })),
  };
})();
