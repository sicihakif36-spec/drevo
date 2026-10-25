// «Спросить у родных»: вопрос о человеке конкретному родственнику. Общий код телефона и сервера:
// пределы, состояние вопроса и готовые подсказки к тексту вопроса (чего не хватает, находка проверки, вопрос исследования).
import { fullName, missingFields, namePrepositional, nameGenitive } from './names.js';

export const ASK_MAX = 1000; // текст вопроса
export const ANSWER_MAX = 10000; // текст ответа
export const ASK_PHOTOS = 5; // фото к ответу
export const ASK_DAYS = 30; // срок ссылки
// Поля карточки, которые «Дописать в карточку» откроет сразу.
export const ASK_FIELDS = ['birth_date', 'birth_place', 'death_date', 'death_place', 'burial_place', 'occupation', 'birth_surname', 'notes'];

// waiting — ждём ответа, answered — есть ответ, closed — закрыт, revoked — отозван, expired — срок ссылки истёк.
export function askStatus(a, now = new Date()) {
  if (a.revoked_at) return 'revoked';
  if (a.closed_at) return 'closed';
  if (a.answered_at) return 'answered';
  if (a.expires_at && new Date(a.expires_at) < now) return 'expired';
  return 'waiting';
}
export const STATUS = { waiting: 'ждём ответа', answered: 'есть ответ', closed: 'закрыт', revoked: 'отозван', expired: 'срок ссылки истёк' };

// «о Петре», «об Анне».
export const about = (p) => {
  const n = namePrepositional(p);
  return `${/^[аоуэиы]/i.test(n) ? 'об' : 'о'} ${n}`;
};

const verb = (p, m, f) => (p.sex === 'F' ? f : p.sex === 'M' ? m : `${m}(а)`);

// Готовые вопросы из того, чего не хватает в карточке: [{ text, field }]. Последний — всегда «что помните».
export function askHints(p, idx) {
  if (!p) return [];
  const name = [p.given, p.patronymic].filter(Boolean).join(' ') || fullName(p);
  const gen = nameGenitive(p);
  const miss = missingFields(p, idx);
  const out = [];
  if (miss.includes('дата рождения')) out.push({ text: `Когда ${verb(p, 'родился', 'родилась')} ${name}? Хотя бы примерно — год.`, field: 'birth_date' });
  if (miss.includes('место рождения')) out.push({ text: `Где ${verb(p, 'родился', 'родилась')} ${name}? Село или город, район.`, field: 'birth_place' });
  if (miss.includes('дата смерти')) out.push({ text: `Когда ${verb(p, 'умер', 'умерла')} ${name}? И где ${verb(p, 'похоронен', 'похоронена')}?`, field: 'death_date' });
  if (miss.includes('родители')) out.push({ text: `Как звали родителей ${gen}? Имя, отчество, девичья фамилия матери.`, field: '' });
  if (miss.includes('фото')) out.push({ text: `Есть ли у вас фото ${gen}? Пришлите, пожалуйста.`, field: '' });
  out.push({ text: `Что вы помните ${about(p)}?`, field: '' });
  return out;
}

// Из находки проверки дерева: «Юрий Петрович — в 1946: матери было 12 лет. Как правильно?»
export const findingAsk = (f) => ({ text: `${f.text}. Как правильно?`.replace(/\.\./g, '.'), field: f.field || '' });

// Из вопроса исследования.
export const researchAsk = (x) => ({ text: `${x.title.replace(/[.?!]+$/, '')} — что вы об этом знаете?`, research_id: x.id });

// Короткий текст для мессенджера вместе со ссылкой.
export const shareText = (from, a, url) => `Здравствуйте! ${from ? `${from} спрашивает` : 'Вопрос'} ${a}. Ответьте, пожалуйста, по ссылке: ${url}`;
