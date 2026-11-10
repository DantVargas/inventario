// Operaciones que dependen de dónde corre la app: guardar y abrir archivos.
// En el navegador se descarga o se elige un archivo; en escritorio se usarán
// los diálogos nativos de Windows vía window.desktopAPI.
//
//   saveFile({ name, content, mime }) -> Promise<boolean>  (false si el usuario canceló)
//   openFile({ accept })              -> Promise<{ name, text } | null>
(function (global) {
  'use strict';

  const browser = {
    kind: 'browser',

    saveFile({ name, content, mime }) {
      const url = URL.createObjectURL(new Blob([content], { type: mime }));
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return Promise.resolve(true);
    },

    openFile({ accept = '' } = {}) {
      return new Promise((resolve, reject) => {
        const input = Object.assign(document.createElement('input'), { type: 'file', accept });
        input.addEventListener('change', () => {
          const file = input.files[0];
          if (!file) return resolve(null);
          file.text().then(text => resolve({ name: file.name, text }), reject);
        }, { once: true });
        input.addEventListener('cancel', () => resolve(null), { once: true });
        input.click();
      });
    },
  };

  const d = global.desktopAPI;
  global.Platform = d && d.saveFile && d.openFile
    ? { kind: 'desktop', saveFile: d.saveFile, openFile: d.openFile }
    : browser;
})(window);
