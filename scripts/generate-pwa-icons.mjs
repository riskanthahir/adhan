import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const publicDir = path.resolve(process.cwd(), 'public');
fs.mkdirSync(publicDir, { recursive: true });

// Pure Node CRC32 implementation for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgbaBuffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0
    rgbaBuffer.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderIcon(size, maskable = false) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  // Safe-zone scale: maskable uses smaller inner artwork (~68% radius) so 15% outer edges are pure background
  const scale = maskable ? 0.72 : 0.9;
  const crescentR = size * 0.27 * scale;
  const crescentOffset = size * 0.085 * scale;
  const starX = cx + size * 0.12 * scale;
  const starY = cy - size * 0.06 * scale;
  const starR = size * 0.045 * scale;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Subtle deep emerald vertical gradient (#0D472B -> #115E42)
      const t = y / size;
      let r = Math.round(13 + t * 5);
      let g = Math.round(71 + t * 23);
      let b = Math.round(43 + t * 23);
      let a = 255;

      // Subtle outer ring frame
      const dx = x - cx;
      const dy = y - cy;
      const distFromCenter = Math.hypot(dx, dy);
      const ringRadius = size * 0.39 * scale;
      if (Math.abs(distFromCenter - ringRadius) < size * 0.008) {
        r = Math.round(r * 0.65 + 212 * 0.35);
        g = Math.round(g * 0.65 + 175 * 0.35);
        b = Math.round(b * 0.65 + 55 * 0.35);
      }

      // Crescent moon (outer circle minus shifted inner circle)
      const outerD = Math.hypot(x - (cx - size * 0.02 * scale), y - cy);
      const innerD = Math.hypot(x - (cx + crescentOffset), y - (cy - size * 0.02 * scale));
      if (outerD <= crescentR && innerD >= crescentR * 0.84) {
        // Anti-aliased edge
        const edge = Math.min(1, Math.max(0, crescentR - outerD + 0.8), Math.max(0, innerD - crescentR * 0.84 + 0.8));
        r = Math.round(r * (1 - edge) + 248 * edge);
        g = Math.round(g * (1 - edge) + 250 * edge);
        b = Math.round(b * (1 - edge) + 252 * edge);
      }

      // Warm gold accent star circle
      const starD = Math.hypot(x - starX, y - starY);
      if (starD <= starR + 0.8) {
        const edge = Math.min(1, Math.max(0, starR + 0.8 - starD));
        r = Math.round(r * (1 - edge) + 212 * edge);
        g = Math.round(g * (1 - edge) + 175 * edge);
        b = Math.round(b * (1 - edge) + 55 * edge);
      }

      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = a;
    }
  }

  return encodePNG(size, size, buf);
}

const targets = [
  { name: 'pwa-192x192.png', size: 192, maskable: false },
  { name: 'pwa-512x512.png', size: 512, maskable: false },
  { name: 'pwa-maskable-512x512.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180, maskable: false },
];

for (const t of targets) {
  const png = renderIcon(t.size, t.maskable);
  fs.writeFileSync(path.join(publicDir, t.name), png);
  console.log(`Generated ${t.name} (${png.length} bytes)`);
}
