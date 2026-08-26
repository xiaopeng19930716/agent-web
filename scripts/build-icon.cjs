const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = 'generated-images/code4/Modern_flat_app_icon_for_an_AI_2026-08-26T12-57-18.png';
const OUT = 'electron/build/icon.ico';
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function createIconDir(count) {
  const buf = Buffer.alloc(6);
  buf.writeUInt16LE(0, 0);
  buf.writeUInt16LE(1, 2);
  buf.writeUInt16LE(count, 4);
  return buf;
}

function createIconDirEntry(width, height, size, offset) {
  const buf = Buffer.alloc(16);
  buf.writeUInt8(width === 256 ? 0 : width, 0);
  buf.writeUInt8(height === 256 ? 0 : height, 1);
  buf.writeUInt8(0, 2);
  buf.writeUInt8(0, 3);
  buf.writeUInt16LE(1, 4);
  buf.writeUInt16LE(32, 6);
  buf.writeUInt32LE(size, 8);
  buf.writeUInt32LE(offset, 12);
  return buf;
}

function createBitmapInfoHeader(width, height) {
  const buf = Buffer.alloc(40);
  buf.writeUInt32LE(40, 0);
  buf.writeInt32LE(width, 4);
  buf.writeInt32LE(height * 2, 8);
  buf.writeUInt16LE(1, 12);
  buf.writeUInt16LE(32, 14);
  buf.writeUInt32LE(0, 16);
  buf.writeUInt32LE(width * height * 4, 20);
  buf.writeInt32LE(0, 24);
  buf.writeInt32LE(0, 28);
  buf.writeUInt32LE(0, 32);
  buf.writeUInt32LE(0, 36);
  return buf;
}

function createXOR(data, width, height) {
  const rowSize = width * 4;
  const buf = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * rowSize;
    const dstRow = y * rowSize;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 4;
      buf[d] = data[s + 2];
      buf[d + 1] = data[s + 1];
      buf[d + 2] = data[s];
      buf[d + 3] = data[s + 3];
    }
  }
  return buf;
}

function createAND(width, height) {
  const rowBytes = ((width + 31) >> 5) << 2;
  return Buffer.alloc(rowBytes * height);
}

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error('Source icon not found:', SRC);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const images = [];
  for (const size of SIZES) {
    const { data, info } = await sharp(SRC)
      .resize(size, size, { fit: 'cover', position: 'center' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    images.push({ width: info.width, height: info.height, data });
  }

  const dir = createIconDir(images.length);
  const entries = [];
  const imageBuffers = [];
  let offset = 6 + images.length * 16;

  for (const img of images) {
    const header = createBitmapInfoHeader(img.width, img.height);
    const xor = createXOR(img.data, img.width, img.height);
    const andMask = createAND(img.width, img.height);
    const imageBuf = Buffer.concat([header, xor, andMask]);
    entries.push(createIconDirEntry(img.width, img.height, imageBuf.length, offset));
    imageBuffers.push(imageBuf);
    offset += imageBuf.length;
  }

  fs.writeFileSync(OUT, Buffer.concat([dir, ...entries, ...imageBuffers]));
  console.log('ICO written:', OUT, `(${images.length} sizes)`);
}

main().catch(err => { console.error(err); process.exit(1); });
