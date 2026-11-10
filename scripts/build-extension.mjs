/**
 * Builds the MV3 extension into dist-extension/.
 *
 * Three passes are needed because MV3 wants different module formats in
 * different places:
 *   1. content.js      -> IIFE single file (content scripts can't be ES modules)
 *   2. background.js   -> ES module (service_worker declares "type": "module")
 *   3. popup.html      -> normal vite HTML build
 * Static files (manifest, page bridge, CSS, icons) are copied verbatim.
 *
 * The web app's own `npm run build` is untouched: different config, different
 * output directory.
 */

import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { mkdir, copyFile, readdir, rm, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const root    = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir  = join(root, 'extension', 'src')
const extDir  = join(root, 'extension')
const outDir  = join(root, 'dist-extension')

const common = {
  root,
  configFile: false,
  envDir: root,                 // picks up the project's existing .env
  publicDir: false,             // do NOT copy the web app's public/ into the extension
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': '"production"' },
}

async function buildContent() {
  await build({
    ...common,
    build: {
      outDir,
      emptyOutDir: false,
      target: 'chrome116',
      minify: false,            // keep reviewable; extension size is not critical
      lib: {
        entry: join(srcDir, 'content.js'),
        name: 'LdrTheater',
        formats: ['iife'],
        fileName: () => 'content.js',
      },
      rollupOptions: {
        output: { extend: true },
      },
    },
  })
}

async function buildBackground() {
  await build({
    ...common,
    build: {
      outDir,
      emptyOutDir: false,
      target: 'chrome116',
      minify: false,
      lib: {
        entry: join(srcDir, 'background.js'),
        formats: ['es'],
        fileName: () => 'background.js',
      },
    },
  })
}

async function buildPopup() {
  await build({
    ...common,
    build: {
      outDir: join(outDir, '_popup'),
      emptyOutDir: true,
      target: 'chrome116',
      minify: false,
      rollupOptions: {
        input: join(srcDir, 'popup.html'),
        output: {
          entryFileNames: 'popup.js',
          assetFileNames: '[name][extname]',
        },
      },
    },
  })

  // Vite nests HTML output under its source path; flatten it to the root.
  const nested = join(outDir, '_popup', 'extension', 'src', 'popup.html')
  const flat   = join(outDir, '_popup', 'popup.html')
  const htmlSrc = existsSync(nested) ? nested : flat

  let html = await readFile(htmlSrc, 'utf8')
  html = html
    .replace(/(?:\.\.\/)+/g, '')
    .replace(/src="\/?popup\.js"/, 'src="popup.js"')
    // chrome-extension:// pages don't need (and can trip over) crossorigin.
    .replace(/\s+crossorigin(?:="[^"]*")?/g, '')
    .replace(/href="\/?([\w.-]+\.css)"/g, 'href="$1"')
  await writeFile(join(outDir, 'popup.html'), html, 'utf8')

  for (const f of await readdir(join(outDir, '_popup'))) {
    if (f === 'popup.js' || f.endsWith('.css')) {
      await copyFile(join(outDir, '_popup', f), join(outDir, f))
    }
  }
  await rm(join(outDir, '_popup'), { recursive: true, force: true })
}

async function copyStatic() {
  await copyFile(join(extDir, 'manifest.json'), join(outDir, 'manifest.json'))
  await copyFile(join(srcDir, 'page-bridge.js'), join(outDir, 'page-bridge.js'))
  await copyFile(join(srcDir, 'overlay.css'), join(outDir, 'overlay.css'))

  const iconsSrc = join(extDir, 'icons')
  if (existsSync(iconsSrc)) {
    await mkdir(join(outDir, 'icons'), { recursive: true })
    for (const f of await readdir(iconsSrc)) {
      await copyFile(join(iconsSrc, f), join(outDir, 'icons', f))
    }
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  await buildContent()
  await buildBackground()
  await buildPopup()
  await copyStatic()

  console.log(`\n  LDR Theater extension built -> ${outDir}`)
  console.log('  Load it: chrome://extensions -> Developer mode -> Load unpacked\n')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
