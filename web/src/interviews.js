// Интервью голосом: отправка ссылки тому, кто ответит сам (как у вопросов родным, asks.js).
import { toast } from './store.js';

const text = (from, url) => `${from ? `${from} просит` : 'Вас просят'} вас рассказать о своей жизни и о семье — голосом, по одному вопросу. `
  + `Можно отвечать в несколько заходов, всё сохраняется сразу. Откройте ссылку: ${url}`;

// how: 'share' — меню «Поделиться» телефона; если его нет — скопировать. 'copy' — скопировать.
export async function shareInterview(link, how) {
  const t = text(link.from, link.url);
  if (how === 'share' && navigator.share) {
    try { await navigator.share({ title: 'Расскажите о семье', text: t }); return; } catch { return; /* отмена */ }
  }
  try {
    await navigator.clipboard.writeText(t);
    toast('Скопировано — вставьте в сообщение');
  } catch {
    toast('Не удалось скопировать — выделите ссылку и скопируйте вручную');
  }
}
