// Generates the PWA icons as PNGs with zero dependencies (raw PNG encoding
// via node:zlib). Run: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(outDir, { recursive: true });

// --- minimal PNG encoder (RGBA, 8-bit) ---
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- icon artwork ---
// Deep indigo rounded square with a white "launch" arrow rising off a baseline.
const BG_TOP = [79, 70, 229]; // #4f46e5
const BG_BOT = [55, 48, 163]; // #3730a3
const FG = [255, 255, 255];

function drawIcon(size, { maskable = false, radiusRatio = 0.22 } = {}) {
  const SS = 4; // supersampling factor
  const S = size * SS;
  const px = new Float64Array(S * S * 4);
  const radius = maskable ? 0 : S * radiusRatio;

  const inRoundedRect = (x, y) => {
    if (!radius) return true;
    const rx = Math.max(radius - x, x - (S - 1 - radius), 0);
    const ry = Math.max(radius - y, y - (S - 1 - radius), 0);
    return rx * rx + ry * ry <= radius * radius;
  };

  // Glyph geometry, in unit coords (0..1). Maskable keeps within center 60%.
  const g = maskable ? 0.62 : 0.78; // glyph scale
  const cx = 0.5;
  const arrowTipY = 0.5 - 0.30 * g;
  const arrowBaseY = 0.5 + 0.06 * g;
  const arrowHalfW = 0.21 * g;
  const stemHalfW = 0.075 * g;
  const stemBottom = 0.5 + 0.24 * g;
  const barY = 0.5 + 0.34 * g;
  const barHalf = 0.26 * g;
  const barH = 0.055 * g;

  const inGlyph = (xu, yu) => {
    // triangle head
    if (yu >= arrowTipY && yu <= arrowBaseY) {
      const t = (yu - arrowTipY) / (arrowBaseY - arrowTipY);
      if (Math.abs(xu - cx) <= t * arrowHalfW) return true;
    }
    // stem
    if (yu >= arrowBaseY - 0.001 && yu <= stemBottom && Math.abs(xu - cx) <= stemHalfW) return true;
    // baseline bar
    if (Math.abs(yu - barY) <= barH / 2 && Math.abs(xu - cx) <= barHalf) return true;
    return false;
  };

  for (let y = 0; y < S; y += 1) {
    const t = y / (S - 1);
    const bg = [
      BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t,
      BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t,
      BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t,
    ];
    for (let x = 0; x < S; x += 1) {
      const i = (y * S + x) * 4;
      if (!inRoundedRect(x, y)) continue; // transparent
      const [r, gr, b] = inGlyph(x / S, y / S) ? FG : bg;
      px[i] = r;
      px[i + 1] = gr;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }

  // Downsample SS×SS boxes → final pixel buffer.
  const out = Buffer.alloc(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0, g2 = 0, b = 0, a = 0;
      for (let dy = 0; dy < SS; dy += 1) {
        for (let dx = 0; dx < SS; dx += 1) {
          const i = ((y * SS + dy) * S + (x * SS + dx)) * 4;
          r += px[i]; g2 += px[i + 1]; b += px[i + 2]; a += px[i + 3];
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g2 / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, out);
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['maskable-192.png', 192, { maskable: true }],
  ['maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
];
for (const [name, size, opts] of targets) {
  writeFileSync(join(outDir, name), drawIcon(size, opts));
  console.log(`wrote icons/${name}`);
}
