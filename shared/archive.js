// Напоминание о семейном архиве «Скачать всё». Общий код телефона и сервера (server/src/push.js, routes/archive.js).
export const ARCHIVE_DAYS = 30; // через сколько дней после скачивания напоминать
export const LATER_DAYS = 7; // «Напомнить позже»

// «24 сентября (30 дней назад)», «вчера», «сегодня»; другой год — с годом. Дни — по Москве.
export function lastText(at, now = new Date()) {
  const day = (t) => Math.floor((new Date(t).getTime() + 3 * 3600000) / 86400000);
  const days = day(now) - day(at);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  const d = new Date(at);
  const opts = { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' };
  if (d.toLocaleDateString('ru-RU', { year: 'numeric', timeZone: 'Europe/Moscow' }) !== new Date(now).toLocaleDateString('ru-RU', { year: 'numeric', timeZone: 'Europe/Moscow' })) opts.year = 'numeric';
  const a = days % 10;
  const b = days % 100;
  const word = a === 1 && b !== 11 ? 'день' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'дня' : 'дней';
  return `${d.toLocaleDateString('ru-RU', opts).replace(/\s*г\.$/, '')} (${days} ${word} назад)`;
}

// Подсказка, где хранить: одна и та же в окне «Скачать всё» и в «прочтите.txt».
export const KEEP_HINT = 'Сохраните архив на компьютер и на флешку. Раз в год перепишите его ещё на один носитель.';
