// Справочник мест: место по старому делению — населённый пункт с видом, волость, уезд, губерния, страна — и как это сейчас.
// В карточках людей, браков и событий место — простой текст. Место из справочника записывается туда полным названием
// (placeTitle), и по этому тексту карточка места находит, кто здесь родился, венчался, жил, умер и похоронен.

// Вид населённого пункта. Новый вид — строчка здесь.
export const PLACE_KINDS = {
  village: 'деревня',
  selo: 'село',
  town: 'город',
  posad: 'посад',
  settlement: 'посёлок',
  sloboda: 'слобода',
  pogost: 'погост',
  hamlet: 'хутор',
  stanitsa: 'станица',
  mestechko: 'местечко',
  other: '',
};

export const PLACE_FIELDS = ['kind', 'name', 'volost', 'uezd', 'gubernia', 'country', 'now', 'note'];

// Как подписаны части названия: «Ивановская волость», «Старицкий уезд», «Тверская губерния».
// Если слово уже написано («Ивановская вол.», «Старицкого уезда»), второй раз его не добавляем.
const part = (text, word, written) => {
  const t = String(text || '').trim();
  return !t || written.test(t) ? t : `${t} ${word}`;
};

// Полное старое название: «деревня Горки, Ивановская волость, Старицкий уезд, Тверская губерния».
// Страна — только если не Россия: в семейном дереве она подразумевается.
export function placeTitle(p) {
  const kind = PLACE_KINDS[p.kind] || '';
  const name = String(p.name || '').trim();
  const country = String(p.country || '').trim();
  return [
    [kind, name].filter(Boolean).join(' '),
    part(p.volost, 'волость', /(^|\s)(волост|вол\.)/i),
    part(p.uezd, 'уезд', /(^|\s)(уезд|у\.)/i),
    part(p.gubernia, 'губерния', /(^|\s)(губерни|губ\.)/i),
    /^(россия|российская империя)$/i.test(country) ? '' : country,
  ].filter(Boolean).join(', ');
}

// Для сравнения мест: без разницы в регистре, пробелах и «ё».
export const placeKey = (text) => String(text || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

// Подсказка при вводе: места справочника и уже встречавшиеся в дереве, где есть все набранные слова.
// places — справочник, used — тексты мест из дерева. -> [{ text, place }] (place — запись справочника или null).
export function suggestPlaces(query, places, used, limit = 8) {
  const words = placeKey(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const fits = (text) => {
    const k = placeKey(text);
    return words.every((w) => k.includes(w));
  };
  const out = [];
  const seen = new Set();
  for (const p of places) {
    if (out.length >= limit) break;
    if (!fits(`${p.title} ${p.now}`) || seen.has(placeKey(p.title))) continue;
    seen.add(placeKey(p.title));
    out.push({ text: p.title, place: p });
  }
  for (const text of used) {
    if (out.length >= limit) break;
    if (!fits(text) || seen.has(placeKey(text))) continue;
    seen.add(placeKey(text));
    out.push({ text, place: null });
  }
  return out;
}
