// Поток сборки PDF (см. pdfpool.js): получает вид листа, данные и настройки, отдаёт готовый файл целиком.
import { parentPort } from 'node:worker_threads';
import { PassThrough } from 'node:stream';
import { renderPdf } from './routes/print.js';
import { renderCard } from './card.js';
import { renderBlank } from './blank.js';
import { renderRospis } from './rospis.js';

const RENDER = { tree: renderPdf, card: renderCard, blank: (out, _, o) => renderBlank(out, o), rospis: renderRospis };

parentPort.on('message', ({ id, kind, data, o }) => {
  const fail = (e) => parentPort.postMessage({ id, error: String(e?.stack || e) });
  try {
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    out.on('error', fail);
    out.on('end', () => {
      const buf = Buffer.concat(chunks);
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
      parentPort.postMessage({ id, pdf: ab }, [ab]);
    });
    RENDER[kind](out, data, o);
  } catch (e) {
    fail(e);
  }
});
