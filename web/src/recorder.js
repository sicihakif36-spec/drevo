// Запись голоса для интервью. Отличия от VoiceRecorder.vue: длинные ответы (до 20 минут), экран не гаснет (Wake Lock, где есть),
// а запись по ходу, каждую секунду, откладывается в память телефона (IndexedDB): сел телефон или закрыли приложение посреди
// рассказа — при следующем открытии интервью запись можно досохранить. После отправки на сервер отложенное стирается.
import { onUnmounted, ref } from 'vue';
import { IV_LIMIT } from '@shared/interview.js';

// Сначала mp4 (AAC): его играют и Android, и iPhone. Иначе webm — так пишет Chrome на Android.
const TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
// Сервер принимает файл до 20 МБ. 20 минут при 64 кбит/с — около 10 МБ; если телефон пишет крупнее, останавливаемся раньше.
const MAX_BYTES = 18 * 1024 * 1024;

const ext = (type) => (type.includes('mp4') ? 'm4a' : type.split('/')[1] || 'webm');
export const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------- Отложенная запись в IndexedDB ----------
// Куски записи: { key, type, data }. key — «где ответ»: «<интервью>:<вопрос>».

let dbp = null;
function idb() {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('drevo-zapis', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('chunks', { autoIncrement: true }).createIndex('key', 'key');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }).catch(() => null);
  return dbp;
}
async function run(mode, fn) {
  const db = typeof indexedDB === 'undefined' ? null : await idb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction('chunks', mode);
      const out = fn(t.objectStore('chunks'));
      t.oncomplete = () => resolve(out?.result ?? out ?? null);
      t.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
const keep = (key, type, data) => run('readwrite', (s) => { s.add({ key, type, data }); });
export const forget = (key) => run('readwrite', (s) => {
  const c = s.index('key').openCursor(IDBKeyRange.only(key));
  c.onsuccess = () => { if (c.result) { c.result.delete(); c.result.continue(); } };
});
// Отложенные записи с ключами, начинающимися с prefix: [{ key, blob, name }].
export async function leftovers(prefix) {
  const all = await run('readonly', (s) => s.getAll());
  const out = new Map();
  for (const x of all || []) {
    if (!String(x.key).startsWith(prefix)) continue;
    if (!out.has(x.key)) out.set(x.key, { key: x.key, type: x.type, parts: [] });
    out.get(x.key).parts.push(x.data);
  }
  return [...out.values()].map((x) => ({ key: x.key, blob: new Blob(x.parts, { type: x.type }), name: `golos.${ext(x.type)}` }))
    .filter((x) => x.blob.size > 0);
}

// ---------- Запись ----------

export function useRecorder() {
  const state = ref('idle'); // idle, asking — ждём разрешения на микрофон, recording
  const seconds = ref(0);
  const error = ref('');
  const cut = ref(''); // запись остановилась сама: 'time' — 20 минут, 'size' — большой файл
  let rec = null;
  let stream = null;
  let timer = null;
  let lock = null;
  let gone = false;

  async function wake() {
    try { lock = await navigator.wakeLock?.request('screen'); } catch { lock = null; }
  }
  // Свернули и вернулись — браузер снимает «не гасить экран», просим снова.
  const visible = () => { if (document.visibilityState === 'visible' && state.value === 'recording') wake(); };
  document.addEventListener('visibilitychange', visible);

  function release() {
    clearInterval(timer);
    timer = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    lock?.release().catch(() => {});
    lock = null;
  }

  // Начать запись. Обещание исполняется, когда запись кончилась: { blob, name, duration } или null (не вышло).
  async function start(key) {
    error.value = '';
    cut.value = '';
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      error.value = 'Этот телефон не умеет записывать голос в браузере. Напишите ответ заметкой.';
      return null;
    }
    state.value = 'asking';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      state.value = 'idle';
      error.value = e.name === 'NotAllowedError'
        ? 'Нет доступа к микрофону. Разрешите его для этого сайта в настройках браузера и нажмите «Записать» ещё раз.'
        : 'Не удалось включить микрофон.';
      return null;
    }
    if (gone) {
      release();
      return null;
    }
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const chunks = [];
    let bytes = 0;
    await forget(key);
    rec = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 64000 });
    const type = (rec.mimeType || mimeType || 'audio/webm').split(';')[0];
    const started = Date.now();
    return new Promise((resolve) => {
      rec.ondataavailable = (e) => {
        if (!e.data.size) return;
        chunks.push(e.data);
        keep(key, type, e.data);
        bytes += e.data.size;
        if (bytes > MAX_BYTES && rec?.state === 'recording') {
          cut.value = 'size';
          rec.stop();
        }
      };
      rec.onstop = () => {
        const sec = Math.max(1, Math.round((Date.now() - started) / 1000));
        release();
        rec = null;
        state.value = 'idle';
        if (!chunks.length) {
          error.value = 'Запись не получилась. Попробуйте ещё раз.';
          resolve(null);
          return;
        }
        resolve({ blob: new Blob(chunks, { type }), name: `golos.${ext(type)}`, duration: Math.min(sec, IV_LIMIT) });
      };
      rec.start(1000);
      seconds.value = 0;
      state.value = 'recording';
      wake();
      timer = setInterval(() => {
        seconds.value = Math.floor((Date.now() - started) / 1000);
        if (seconds.value >= IV_LIMIT) {
          cut.value = 'time';
          stop();
        }
      }, 250);
    });
  }

  function stop() {
    clearInterval(timer);
    if (rec?.state === 'recording') rec.stop();
  }

  onUnmounted(() => {
    gone = true;
    document.removeEventListener('visibilitychange', visible);
    // Ушли с экрана посреди записи: запись не теряется — она отложена и досохранится при следующем открытии.
    if (rec) {
      rec.onstop = null;
      if (rec.state === 'recording') rec.stop();
    }
    release();
  });

  return { state, seconds, error, cut, start, stop };
}
