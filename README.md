# Inventario

App para gestionar el inventario de cualquier tienda o comercio. Funciona sin internet, como **programa de Windows** (Electron) o directamente en el navegador.

## Cómo usarla

| Qué | Cómo |
|---|---|
| **Instalar el programa** | Ejecuta `dist\Inventario Setup 1.0.0.exe`. Crea un acceso directo en el escritorio y en el menú Inicio. |
| Usarla en el navegador, sin instalar | Abre `index.html` con doble clic (Chrome, Edge o Firefox). |
| Ver una demo con productos de ejemplo | Abre `index.html?demo` en el navegador. Los cambios no se guardan. |

## Desarrollo

Necesita [Node.js](https://nodejs.org) (versión 22.12 o más nueva).

| Comando | Qué hace |
|---|---|
| `npm install` | Instala Electron y las herramientas (solo la primera vez). |
| `npm start` | Abre la app de escritorio sin instalarla, para probar cambios. |
| `npm run dist` | Genera el instalador en `dist/`. |
| `npm run pack` | Genera solo la carpeta del programa (`dist/win-unpacked`), sin instalador. Es más rápido. |
| `npm test` | Pruebas del almacenamiento en archivo (7). |
| `tests/test.html` | Ábrelo en el navegador: pruebas de la lógica y del escáner (17). |

Al cambiar la versión en `package.json` (por ejemplo `1.0.1`) y volver a correr `npm run dist`, el nuevo instalador actualiza el programa sin borrar los datos.

## Qué hace

- **Productos:** código/SKU, nombre, categoría, unidad, costo, precio, stock, stock mínimo y notas. Los números aceptan coma o punto.
- **Stock:** botones −/+ para mover de a 1. Al hacer clic en el número de stock se abre **Ajustar stock**:
  - **Entrada:** suma, por ejemplo al recibir mercadería.
  - **Salida:** resta, y avisa si no alcanza.
  - **Fijar total:** pone el número que contaste en el recuento.
- **Resumen:** productos, valor del inventario a costo y a venta, **stock bajo** y **sin stock**. Al hacer clic en esas dos tarjetas se filtra la tabla.
- **Recargo y margen:**
  - Recargo = (precio − costo) ÷ costo.
  - Margen = (precio − costo) ÷ precio.

  Ejemplo: si un producto cuesta 100 y se vende a 150, tiene un recargo del 50% y un margen del 33%.
- **Escanear códigos de barras con la cámara:** botón **Escanear** en la barra.
  - Si el producto existe, se abre el ajuste de stock con cantidad 1 ya puesta. Enter aplica, o escribes otra cantidad encima. Se recuerda si la última vez fue entrada o salida.
  - Si no existe, ofrece crearlo con el código ya cargado.
  - **Modo rápido:** después de cada producto la cámara se vuelve a abrir sola. Para salir, cancela un ajuste o cierra el escáner.
  - En el formulario de producto, el botón con el icono de código de barras al lado de **Código** lo rellena escaneando.
  - Lee EAN-13, EAN-8, UPC, Code 128, Code 39, Code 93, ITF, Codabar y QR, sin internet.
  - **Lector USB:** escanea en el buscador. Si el código existe, o si son 6 dígitos o más, al pulsar Enter pasa lo mismo que con la cámara.
- **Búsqueda y filtros:** por texto (atajo `/`), por categoría y por estado del stock. Para ordenar, haz clic en cualquier columna.
- **Ajustes:** nombre del comercio y símbolo de moneda.
- **Archivos:**
  - Exportar a CSV para Excel.
  - Copia de seguridad y restauración en JSON. La restauración conserva las fechas, avisa si hay registros inválidos y, si algo falla, no cambia nada.

## Dónde se guardan los datos

**Programa de escritorio:** en un archivo en el equipo:

```
%APPDATA%\Inventario\datos\inventario.json              datos actuales
%APPDATA%\Inventario\datos\copias-automaticas\           una copia por día (se guardan las últimas 30)
```

- Se llega rápido desde **Ajustes → Abrir carpeta de datos**, o desde el menú **Archivo**.
- Cada cambio se guarda al instante. Si se corta la luz mientras se guarda, el archivo anterior queda intacto.
- Si el archivo se daña, al abrir la app se recupera solo la copia automática más reciente. El archivo dañado se guarda aparte, no se borra.
- Desinstalar el programa **no** borra los datos.
- Igual conviene hacer de vez en cuando una **Copia de seguridad** en un pendrive o en la nube, por si se rompe el disco.

**Navegador:** en el navegador (IndexedDB) de ese equipo. Si borras los datos de navegación, se pierde el inventario. Haz copias de seguridad seguido.

**Pasar los datos del navegador al programa:** en el navegador, usa **Copia de seguridad**. En el programa, usa **Restaurar** y elige ese archivo.

## Estructura

```
index.html               Pantalla
css/styles.css           Estilos
js/core/inventory.js     Lógica de negocio pura (cálculos, validaciones, import/export)
js/storage/index.js      Elige dónde guardar y define la interfaz que debe cumplir
js/storage/indexeddb.js  Guardar en el navegador
js/storage/memory.js     Guardar en memoria (pruebas y demo)
js/platform.js           Guardar/abrir archivos (navegador hoy, diálogos nativos mañana)
js/scanner.js            Cámara y lectura de códigos de barras
vendor/zxing/            Biblioteca ZXing 0.23.0 (lectura de códigos; licencia Apache-2.0)
js/app.js                Interfaz: solo usa Inventory, Store y Platform
electron/main.js         Programa de escritorio: ventana, menú, permisos, diálogos nativos
electron/preload.js      Puente seguro: expone window.desktopAPI a la ventana
electron/file-store.js   Guardado en archivo con copias automáticas
electron/start.js        Lanzador de "npm start"
electron/icon.png        Icono del programa
tests/test.html          Pruebas de la lógica y del escáner (navegador)
tests/file-store.test.js Pruebas del guardado en archivo (Node)
tests/electron-smoke.js  Prueba automática de la app de escritorio (solo desarrollo)
```

### Cómo encaja la versión de escritorio

La pantalla (`index.html` + `js/`) es la misma en el navegador y en el programa. La pantalla no sabe dónde se guardan los datos: solo usa `window.Store` y `window.Platform`.

En Electron, `preload.js` expone `window.desktopAPI`. Cuando `js/storage/index.js` y `js/platform.js` lo detectan:

- Los datos van a `file-store.js` en lugar de IndexedDB.
- Copia de seguridad, Exportar CSV y Restaurar usan los diálogos de Windows.

**Seguridad:** la ventana no tiene acceso a Node (`contextIsolation`, `sandbox`) y solo puede pedir las operaciones de `preload.js`. El proceso principal vuelve a validar cada producto con `js/core/inventory.js`. La app solo puede usar la cámara, nunca el micrófono. Además, no navega a otras páginas.

**Nota para VS Code:** si `electron .` no abre ninguna ventana, es porque la terminal tiene definida `ELECTRON_RUN_AS_NODE`. Usa `npm start`, que la quita sola.

## Consejos para escanear con la cámara

- En el navegador, la primera vez pide permiso para usar la cámara: hay que **permitirlo**. En el programa de escritorio no pregunta. Si Windows la bloquea, revisa **Configuración → Privacidad y seguridad → Cámara → Permitir que las aplicaciones de escritorio accedan a la cámara**.
- Buena luz, el código **horizontal** dentro del recuadro y a unos 15–25 cm. Si la imagen se ve borrosa, aleja un poco el producto: muchas webcams no enfocan de cerca.
- Si hay varias cámaras, aparece un selector y la elegida se recuerda.
- Para escanear muchos productos seguidos, un lector USB (unos pocos dólares) es aún más rápido y ya funciona con el buscador.

## Créditos

- Lectura de códigos: [ZXing for JS](https://github.com/zxing-js/library) (`@zxing/library` 0.23.0), licencia Apache-2.0. Ver `vendor/zxing/LICENSE`.
- Programa de escritorio: [Electron](https://www.electronjs.org) 44.9.3 y [electron-builder](https://www.electron.build) 26.18.0, licencia MIT.

## Próximo paso sugerido para el instalador

El instalador no tiene firma digital. Por eso, la primera vez Windows puede mostrar "Windows protegió su PC". Se sigue con **Más información → Ejecutar de todas formas**. Para que no aparezca hace falta un certificado de firma de código, que es pago. Para usarlo en tu propio comercio no hace falta.

## Próximos pasos posibles

- Historial de entradas y salidas: cada ajuste de stock ya pasa por un único lugar (`applyAdjustment`), así que se puede registrar fácilmente.
- Importar productos desde CSV o Excel.
- Reportes: valor por categoría, productos más vendidos.
