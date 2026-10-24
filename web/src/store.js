import { reactive } from 'vue';
import { api } from './api.js';
import { buildIndex } from '@shared/names.js';

export const store = reactive({
  ready: false,
  me: null,
  // Вход по ссылке на новом телефоне ждёт пароль: { name }.
  pending: null,
  tree: null,
  idx: null,
  title: '',
  error: '',
  offline: false,
  toast: '',
});

let toastTimer;
export function toast(text) {
  store.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (store.toast = ''), 3200);
}

export async function loadMe() {
  try {
    const r = await api('GET', '/api/me');
    store.me = r.user;
    store.pending = r.pending || null;
    if (!r.user) forget();
  } catch (e) {
    store.offline = e.status === 0;
  }
  store.ready = true;
}

export async function loadTree() {
  try {
    const t = await api('GET', '/api/tree');
    store.tree = t;
    store.idx = buildIndex(t);
    store.me = t.me;
    store.title = t.settings?.title || 'Семейное древо';
    store.offline = false;
    listen();
  } catch (e) {
    if (e.status === 401) await loadMe();
    else if (e.status === 0) store.offline = true;
    else store.error = e.message;
  }
}

// Вышли (или вывели с другого устройства) — на телефоне не остаётся сохранённого дерева и фото.
export function forget() {
  if (typeof caches === 'undefined') return;
  for (const name of ['tree', 'photos']) caches.delete(name).catch(() => {});
}

// Участник или владелец без пароля пока только смотрит: правка — после того, как придумает пароль.
export const needsPassword = () => Boolean(store.me?.needs_password);

// Правят дерево владелец и участник. Родственник видит всё, как участник, и обсуждает, но не правит; гость у живых видит только имена.
export const canEdit = () => ['owner', 'editor'].includes(store.me?.role) && !needsPassword();
export const isGuest = () => store.me?.role === 'viewer';
// Обсуждать и смотреть историю правок — все, кроме гостей.
export const canTalk = () => Boolean(store.me) && !isGuest();
export const isOwner = () => store.me?.role === 'owner' && !needsPassword();

// Обновления у всех сразу: сервер сообщает о правках (GET /api/events), телефон перечитывает нужное.
// События: { kind: 'tree' } — дерево изменилось, { kind: 'comments', person_id } — новое в обсуждении
// (без person_id — неизвестно где, перечитать открытое), { kind: 'asks' } — в вопросах родным.
const watchers = new Set();
// Открытый экран подписывается: fn(events) перечитывает своё. Возвращает отписку.
export function onLive(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

let source = null;
let missed = false; // связь прерывалась: события за это время потеряны
let glued = [];
let glueTimer;

// Одно действие родственника — несколько событий подряд: перечитываем один раз.
function soon(...events) {
  glued.push(...events);
  clearTimeout(glueTimer);
  glueTimer = setTimeout(refresh, 200);
}

async function refresh() {
  const events = glued;
  glued = [];
  // Сначала открытые экраны (лента отмечает новое просмотренным), потом дерево с точкой «есть новое».
  await Promise.allSettled([...watchers].map((fn) => fn(events)));
  await loadTree();
}

function listen() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events');
  source.onopen = () => {
    if (missed) soon({ kind: 'tree' }, { kind: 'comments' }, { kind: 'asks' });
    missed = false;
  };
  source.addEventListener('tree', () => soon({ kind: 'tree' }));
  source.addEventListener('comments', (e) => soon({ kind: 'comments', ...JSON.parse(e.data) }));
  source.addEventListener('asks', () => soon({ kind: 'asks' }));
  source.onerror = () => {
    missed = true;
    // Обрыв связи браузер переподключает сам, а после ответа с ошибкой (сервер перезапускается) — бросает.
    if (source.readyState === EventSource.CLOSED) {
      source.close();
      source = null;
    }
  };
}

const live = () => Boolean(source) && source.readyState === EventSource.OPEN;

// Вернулись в приложение — перечитать дерево. Если потока нет, раз в минуту перечитывать и пробовать снова.
document.addEventListener('visibilitychange', () => { if (!document.hidden && store.me) loadTree(); });
setInterval(() => { if (!document.hidden && store.me && !live()) loadTree(); }, 60000);
