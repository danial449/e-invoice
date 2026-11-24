// Packs pre-rendered PNGs into a multi-size .ico (PNG-compressed entries).
const fs = require('node:fs')
const path = require('node:path')

const dir = process.argv[2]
const out = process.argv[3]
const SIZES = [16, 24, 32, 48, 64, 128, 256]

const images = SIZES.map((s) => {
  const f = path.join(dir, `${s}.png`)
  const data = fs.readFileSync(f)
  if (data.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${f} is not a PNG`)
  return { size: s, data }
})

const dirHeader = Buffer.alloc(6)
dirHeader.writeUInt16LE(0, 0)          // reserved
dirHeader.writeUInt16LE(1, 2)          // type: icon
dirHeader.writeUInt16LE(images.length, 4)

let offset = 6 + images.length * 16
const entries = images.map((im) => {
  const e = Buffer.alloc(16)
  e[0] = im.size >= 256 ? 0 : im.size   // 0 means 256
  e[1] = im.size >= 256 ? 0 : im.size
  e[2] = 0                              // palette colours
  e[3] = 0                              // reserved
  e.writeUInt16LE(1, 4)                 // colour planes
  e.writeUInt16LE(32, 6)                // bits per pixel
  e.writeUInt32LE(im.data.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += im.data.length
  return e
})

const ico = Buffer.concat([dirHeader, ...entries, ...images.map((i) => i.data)])
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, ico)
console.log(`wrote ${out}  ${(ico.length / 1024).toFixed(1)} KB  sizes ${SIZES.join('/')}`)
