// Установка Древа значком на экран: открыто ли оно уже значком, может ли браузер поставить его сам
// (Chrome, Яндекс Браузер на Android присылают beforeinstallprompt — ловим его сразу при запуске, пока экраны не открылись),
// и не открыто ли Древо внутри мессенджера, откуда поставить значок нельзя.
import { reactive } from 'vue';

const ua = navigator.userAgent;
export const isIos = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
// Браузер внутри Телеграма, Ватсапа, ВКонтакте и т. п. (на Android — WebView: «; wv)»).
export const inApp = /Telegram|WhatsApp|Instagram|FBAN|FBAV|VKClient|OKApp|Viber|; wv\)/i.test(ua);

const KEY = 'drevo.install';
const saved = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify({ ...saved(), ...v })); } catch { /* без памяти браузера */ } };

export const install = reactive({
  // Открыто значком с экрана — ставить уже нечего.
  standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  // Предложение браузера установить (кнопка «Установить»).
  event: null,
  // Уже поставили из этого браузера (Android сообщает appinstalled).
  installed: Boolean(saved().installed),
  // «Не сейчас» — до этого времени плашку на «Главной» не показываем.
  later: saved().later || 0,
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  install.event = e;
  install.installed = false;
});
window.addEventListener('appinstalled', () => {
  install.event = null;
  install.installed = true;
  save({ installed: true });
});

// Кнопка «Установить»: окно браузера «Установить приложение?».
export async function promptInstall() {
  const e = install.event;
  if (!e) return;
  install.event = null;
  e.prompt();
  const { outcome } = await e.userChoice.catch(() => ({}));
  if (outcome === 'accepted') {
    install.installed = true;
    save({ installed: true });
  }
}

// Предлагать ли поставить значок (плашка на «Главной»).
export const offerInstall = () => !install.standalone && !install.installed && Date.now() > install.later;

const DAYS_LATER = 14;
export function installLater() {
  install.later = Date.now() + DAYS_LATER * 24 * 3600 * 1000;
  save({ later: install.later });
}
