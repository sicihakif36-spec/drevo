// Картинки для демо-семьи (bin/demo.js): «старые фотографии» и скан документа, нарисованные без сторонних библиотек.
// Рисунок задаётся в долях кадра, поэтому одна и та же сцена рисуется и целиком, и миниатюрой.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import path from 'node:path';
import PDFDocument from 'pdfkit';

function png(w, h, color) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = color(x / w, y / h, w / h);
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const sepia = (t) => [Math.round(70 + 160 * t), Math.round(55 + 140 * t), Math.round(40 + 105 * t)];
const noise = (x, y) => (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;

// Люди: x — середина, h — рост (доля высоты кадра), light — светлая одежда.
function photo(people) {
  return (u, v, aspect) => {
    let t = 0.75 - v * 0.25; // фон: светлее сверху
    if (v > 0.78) t = 0.45; // пол
    for (const p of people) {
      const top = 0.92 - p.h;
      const dx = (u - p.x) * aspect;
      const head = Math.hypot(dx, v - (top + 0.07)) < 0.065;
      const body = v > top + 0.13 && v < 0.92 && Math.abs(dx) < 0.11 + (v - top) * 0.12;
      if (head) t = 0.62;
      else if (body) t = p.light ? 0.85 : 0.22;
    }
    const vignette = Math.hypot(u - 0.5, v - 0.5) * 0.9;
    return sepia(Math.max(0, Math.min(1, t - vignette * vignette + noise(u, v) * 0.04)));
  };
}

function scan(u, v) {
  let c = [236, 228, 205];
  const line = Math.floor((v - 0.2) / 0.045);
  const inLine = v > 0.2 && v < 0.82 && (v - 0.2) % 0.045 < 0.012;
  if (inLine && u > 0.12 && u < 0.88 - (line % 3) * 0.12 && noise(Math.floor(u * 40), line) > 0.25) c = [70, 60, 90];
  if (v > 0.08 && v < 0.13 && u > 0.3 && u < 0.7) c = [40, 35, 50]; // заголовок
  if (Math.abs(Math.hypot(u - 0.75, (v - 0.88) * 1.4) - 0.07) < 0.008) c = [120, 60, 150]; // печать
  return c.map((x) => Math.round(x - noise(u, v) * 10));
}

export const DEMO_MEDIA = {
  group: { draw: photo([{ x: 0.2, h: 0.62 }, { x: 0.4, h: 0.55, light: true }, { x: 0.6, h: 0.66 }, { x: 0.8, h: 0.5, light: true }]), w: 1280, h: 860 },
  wedding: { draw: photo([{ x: 0.38, h: 0.66 }, { x: 0.62, h: 0.58, light: true }]), w: 900, h: 1200 },
  portrait: { draw: photo([{ x: 0.5, h: 0.8 }]), w: 900, h: 1200 },
  scan: { draw: scan, w: 1700, h: 2400 },
};

// Снимок и миниатюра (до 400 px) в PNG.
export function demoImage(name) {
  const { draw, w, h } = DEMO_MEDIA[name];
  const k = 400 / Math.max(w, h);
  return { full: png(w, h, draw), thumb: png(Math.round(w * k), Math.round(h * k), draw) };
}

export function demoLetter(file) {
  const require = createRequire(import.meta.url);
  const font = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf', 'DejaVuSerif.ttf');
  const doc = new PDFDocument({ size: 'A5', margin: 50 });
  const out = fs.createWriteStream(file);
  doc.pipe(out);
  doc.font(font).fontSize(16).text('Письмо с фронта', { align: 'center' }).moveDown();
  doc.fontSize(12).text('Здравствуй, дорогой брат Петя!\n\nПишу тебе с передовой. Жив, здоров, чего и вам желаю. '
    + 'Кормят хорошо, вчера получили тёплые вещи. Передай маме, чтобы не волновалась, и поцелуй за меня Клаву.\n\n'
    + 'Твой брат Василий.\nМарт 1942 года.');
  doc.end();
  return new Promise((resolve) => out.on('finish', resolve));
}

// «Голос» для истории: WAV, 16 кГц, моно. Слоги — тон с плавающей высотой и паузами, похоже на речь издали.
export function demoVoice(seconds = 20) {
  const rate = 16000;
  const n = rate * seconds;
  const data = Buffer.alloc(n * 2);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const syllable = (t * 3.2) % 1; // около трёх слогов в секунду
    const pause = Math.floor(t / 2.7) % 3 === 2 && t % 2.7 > 2.1; // паузы между фразами
    const env = pause ? 0 : Math.sin(Math.PI * syllable) ** 2;
    const pitch = 150 + 40 * Math.sin(t * 1.3) + 25 * Math.sin(t * 7.1);
    phase += (2 * Math.PI * pitch) / rate;
    const v = env * (0.5 * Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase));
    data.writeInt16LE(Math.round(v * 12000), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // моно
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
