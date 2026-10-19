# Sembradía

App web instalable (PWA) para planificar la siembra según tu provincia y llevar los riegos y cuidados de tus plantas.

## Qué hace

- **Calendario** de siembra por provincia, ajustado a la altitud del huerto.
- **Mis plantas**: plantas agrupadas por tipo y ubicación, con ficha, diario de fotos y cuidados.
- **Recordatorios** de riego, abono, cambio de sustrato y poda.
- **Consejos** de siembra y cuidado por especie.
- **Funciona sin conexión** y se puede instalar en la pantalla de inicio del móvil.
- **Avisos diarios** con las tareas del día.

Los datos (plantas, fotos, ajustes) se guardan solo en el dispositivo, en IndexedDB.

## Desarrollo

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # versión de producción en dist/
npm run preview  # sirve dist/ para probar la PWA
```

## Estructura

- `index.html`: estructura de la página.
- `src/main.js`: arranque; abre el almacén y carga la app.
- `src/app.js`: datos de especies y provincias, lógica y pintado de las pestañas.
- `src/styles.css`: estilos y colores (modo claro y oscuro).
- `src/store.js`: almacén clave-valor sobre IndexedDB (migra los datos del prototipo desde localStorage).
- `src/notify.js`: avisos, instalación y registro del service worker.
- `src/sw.js`: service worker (caché sin conexión y avisos con la app cerrada).
- `public/ilus/`: ilustraciones del fondo. `public/icons/`: iconos de la app.

## Código postal

- `public/cp.json`: códigos postales → municipios (nombre, coordenadas y provincia). Generado a partir del paquete [spanish-cities-info](https://github.com/ManuelCebreiro/spanish-cities-info) (licencia ISC, datos del INE). Se descarga solo la primera vez que se escribe un código postal.
- La altitud del municipio se consulta en la [API de elevación de Open-Meteo](https://open-meteo.com/en/docs/elevation-api). Sin conexión, la altitud se puede escribir a mano.

## Avisos

- Con la app abierta, se muestra un aviso al día con las tareas pendientes.
- En Android (Chrome, app instalada) también se avisa con la app cerrada mediante *Periodic Background Sync*; el navegador decide la hora exacta.
- En iPhone los avisos necesitan la app añadida a la pantalla de inicio. Los avisos con la app cerrada en iPhone requieren notificaciones push con servidor (fase de cuentas y sincronización).

## Publicación

El flujo `.github/workflows/deploy.yml` publica la app en GitHub Pages en cada cambio en `main`.
Hay que activarlo una vez en *Settings → Pages → Source: GitHub Actions*.
