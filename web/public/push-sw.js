// Уведомления на телефон: подключается в service worker (vite.config.js, workbox.importScripts).
// Сервер присылает { title, body, url, tag } (server/src/push.js).
self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data.text() };
  }
  event.waitUntil(self.registration.showNotification(msg.title || 'Древо', {
    body: msg.body || '',
    tag: msg.tag,
    renotify: Boolean(msg.tag),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    lang: 'ru',
    data: { url: msg.url || '/' },
  }));
});

// Нажатие: открытое приложение переходит в нужное место, а если его нет — открывается.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (!win) return self.clients.openWindow(url);
    win.postMessage({ type: 'drevo-open', url });
    return win.focus();
  })());
});

// Браузер сам сменил подписку — сообщить серверу новую.
self.addEventListener('pushsubscriptionchange', (event) => {
  const options = event.oldSubscription?.options;
  if (!options) return;
  event.waitUntil((async () => {
    const sub = event.newSubscription || await self.registration.pushManager.subscribe(options);
    await fetch('/api/push/subscription', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'x-drevo': '1', 'content-type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    });
  })());
});
