// Сколько весит: «850 КБ», «12 МБ», «1,2 ГБ».
export function sizeText(n) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} КБ`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toLocaleString('ru-RU', { maximumFractionDigits: n < 10 * 1024 ** 2 ? 1 : 0 })} МБ`;
  return `${(n / 1024 ** 3).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ГБ`;
}
