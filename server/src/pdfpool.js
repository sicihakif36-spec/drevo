// Сборка PDF вне основного потока: pdfkit считает синхронно, и роспись или дерево на тысячи человек
// заняли бы сервер на секунды — остальные запросы ждали бы. Здесь — несколько потоков (worker_threads),
// общих для всех листов (дерево, веер, карточка, бланк, роспись), и очередь: одновременно собирается не больше SIZE файлов.
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { HttpError } from './tree.js';

export const SIZE = Math.max(1, Math.min(2, (os.availableParallelism?.() ?? os.cpus().length) - 1));
export const QUEUE = 12; // сколько ждут своей очереди; дальше — «попробуйте позже»
const TIMEOUT = 5 * 60 * 1000;

const workers = []; // { w, job }
const queue = [];
let seq = 0;

function spawn() {
  const slot = { w: new Worker(new URL('./pdfworker.js', import.meta.url)), job: null };
  slot.w.unref();
  slot.w.on('message', (m) => {
    const job = slot.job;
    if (!job || m.id !== job.id) return;
    finish(slot);
    if (m.error) job.reject(new Error(m.error));
    else job.resolve(Buffer.from(m.pdf));
  });
  // Поток упал (например, не хватило памяти) — задание с ошибкой, поток заменяется новым.
  const dead = (e) => {
    const i = workers.indexOf(slot);
    if (i >= 0) workers.splice(i, 1);
    const job = slot.job;
    slot.job = null;
    clearTimeout(job?.timer);
    job?.reject(e instanceof Error ? e : new Error(`Сборка PDF прервалась (${e})`));
    next();
  };
  slot.w.on('error', dead);
  slot.w.on('exit', (code) => dead(code));
  workers.push(slot);
  return slot;
}

function finish(slot) {
  clearTimeout(slot.job.timer);
  slot.job = null;
  slot.w.unref();
  next();
}

function next() {
  while (queue.length) {
    const slot = workers.find((s) => !s.job) || (workers.length < SIZE ? spawn() : null);
    if (!slot) return;
    const job = queue.shift();
    slot.job = job;
    slot.w.ref(); // пока собирает — процесс не завершается
    job.timer = setTimeout(() => slot.w.terminate(), TIMEOUT);
    slot.w.postMessage({ id: job.id, kind: job.kind, data: job.data, o: job.o });
  }
}

// kind — tree | card | blank | rospis; данные уже с учётом прав и приватности. -> Buffer с PDF.
export function renderInWorker(kind, data, o) {
  if (queue.length >= QUEUE) {
    return Promise.reject(new HttpError(503, 'Сейчас печатается много листов. Попробуйте через минуту.'));
  }
  return new Promise((resolve, reject) => {
    queue.push({ id: ++seq, kind, data, o, resolve, reject });
    next();
  });
}

// Отправить готовый PDF: «Открыть» — в браузере, «Скачать» — файлом с именем name.
export async function sendPdf(reply, pdf, disposition) {
  const buf = await pdf;
  reply.header('Content-Type', 'application/pdf');
  reply.header('Content-Disposition', disposition);
  reply.header('Cache-Control', 'no-store');
  return reply.send(buf);
}

export async function closePool() {
  queue.splice(0).forEach((j) => j.reject(new Error('Сервер останавливается')));
  await Promise.all(workers.splice(0).map((s) => s.w.terminate()));
}
