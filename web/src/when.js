// Когда это было — по-человечески: «сегодня, 14:05», «вчера, 9:12», «24 октября, 14:05», «3 марта 2025».
export function whenText(t) {
  if (!t) return '';
  const d = new Date(t);
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const time = d.toLocaleTimeString('ru-RU', { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((day(now) - day(d)) / 86400000);
  if (days === 0) return `сегодня, ${time}`;
  if (days === 1) return `вчера, ${time}`;
  if (d.getFullYear() !== now.getFullYear()) return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(' г.', '');
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, ${time}`;
}
