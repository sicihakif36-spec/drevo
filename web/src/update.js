// Новая версия на сервере. Приложение хранит себя на телефоне и компьютере (service worker), поэтому
// после выкладки сначала открывается прежняя версия, а новая скачивается в фоне. Когда она скачалась
// и заступила (controllerchange), перезагружаемся при следующем переходе между экранами — не посреди правки.
// Когда приложение снова на экране (вернулись из другого приложения), заодно спрашиваем сервер, нет ли новой.
export function watchUpdates(router) {
  const sw = navigator.serviceWorker;
  if (!sw?.controller) return; // первый вход или Ctrl+F5: страница и так свежая
  let fresh = false;
  sw.addEventListener('controllerchange', () => { fresh = true; });
  router.afterEach((to, from) => {
    if (fresh && from.matched.length) location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sw.getRegistration().then((r) => r?.update()).catch(() => {});
  });
}
