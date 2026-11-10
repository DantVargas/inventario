// Puente seguro entre la ventana y el proceso principal.
// Expone window.desktopAPI con la misma forma que esperan js/storage/index.js y js/platform.js.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (r && r.ok) return r.value;
  const err = new Error((r && r.error && r.error.message) || 'Error desconocido');
  if (r && r.error && r.error.name) err.name = r.error.name;
  throw err;
}

contextBridge.exposeInMainWorld('desktopAPI', {
  storage: {
    kind: 'desktop',
    listProducts: () => call('store:listProducts'),
    saveProduct: (p) => call('store:saveProduct', p),
    deleteProduct: (id) => call('store:deleteProduct', id),
    replaceAllProducts: (list) => call('store:replaceAllProducts', list),
    getSettings: () => call('store:getSettings'),
    saveSettings: (s) => call('store:saveSettings', s),
  },
  saveFile: (opts) => call('file:save', opts),
  openFile: (opts) => call('file:open', opts),
  getInfo: () => call('app:info'),
  openDataFolder: () => call('app:openDataFolder'),
});
