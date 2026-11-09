# Inventario

App web local para gestionar el inventario de cualquier tienda o comercio. No hace falta instalar nada ni tener internet.

## Cómo usarla

Abre `index.html` con doble clic. Funciona en Chrome, Edge o Firefox.

## Qué hace (versión 1)

- Alta, edición y baja de productos: código/SKU, nombre, categoría, unidad, costo, precio, stock, stock mínimo y notas.
- Botones +/− para ajustar el stock rápido.
- Búsqueda por nombre, código o categoría. Pulsa `/` para ir al buscador.
- Filtro por categoría y por "solo stock bajo".
- Ordenar la tabla haciendo clic en cualquier columna.
- Resumen: cantidad de productos, unidades, valor del inventario a costo y a precio de venta, y productos con stock bajo.
- Margen de ganancia por producto.
- Ajustes: nombre del comercio y símbolo de moneda.
- Exportar a CSV (se abre en Excel) y copia de seguridad / restauración en JSON.

## Dónde se guardan los datos

En el propio navegador (IndexedDB), en este equipo. Por eso:

- Si borras los datos de navegación del navegador, se pierde el inventario.
- Otro navegador u otro equipo no ve los mismos datos.

**Haz copias de seguridad seguido** con el botón "Copia de seguridad".

## Estructura

```
index.html       Interfaz
css/styles.css   Estilos
js/db.js         Almacenamiento (IndexedDB)
js/app.js        Lógica de la app
```

## Próximos pasos posibles

- Registro de entradas y salidas (compras, ventas, ajustes) con historial.
- Alertas y reportes (más vendidos, valor por categoría).
- Lector de código de barras: buscar o sumar stock al escanear.
- Importar productos desde un CSV o Excel.
