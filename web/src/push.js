// Уведомления на этом телефоне: подписка в браузере и на сервере (server/src/push.js), обработчики — public/push-sw.js.
import { api } from './api.js';

export const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// Service worker может быть не зарегистрирован (например, при разработке) — тогда ready не наступит.
const registration = () => (supported()
  ? Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 5000))])
  : Promise.resolve(null));

async function subscription() {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

const toKey = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
const sameKey = (sub, key) => {
  const a = new Uint8Array(sub.options?.applicationServerKey || []);
  const b = toKey(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

// 'on' — включены, 'off' — выключены, 'denied' — запрещены в настройках браузера,
// 'ios' — iPhone: сначала добавить на экран «Домой», 'unsupported' — браузер не умеет.
export async function pushState() {
  if (!supported()) return isIos && !standalone() ? 'ios' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  if (!reg) return 'unsupported';
  return Notification.permission === 'granted' && (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

// Разрешение спрашиваем только здесь — по нажатию кнопки.
export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  if (!reg) return 'unsupported';
  const { key } = await api('GET', '/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  // Подписка со старым ключом (сервер переустанавливали) не годится.
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  try {
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key) });
  } catch {
    throw new Error('Не получилось: браузер не связался со своей службой уведомлений. Проверьте интернет и попробуйте ещё раз.');
  }
  await api('PUT', '/api/push/subscription', sub.toJSON());
  return 'on';
}

// Выключить на этом телефоне (и при выходе из приложения).
export async function disablePush() {
  const sub = await subscription();
  if (!sub) return;
  await api('DELETE', '/api/push/subscription', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

export async function testPush() {
  const sub = await subscription();
  return api('POST', '/api/push/test', { endpoint: sub?.endpoint });
}

// При запуске: напомнить серверу о подписке этого телефона (вход мог смениться, а подписка в браузере осталась).
export async function syncPush() {
  if (!supported() || Notification.permission !== 'granted') return;
  const sub = await subscription();
  if (sub) await api('PUT', '/api/push/subscription', sub.toJSON()).catch(() => {});
}
