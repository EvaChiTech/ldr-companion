/**
 * Generates the extension's PNG icons with no image dependencies.
 *
 * Draws an original mark: a rounded square in the app's brand red with a
 * two-lobe heart cut out of it, rendered by evaluating an implicit curve per
 * pixel and supersampling the edges for smoothness.
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons')

const BRAND = [0xC4, 0x59, 0x4A]
const PAPER = [0xFA, 0xF6, 0xEE]

/** Standard heart curve: (x^2+y^2-1)^3 - x^2*y^3 <= 0. */
function inHeart(x, y) {
  const a = x * x + y * y - 1
  return a * a * a - x * x * y * y * y <= 0
}

/** Rounded square with corner radius r, on [-1,1]^2. */
function inSquircle(x, y, r) {
  const ax = Math.abs(x), ay = Math.abs(y)
  const dx = Math.max(ax - (1 - r), 0)
  const dy = Math.max(ay - (1 - r), 0)
  return dx * dx + dy * dy <= r * r
}

function renderRGBA(size) {
  const px = Buffer.alloc(size * size * 4)
  const SS = 3                      // supersample grid per axis
  const r = 0.34                     // corner radius
  const scale = 1.42                 // heart size within the tile

  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let inside = 0, heart = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((pxi + (sx + 0.5) / SS) / size) * 2 - 1
          const v = ((py + (sy + 0.5) / SS) / size) * 2 - 1
          if (inSquircle(u, v, r)) inside++
          // Flip v: image y grows downward, the curve expects y up.
          if (inHeart(u * scale, -v * scale + 0.18)) heart++
        }
      }
      const n = SS * SS
      const aTile  = inside / n
      const aHeart = heart / n

      // Composite heart (paper) over tile (brand), then alpha by tile coverage.
      const col = [0, 1, 2].map(i => Math.round(BRAND[i] * (1 - aHeart) + PAPER[i] * aHeart))
      const o = (py * size + pxi) * 4
      px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]
      px[o + 3] = Math.round(aTile * 255)
    }
  }
  return px
}

// -- minimal PNG writer -------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8     // bit depth
  ihdr[9] = 6     // colour type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  // Raw scanlines, each prefixed with filter type 0 (None).
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(outDir, { recursive: true })
for (const size of [16, 48, 128]) {
  const file = join(outDir, `icon${size}.png`)
  writeFileSync(file, encodePNG(size, renderRGBA(size)))
  console.log(`  wrote ${file}`)
}
