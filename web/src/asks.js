// «Спросить у родных»: окно вопроса (одно на всё приложение, App.vue) и отправка ссылки.
import { reactive } from 'vue';
import { toast } from './store.js';
import { shareText } from '@shared/asks.js';

export { STATUS } from '@shared/asks.js';

// person — id человека; text, field, research_id — готовый вопрос (из находки проверки или исследования).
export const askSheet = reactive({ open: false, person: null, text: '', field: '', research_id: null });
export function openAsk({ person, text = '', field = '', research_id = null }) {
  Object.assign(askSheet, { open: true, person, text, field, research_id });
}

// how: 'share' — меню «Поделиться» телефона (WhatsApp, Telegram, SMS); если его нет — скопировать. 'copy' — скопировать.
export async function shareAsk(link, how) {
  const text = shareText(link.from, link.about, link.url);
  if (how === 'share' && navigator.share) {
    try { await navigator.share({ title: 'Вопрос о семье', text }); return; } catch { return; /* отмена */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Скопировано — вставьте в сообщение');
  } catch {
    toast('Не удалось скопировать — выделите ссылку и скопируйте вручную');
  }
}

// «24 октября», в прошлые годы — «24 октября 2025».
export const when = (t) => {
  const d = new Date(t);
  const year = d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year }).replace(/\s*г\.$/, '');
};
