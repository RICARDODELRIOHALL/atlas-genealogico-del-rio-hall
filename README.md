# Árbol Genealógico Del Río Hall

Aplicación independiente para la familia Del Río Hall. Los datos de inicio están incluidos en esta compilación.

## Privacidad

El Atlas sanitizado se conserva en `src/data/atlas.json.gz`; GitHub Actions lo restaura a `src/data/atlas.json` antes de ejecutar pruebas y build. El JavaScript de `dist/` incluye el árbol. GitHub Pages es alojamiento público: cualquiera que conozca o encuentre la URL puede leer la información. Ocultar la URL no restringe el acceso.

## Actualizaciones y datos locales

Al abrir por primera vez, la app copia el JSON incluido a IndexedDB. Las futuras actualizaciones del sitio no sustituyen ni fusionan automáticamente esos datos locales; se conservan los cambios realizados en el dispositivo. Para obtener el árbol nuevo incluido en una versión, descarga primero una copia de seguridad y usa **Datos → Restaurar datos originales incluidos**.

URL prevista: `https://RICARDODELRIOHALL.github.io/atlas-genealogico-del-rio-hall/`

Base de publicación: `/atlas-genealogico-del-rio-hall/`. El flujo de Pages ya está en `.github/workflows/deploy.yml`.

Instala dependencias con `npm ci` y crea la carpeta `dist/` con `npm run build`.
