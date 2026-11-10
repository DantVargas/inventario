// Elige dónde se guardan los datos. La interfaz solo usa window.Store.
//
// Todo almacenamiento debe tener estas funciones (todas devuelven una Promise):
//   listProducts()            -> Producto[]
//   saveProduct(producto)     -> crea o actualiza (por id)
//   deleteProduct(id)
//   replaceAllProducts(lista) -> reemplaza todo de una vez (todo o nada)
//   getSettings()             -> { storeName, currency } o null
//   saveSettings(ajustes)
//
// Orden de elección:
//   1. window.desktopAPI.storage -> versión de escritorio (Electron/Tauri), p. ej. archivo SQLite
//   2. index.html?demo           -> memoria con productos de ejemplo
//   3. index.html?storage=memory -> memoria vacía (pruebas)
//   4. IndexedDB del navegador   -> por defecto
(function (global) {
  'use strict';

  function pick() {
    if (global.desktopAPI && global.desktopAPI.storage) return global.desktopAPI.storage;
    const adapters = global.StorageAdapters || {};
    const params = new URLSearchParams(global.location.search);
    if (params.has('demo')) return adapters.memory({ demo: true });
    if (params.get('storage') === 'memory') return adapters.memory();
    return adapters.indexeddb();
  }

  try {
    global.Store = pick();
  } catch (err) {
    global.Store = null;
    global.StoreError = err;
  }
})(window);
