// Анкеты для родственников: подписи состояний и отправка ссылки.
import { toast } from './store.js';

export const STATUS = {
  sent: 'ссылка отправлена',
  filling: 'заполняется',
  submitted: 'заполнена — можно загрузить',
  loaded: 'загружена в дерево',
  revoked: 'отозвана',
  expired: 'срок ссылки истёк',
};

// how: 'share' — меню «Поделиться» телефона (если его нет — скопировать), 'copy' — скопировать.
export async function shareSurvey(link, how) {
  const text = `Здравствуйте! Расскажите, пожалуйста, о нашей семье — заполните анкету по ссылке: ${link.url}`;
  if (how === 'share' && navigator.share) {
    try { await navigator.share({ title: 'Анкета о семье', text }); return; } catch { return; /* отмена */ }
  }
  try {
    await navigator.clipboard.writeText(link.url);
    toast('Ссылка скопирована');
  } catch {
    toast('Не удалось скопировать — выделите ссылку и скопируйте вручную');
  }
}
