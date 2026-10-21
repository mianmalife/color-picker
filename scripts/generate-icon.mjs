import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const directory = join(import.meta.dirname, '../resources')
mkdirSync(directory, { recursive: true })
function crc32(data) { let crc = -1; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1)) } return (crc ^ -1) >>> 0 }
function chunk(type, data) { const kind = Buffer.from(type); const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([kind, data]))); return Buffer.concat([size, kind, data, crc]) }
function distance(x, y, ax, ay, bx, by) { const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2))); return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)) }
function png(size) {
  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + .5) / size * 64, py = (y + .5) / size * 64
    const edge = Math.hypot(Math.max(0, Math.abs(px - 32) - 17), Math.max(0, Math.abs(py - 32) - 17))
    const alpha = Math.max(0, Math.min(1, (14 - edge) * size / 64)) * 255
    const pipette = Math.min(distance(px, py, 18, 45, 40, 23), distance(px, py, 34, 17, 47, 30), distance(px, py, 41, 17, 47, 23)) < 3.2
    const offset = y * (1 + size * 4) + 1 + x * 4
    raw.set(pipette ? [24, 43, 20, alpha] : [181, 228, 137, alpha], offset)
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const images = [png(32), png(256)]
const header = Buffer.alloc(6 + images.length * 16); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)
let offset = header.length
images.forEach((image, i) => { const base = 6 + i * 16; header[base] = header[base + 1] = i === 0 ? 32 : 0; header.writeUInt16LE(1, base + 4); header.writeUInt16LE(32, base + 6); header.writeUInt32LE(image.length, base + 8); header.writeUInt32LE(offset, base + 12); offset += image.length })
writeFileSync(join(directory, 'icon.ico'), Buffer.concat([header, ...images]))
writeFileSync(join(directory, 'icon.png'), images[1])
