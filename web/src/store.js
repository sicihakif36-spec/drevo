import { reactive } from 'vue';
import { api } from './api.js';
import { buildIndex } from '@shared/names.js';

export const store = reactive({
  ready: false,
  me: null,
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
    store.me = (await api('GET', '/api/me')).user;
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
  } catch (e) {
    if (e.status === 401) store.me = null;
    else if (e.status === 0) store.offline = true;
    else store.error = e.message;
  }
}

export const canEdit = () => store.me && store.me.role !== 'viewer';
export const isOwner = () => store.me?.role === 'owner';

// Подтягивать правки родственников, когда приложение снова на экране.
document.addEventListener('visibilitychange', () => { if (!document.hidden && store.me) loadTree(); });
setInterval(() => { if (!document.hidden && store.me) loadTree(); }, 60000);
