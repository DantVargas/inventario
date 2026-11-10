// Almacenamiento en el navegador (IndexedDB).
// Usa la misma base de datos que la versión anterior, así no se pierde nada.
(function (global) {
  'use strict';

  function createIndexedDBStorage({ name = 'inventario' } = {}) {
    if (!global.indexedDB) throw new Error('Este navegador no permite guardar datos (IndexedDB no disponible).');
    let dbPromise = null;

    function open() {
      if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
          const req = global.indexedDB.open(name, 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('products')) {
              const store = db.createObjectStore('products', { keyPath: 'id' });
              // Dos productos no pueden tener el mismo código. Los que no tienen código no entran.
              store.createIndex('sku', 'sku', { unique: true });
            }
            if (!db.objectStoreNames.contains('settings')) {
              db.createObjectStore('settings', { keyPath: 'key' });
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error('La base de datos está abierta en otra pestaña con una versión distinta. Ciérrala y recarga.'));
        });
      }
      return dbPromise;
    }

    // Ejecuta fn en una transacción. Si fn devuelve una petición, resuelve con su resultado.
    async function run(storeName, mode, fn) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const out = fn(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Operación cancelada.'));
      });
    }

    return {
      kind: 'indexeddb',
      listProducts: () => run('products', 'readonly', s => s.getAll()),
      saveProduct: (p) => run('products', 'readwrite', s => { s.put(p); }),
      deleteProduct: (id) => run('products', 'readwrite', s => { s.delete(id); }),
      // En una sola transacción: si algo falla, no se borra nada.
      replaceAllProducts: (list) => run('products', 'readwrite', s => {
        s.clear();
        list.forEach(p => s.put(p));
      }),
      getSettings: async () => {
        const row = await run('settings', 'readonly', s => s.get('general'));
        return row ? row.value : null;
      },
      saveSettings: (value) => run('settings', 'readwrite', s => { s.put({ key: 'general', value }); }),
    };
  }

  (global.StorageAdapters = global.StorageAdapters || {}).indexeddb = createIndexedDBStorage;
})(window);
