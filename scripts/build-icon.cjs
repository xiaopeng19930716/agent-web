const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = 'generated-images/code4/Modern_flat_app_icon_for_an_AI_2026-08-26T12-57-18.png';
const OUT = 'electron/build/icon.ico';
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function dibHeader(w, h) {
  const b = Buffer.alloc(40);
  b.writeUInt32LE(40, 0);              // biSize
  b.writeInt32LE(w, 4);                // biWidth
  b.writeInt32LE(h * 2, 8);            // biHeight (XOR + AND)
  b.writeUInt16LE(1, 12);              // biPlanes
  b.writeUInt16LE(32, 14);             // biBitCount = 32
  b.writeUInt32LE(w * h * 4, 20);      // biSizeImage
  return b;
}

function xorBGRA(data, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;   // bottom-up
    const dst = y * w * 4;
    for (let x = 0; x < w; x++) {
      const s = src + x * 4, d = dst + x * 4;
      out[d] = data[s + 2];             // B
      out[d + 1] = data[s + 1];         // G
      out[d + 2] = data[s];             // R
      out[d + 3] = data[s + 3];         // A
    }
  }
  return out;
}

function andMask(w, h) {
  const rowBytes = ((w + 31) >> 5) << 2;
  return Buffer.alloc(rowBytes * h);    // all 0 => fully opaque
}

async function main() {
  if (!fs.existsSync(SRC)) { console.error('Source missing:', SRC); process.exit(1); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const parts = [];
  const entries = [];
  let offset = 6 + SIZES.length * 16;

  for (const s of SIZES) {
    const r = await sharp(SRC)
      .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = r.info.width, h = r.info.height;
    const img = Buffer.concat([dibHeader(w, h), xorBGRA(r.data, w, h), andMask(w, h)]);
    entries.push({ w, h, len: img.length, offset });
    parts.push(img);
    offset += img.length;
  }

  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(SIZES.length, 4);

  const entryBufs = entries.map(e => {
    const b = Buffer.alloc(16);
    b.writeUInt8(e.w >= 256 ? 0 : e.w, 0);
    b.writeUInt8(e.h >= 256 ? 0 : e.h, 1);
    b.writeUInt16LE(1, 4);
    b.writeUInt16LE(32, 6);
    b.writeUInt32LE(e.len, 8);
    b.writeUInt32LE(e.offset, 12);
    return b;
  });

  fs.writeFileSync(OUT, Buffer.concat([dir, ...entryBufs, ...parts]));
  console.log('ICO written:', OUT, '| entries:', SIZES.length,
    '| self-check biBitCount:', dibHeader(256, 256).readUInt16LE(14));
}

main().catch(e => { console.error(e); process.exit(1); });
