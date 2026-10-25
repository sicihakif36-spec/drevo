// Ссылки без входа (анкеты, вопросы родным): ограничение частоты с одного адреса —
// всего запросов и неверных ссылок (перебор токенов). Счёт — в памяти, за последние 10 минут.
import { HttpError } from './tree.js';

const WINDOW = 10 * 60 * 1000;
const hits = new Map();

function tooMany(key, limit) {
  const now = Date.now();
  const a = (hits.get(key) || []).filter((t) => now - t < WINDOW);
  a.push(now);
  hits.set(key, a);
  if (hits.size > 10000) for (const [k, v] of hits) if (now - v.at(-1) > WINDOW) hits.delete(k);
  return a.length > limit;
}
const failed = (key) => (hits.get(key) || []).filter((t) => Date.now() - t < WINDOW).length;

// kind — чьи ссылки ('survey', 'ask'): у каждого вида свой счёт.
export function checkRate(kind, ip) {
  if (failed(`${kind}:bad:${ip}`) >= 20 || tooMany(`${kind}:all:${ip}`, 600)) throw new HttpError(429, 'Слишком много попыток, подождите 10 минут');
}
export const badLink = (kind, ip) => tooMany(`${kind}:bad:${ip}`, Infinity);
