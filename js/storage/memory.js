// Almacenamiento en memoria: no guarda nada al cerrar.
// Sirve para las pruebas y para la demo (abrir index.html?demo).
(function (global) {
  'use strict';

  const DEMO_PRODUCTS = [
    ['7790001', 'Arroz largo fino 1 kg', 'Almacén', 'unidad', 1.2, 1.9, 48, 10],
    ['7790002', 'Aceite de girasol 900 ml', 'Almacén', 'unidad', 2.1, 3.2, 6, 8],
    ['7790003', 'Yerba mate 500 g', 'Almacén', 'unidad', 2.5, 3.9, 22, 5],
    ['7790010', 'Leche entera 1 L', 'Lácteos', 'litro', 0.9, 1.35, 3, 12],
    ['7790011', 'Queso cremoso', 'Lácteos', 'kg', 6.5, 9.8, 4.75, 2],
    ['7790020', 'Detergente 750 ml', 'Limpieza', 'unidad', 1.6, 2.6, 15, 4],
    ['7790021', 'Lavandina 2 L', 'Limpieza', 'unidad', 1.1, 1.7, 0, 3],
    ['7790030', 'Gaseosa cola 2,25 L', 'Bebidas', 'unidad', 1.8, 2.9, 36, 12],
  ].map(([sku, name, category, unit, cost, price, stock, minStock]) => ({
    id: 'demo-' + sku, sku, name, category, unit, cost, price, stock, minStock, notes: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }));

  function createMemoryStorage({ demo = false } = {}) {
    const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
    const products = new Map();
    let settings = demo ? { storeName: 'Almacén de ejemplo (demo)', currency: '$' } : null;
    if (demo) DEMO_PRODUCTS.forEach(p => products.set(p.id, clone(p)));

    // Igual que IndexedDB: el código no se puede repetir.
    function checkSku(p, pool) {
      if (!p.sku) return;
      for (const o of pool) {
        if (o.id !== p.id && o.sku === p.sku) {
          const err = new Error(`Código repetido: ${p.sku}`);
          err.name = 'ConstraintError';
          throw err;
        }
      }
    }

    const later = (fn) => new Promise((resolve, reject) => setTimeout(() => {
      try { resolve(fn()); } catch (e) { reject(e); }
    }, 0));

    return {
      kind: demo ? 'demo' : 'memory',
      listProducts: () => later(() => [...products.values()].map(clone)),
      saveProduct: (p) => later(() => { checkSku(p, products.values()); products.set(p.id, clone(p)); }),
      deleteProduct: (id) => later(() => { products.delete(id); }),
      replaceAllProducts: (list) => later(() => {
        list.forEach((p, i) => checkSku(p, list.slice(0, i)));
        products.clear();
        list.forEach(p => products.set(p.id, clone(p)));
      }),
      getSettings: () => later(() => clone(settings)),
      saveSettings: (value) => later(() => { settings = clone(value); }),
    };
  }

  (global.StorageAdapters = global.StorageAdapters || {}).memory = createMemoryStorage;
})(typeof window !== 'undefined' ? window : globalThis);
