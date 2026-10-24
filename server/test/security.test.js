// Защита входа: уведомления о входах, «Это не он», «Мои устройства», пароль у тех, кто правит дерево.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool, q } from '../src/db.js';
import { createInvite, cleanup } from '../src/auth.js';
import { deviceName } from '../../shared/device.js';
import { passwordProblem } from '../../shared/password.js';
import { H, PASSWORD, signIn, cookieOf } from './helpers.js';

const ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A515F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
let app;
let owner;
const sent = [];
const push = { send: async (sub, payload) => sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }), timer: false };

const raw = (cookie, method, url, payload, headers = {}) => app.inject({ method, url, payload, headers: { ...H, cookie, ...headers } });
async function call(cookie, method, url, payload) {
  const r = await raw(cookie, method, url, payload);
  assert.equal(r.statusCode, 200, `${method} ${url}: ${r.body}`);
  return r.json();
}
// Открыть ссылку (url или токен) на «телефоне» с этим user-agent.
async function redeem(link, { ua = ANDROID, name = '' } = {}) {
  const r = await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: { ...H, 'user-agent': ua }, payload: { token: link.split('/').pop(), name } });
  assert.equal(r.statusCode, 200, r.body);
  return { cookie: cookieOf(r), password: r.json().password };
}
const notices = async () => {
  await app.push.settled();
  return sent.splice(0).filter((m) => m.tag.startsWith('login-'));
};
const userId = async (name) => (await q('select id from users where name = $1', [name]))[0].id;

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push });
  owner = await signIn(app, 'owner', { name: 'Анна' });
  await call(owner, 'PUT', '/api/push/subscription', { endpoint: 'https://fcm.googleapis.com/fcm/send/owner', keys: { p256dh: 'BKey', auth: 'auth' } });
});
after(async () => { await app.close(); await pool.end(); });

test('устройство понятными словами, требования к паролю', () => {
  assert.equal(deviceName(ANDROID), 'Android, Chrome');
  assert.equal(deviceName(IPHONE), 'iPhone, Safari');
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0'), 'Windows, Firefox');
  assert.equal(deviceName('Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 YaBrowser/23.11 Mobile Safari/537.36'), 'Android, Яндекс Браузер');
  assert.equal(deviceName(''), 'Неизвестное устройство');
  for (const bad of ['1234567', '12345678', '87654321', 'qwertyui', 'йцукенгш', 'аааааааа', '12121212', 'password1', 'Qwerty123']) {
    assert.ok(passwordProblem(bad), bad);
  }
  for (const good of ['бабушкин сад', 'горки1952', 'Kazan-2024!', PASSWORD]) assert.equal(passwordProblem(good), '', good);
});

test('ссылка-приглашение по умолчанию на 3 дня, на выбор 1, 3, 7, 14', async () => {
  await call(owner, 'POST', '/api/invites', { role: 'viewer', label: 'Срок' });
  const [inv] = (await call(owner, 'GET', '/api/invites')).filter((i) => i.label === 'Срок');
  const days = (new Date(inv.expires_at) - new Date(inv.created_at)) / 86400000;
  assert.ok(Math.abs(days - 3) < 0.01, String(days));
  await call(owner, 'POST', '/api/invites', { role: 'viewer', label: 'Неделя', days: 7 });
  for (const days of [90, 0, 30, 'x']) assert.equal((await raw(owner, 'POST', '/api/invites', { role: 'viewer', days })).statusCode, 400);
  // Ссылка для нового телефона — тоже 3 дня.
  const u = await userId('Анна');
  await call(owner, 'POST', `/api/users/${u}/login-link`);
  const [link] = await q('select expires_at - created_at as d from invites where for_user = $1', [u]);
  assert.equal(link.d.days, 3);
  await q('delete from invites where for_user = $1', [u]);
});

test('о каждом входе — владельцу: уведомление и список «Входы»; «Это не она — отключить»', async () => {
  const olgaPerson = (await call(owner, 'POST', '/api/persons', { person: { given: 'Ольга', surname: 'Смирнова', sex: 'F' } })).id;
  const inv = await call(owner, 'POST', '/api/invites', { role: 'editor', label: 'Ольга', person_id: olgaPerson });
  sent.length = 0;
  const olga = await redeem(inv.url, { name: 'Ольга' });
  assert.equal(olga.password, false);
  const [n] = await notices();
  assert.equal(n.title, 'Вошла Ольга (участник)');
  assert.match(n.body, /^Android, Chrome · \d+ [а-я]+, \d\d:\d\d/);
  assert.match(n.body, /Если это не она/);
  assert.equal(n.url, '/#/family');
  assert.equal(n.endpoint, 'https://fcm.googleapis.com/fcm/send/owner');
  let [l] = await call(owner, 'GET', '/api/logins');
  assert.equal(l.name, 'Ольга');
  assert.equal(l.kind, 'invite');
  assert.equal(l.role, 'editor');
  assert.equal(l.device, 'Android, Chrome');
  assert.equal(l.sex, 'F');
  assert.equal(l.active, true);
  assert.ok(!('user_agent' in l) && !('ip' in l));
  // Список входов и устройства — только владельцу.
  assert.equal((await raw(olga.cookie, 'GET', '/api/logins')).statusCode, 403);

  // Вошла не она: отключить, вывести отовсюду, забыть пароль, который мог придумать чужой.
  await call(olga.cookie, 'POST', '/api/me/password', { password: 'чужой пароль' });
  const id = l.user_id;
  await call(owner, 'POST', `/api/users/${id}/intruder`);
  assert.equal((await raw(olga.cookie, 'GET', '/api/tree')).statusCode, 401);
  const [u] = await q('select disabled, password_hash from users where id = $1', [id]);
  assert.deepEqual(u, { disabled: true, password_hash: null });
  assert.equal((await q('select count(*)::int as n from sessions where user_id = $1', [id]))[0].n, 0);
  [l] = await call(owner, 'GET', '/api/logins');
  assert.equal(l.disabled, true);
  assert.equal(l.active, false);
  // Себя так отключить нельзя; пока вход отключён, ссылку не сделать.
  assert.equal((await raw(owner, 'POST', `/api/users/${await userId('Анна')}/intruder`)).statusCode, 400);
  assert.equal((await raw(owner, 'POST', `/api/users/${id}/login-link`)).statusCode, 400);
  // Новая ссылка настоящей Ольге: включить вход и сделать ссылку — она придумает свой пароль.
  await call(owner, 'PATCH', `/api/users/${id}`, { disabled: false });
  const real = await redeem((await call(owner, 'POST', `/api/users/${id}/login-link`)).url, { ua: IPHONE });
  assert.equal(real.password, false);
  const me = (await call(real.cookie, 'GET', '/api/me')).user;
  assert.equal(me.id, id);
  assert.equal(me.needs_password, true);
  [l] = await call(owner, 'GET', '/api/logins');
  assert.equal(l.kind, 'link');
  assert.equal(l.device, 'iPhone, Safari');
  const [n2] = await notices();
  assert.equal(n2.title, 'Вошла Ольга (участник)');
  await call(real.cookie, 'POST', '/api/me/password', { password: 'ольгин сад' });
});

test('«Отключить вход» закрывает и неоткрытые ссылки для нового телефона', async () => {
  const c = await signIn(app, 'relative', { name: 'Валя' });
  const id = await userId('Валя');
  const link = await call(owner, 'POST', `/api/users/${id}/login-link`);
  await call(owner, 'PATCH', `/api/users/${id}`, { disabled: true });
  assert.equal((await raw(c, 'GET', '/api/tree')).statusCode, 401);
  await call(owner, 'PATCH', `/api/users/${id}`, { disabled: false });
  const r = await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token: link.url.split('/').pop() } });
  assert.equal(r.statusCode, 400);
});

test('«Мои устройства»: только свои, выйти на одном и на всех, кроме этого; владелец — у любого', async () => {
  const phone = await signIn(app, 'editor', { name: 'Пётр' });
  const id = await userId('Пётр');
  const tablet = (await redeem((await call(owner, 'POST', `/api/users/${id}/login-link`)).url, { ua: IPHONE })).cookie;
  await call(tablet, 'POST', '/api/login/password', { password: PASSWORD });
  const laptop = (await redeem((await call(owner, 'POST', `/api/users/${id}/login-link`)).url, { ua: 'Mozilla/5.0 (Windows NT 10.0) Firefox/128.0' })).cookie;
  await call(laptop, 'POST', '/api/login/password', { password: PASSWORD });

  let list = await call(phone, 'GET', '/api/me/sessions');
  assert.equal(list.length, 3);
  assert.equal(list[0].current, true);
  assert.deepEqual(list.slice(1).map((s) => s.device).sort(), ['Windows, Firefox', 'iPhone, Safari']);
  assert.ok(list.every((s) => !('token_hash' in s) && !('user_agent' in s)));
  // Чужие устройства не видны и не закрываются.
  const mine = await call(owner, 'GET', '/api/me/sessions');
  assert.ok(mine.every((s) => !list.some((x) => x.id === s.id)));
  assert.equal((await raw(phone, 'DELETE', `/api/me/sessions/${mine[0].id}`)).statusCode, 404);
  assert.equal((await raw(phone, 'GET', `/api/users/${id}/sessions`)).statusCode, 403);
  assert.equal((await raw(owner, 'GET', '/api/tree')).statusCode, 200);

  // Выйти на ноутбуке.
  const lap = list.find((s) => s.device === 'Windows, Firefox');
  await call(phone, 'DELETE', `/api/me/sessions/${lap.id}`);
  assert.equal((await raw(laptop, 'GET', '/api/tree')).statusCode, 401);
  // На всех, кроме этого.
  assert.equal((await call(phone, 'POST', '/api/me/sessions/others')).count, 1);
  assert.equal((await raw(tablet, 'GET', '/api/tree')).statusCode, 401);
  list = await call(phone, 'GET', '/api/me/sessions');
  assert.equal(list.length, 1);
  // Выйти на этом — cookie стирается.
  const self = await raw(phone, 'DELETE', `/api/me/sessions/${list[0].id}`);
  assert.equal(self.statusCode, 200);
  assert.equal(self.cookies.find((c) => c.name === 'drevo_s').value, '');
  assert.equal((await raw(phone, 'GET', '/api/tree')).statusCode, 401);

  // Владелец: устройства любого, выйти на одном и на всех — без отключения.
  const a = (await redeem((await call(owner, 'POST', `/api/users/${id}/login-link`)).url)).cookie;
  await call(a, 'POST', '/api/login/password', { password: PASSWORD });
  const b = (await redeem((await call(owner, 'POST', `/api/users/${id}/login-link`)).url)).cookie;
  await call(b, 'POST', '/api/login/password', { password: PASSWORD });
  list = await call(owner, 'GET', `/api/users/${id}/sessions`);
  assert.equal(list.length, 2);
  assert.ok(list.every((s) => !s.current));
  await call(owner, 'DELETE', `/api/users/${id}/sessions/${list[0].id}`);
  assert.equal((await call(owner, 'GET', `/api/users/${id}/sessions`)).length, 1);
  assert.equal((await call(owner, 'DELETE', `/api/users/${id}/sessions`)).count, 1);
  assert.equal((await raw(a, 'GET', '/api/tree')).statusCode, 401);
  assert.equal((await raw(b, 'GET', '/api/tree')).statusCode, 401);
  const users = await call(owner, 'GET', '/api/users');
  const petr = users.find((u) => u.id === id);
  assert.equal(petr.disabled, false);
  assert.equal(petr.devices, 0);
  assert.equal(petr.has_password, true);
  assert.equal((await raw(owner, 'DELETE', `/api/users/${await userId('Анна')}/sessions`)).statusCode, 400);
});

test('пароль: хранится хешем, требования, неподтверждённая сессия не даёт ничего, кроме ввода пароля', async () => {
  const c = await signIn(app, 'editor', { name: 'Зоя', password: null });
  const id = await userId('Зоя');
  assert.equal((await call(c, 'GET', '/api/me')).user.needs_password, true);
  for (const password of ['1234567', '12345678', 'qwertyuiop', 'zzzzzzzz', 'password1', '', undefined]) {
    const r = await raw(c, 'POST', '/api/me/password', { password });
    assert.equal(r.statusCode, 400, String(password));
  }
  await call(c, 'POST', '/api/me/password', { password: 'зоина дача' });
  const [{ password_hash: h }] = await q('select password_hash from users where id = $1', [id]);
  assert.match(h, /^scrypt\$16384\$8\$1\$[\w+/=]+\$[\w+/=]+$/);
  assert.ok(!h.includes('зоина'));
  const all = JSON.stringify(await q('select * from users')) + JSON.stringify(await q('select * from sessions'));
  assert.ok(!all.includes('зоина дача'));
  // Тот же пароль у другого — другой хеш (своя соль).
  const c2 = await signIn(app, 'editor', { name: 'Зоя 2', password: 'зоина дача' });
  assert.ok(c2);
  const [{ password_hash: h2 }] = await q('select password_hash from users where id = $1', [await userId('Зоя 2')]);
  assert.notEqual(h, h2);

  // Новый телефон: после ссылки — пароль; до него ни одного API.
  const link = await call(owner, 'POST', `/api/users/${id}/login-link`);
  sent.length = 0;
  const p = await redeem(link.url, { ua: IPHONE });
  assert.equal(p.password, true);
  const [n] = await notices();
  assert.equal(n.title, 'Зоя (участник) открыл(а) ссылку для входа');
  assert.match(n.body, /Войдёт после пароля/);
  const me = await call(p.cookie, 'GET', '/api/me');
  assert.equal(me.user, null);
  assert.deepEqual(me.pending, { name: 'Зоя' });
  const [person] = await q("insert into persons (given) values ('Тест') returning id");
  for (const [method, url] of [['GET', '/api/tree'], ['GET', '/api/feed'], ['GET', '/api/events'], ['GET', '/api/me/sessions'],
    ['GET', `/api/media/${person.id}`], ['GET', `/api/media/${person.id}/thumb`], ['GET', '/api/export.ged'], ['GET', '/api/print.pdf'],
    ['GET', '/api/push/key'], ['PATCH', '/api/me'], ['POST', '/api/me/password'], ['POST', '/api/persons'], ['GET', '/api/surveys'],
    ['PATCH', `/api/persons/${person.id}`], ['GET', '/api/logins'], ['POST', '/api/me/sessions/others']]) {
    const r = await raw(p.cookie, method, url, {});
    assert.equal(r.statusCode, 401, `${method} ${url}: ${r.statusCode}`);
  }
  // В списке её устройств он есть — как ждущий пароль.
  assert.ok((await call(c, 'GET', '/api/me/sessions')).some((s) => s.pending));

  // Пять неверных — ожидание, владельцу — уведомление один раз; верный пароль в это время тоже не пускает.
  for (let i = 1; i <= 5; i++) {
    const r = await raw(p.cookie, 'POST', '/api/login/password', { password: `неверный ${i}` });
    assert.equal(r.statusCode, 400);
    assert.match(r.json().error, i < 5 ? new RegExp(`Осталось попыток: ${5 - i}`) : /подождите 15 минут/);
  }
  const locked = await raw(p.cookie, 'POST', '/api/login/password', { password: 'зоина дача' });
  assert.equal(locked.statusCode, 429);
  assert.match(locked.json().error, /Подождите 1[45] минут/);
  const fails = await notices();
  assert.equal(fails.length, 1);
  assert.equal(fails[0].title, 'Зоя: пять раз неверный пароль');
  assert.equal((await call(owner, 'GET', '/api/logins'))[0].kind, 'fails');
  // Перезапуск сервера счёт не обнуляет: попытки — в базе.
  const again = await buildApp({ logger: false, push });
  assert.equal((await again.inject({ method: 'POST', url: '/api/login/password', headers: { ...H, cookie: p.cookie }, payload: { password: 'зоина дача' } })).statusCode, 429);
  await again.close();
  // По адресу тоже: с того же адреса чужой пароль не подобрать, даже у другого человека.
  const other = await redeem((await call(owner, 'POST', `/api/users/${await userId('Зоя 2')}/login-link`)).url);
  assert.equal((await raw(other.cookie, 'POST', '/api/login/password', { password: 'зоина дача' })).statusCode, 429);
  // Прошло 15 минут — можно снова.
  await q("update password_tries set at = at - interval '16 minutes'");
  await call(p.cookie, 'POST', '/api/login/password', { password: 'зоина дача' });
  assert.equal((await call(p.cookie, 'GET', '/api/me')).user.id, id);
  assert.equal((await raw(p.cookie, 'GET', '/api/tree')).statusCode, 200);
  assert.equal((await raw(p.cookie, 'POST', '/api/login/password', { password: 'зоина дача' })).statusCode, 400);
  // Из ожидания пароля можно и просто выйти.
  const q2 = await redeem((await call(owner, 'POST', `/api/users/${id}/login-link`)).url);
  assert.equal((await raw(q2.cookie, 'POST', '/api/logout')).statusCode, 200);
  assert.equal((await call(c, 'GET', '/api/me/sessions')).filter((s) => s.pending).length, 0);
});

test('смена пароля: нужен старый, выводит со всех остальных устройств', async () => {
  const c = await signIn(app, 'owner', { name: 'Второй владелец' });
  const id = await userId('Второй владелец');
  const other = (await redeem((await call(owner, 'POST', `/api/users/${id}/login-link`)).url)).cookie;
  await call(other, 'POST', '/api/login/password', { password: PASSWORD });
  assert.equal((await raw(c, 'POST', '/api/me/password', { password: 'новый пароль 1' })).statusCode, 400);
  assert.equal((await raw(c, 'POST', '/api/me/password', { old: 'не тот', password: 'новый пароль 1' })).statusCode, 400);
  // Слабый новый пароль не тратит попытки старого.
  assert.equal((await raw(c, 'POST', '/api/me/password', { old: 'не тот', password: '123' })).statusCode, 400);
  assert.equal((await q('select count(*)::int as n from password_tries where user_id = $1', [id]))[0].n, 2);
  await call(c, 'POST', '/api/me/password', { old: PASSWORD, password: 'новый пароль 1' });
  assert.equal((await raw(other, 'GET', '/api/tree')).statusCode, 401);
  assert.equal((await raw(c, 'GET', '/api/tree')).statusCode, 200);
  assert.equal((await q('select count(*)::int as n from password_tries where user_id = $1', [id]))[0].n, 0);
  const next = await redeem((await call(owner, 'POST', `/api/users/${id}/login-link`)).url);
  assert.equal((await raw(next.cookie, 'POST', '/api/login/password', { password: PASSWORD })).statusCode, 400);
  await call(next.cookie, 'POST', '/api/login/password', { password: 'новый пароль 1' });
});

test('забыл пароль: владелец сбрасывает, человек придумывает новый по новой ссылке', async () => {
  const c = await signIn(app, 'editor', { name: 'Забывчивый' });
  const id = await userId('Забывчивый');
  assert.equal((await raw(c, 'POST', `/api/users/${id}/reset-password`)).statusCode, 403);
  assert.equal((await raw(owner, 'POST', `/api/users/${await userId('Анна')}/reset-password`)).statusCode, 400);
  const link = await call(owner, 'POST', `/api/users/${id}/reset-password`);
  assert.equal((await raw(c, 'GET', '/api/tree')).statusCode, 401);
  const [u] = await q('select password_hash from users where id = $1', [id]);
  assert.equal(u.password_hash, null);
  const n = await redeem(link.url);
  assert.equal(n.password, false);
  assert.equal((await call(n.cookie, 'GET', '/api/me')).user.needs_password, true);
  await call(n.cookie, 'POST', '/api/me/password', { password: 'новый сад 2' });
  assert.equal((await call(n.cookie, 'GET', '/api/me')).user.role, 'editor');
});

test('родственник и гость входят без пароля, повышенный до участника — придумывает', async () => {
  for (const role of ['relative', 'viewer']) {
    const c = await signIn(app, role, { name: `Без пароля ${role}` });
    const me = (await call(c, 'GET', '/api/me')).user;
    assert.equal(me.role, role);
    assert.ok(!me.needs_password);
    assert.equal((await raw(c, 'POST', '/api/me/password', { password: 'родной дом 1' })).statusCode, 400);
    // И по ссылке на новом телефоне — сразу.
    const n = await redeem((await call(owner, 'POST', `/api/users/${await userId(`Без пароля ${role}`)}/login-link`)).url);
    assert.equal(n.password, false);
    assert.equal((await raw(n.cookie, 'GET', '/api/tree')).statusCode, 200);
  }
  const c = await signIn(app, 'relative', { name: 'Повышенная' });
  const id = await userId('Повышенная');
  await call(owner, 'PATCH', `/api/users/${id}`, { role: 'editor' });
  const me = (await call(c, 'GET', '/api/me')).user;
  assert.deepEqual([me.role, me.needs_password], ['editor', true]);
  assert.equal((await call(c, 'GET', '/api/tree')).me.needs_password, true);
  const r = await raw(c, 'POST', '/api/persons', { person: { given: 'Новый' } });
  assert.equal(r.statusCode, 403);
  assert.match(r.json().error, /придумайте пароль/);
  await call(c, 'POST', '/api/me/password', { password: 'повышение 1' });
  await call(c, 'POST', '/api/persons', { person: { given: 'Новый' } });
});

test('уже вошедшие участники без пароля смотрят, но не правят', async () => {
  const c = await signIn(app, 'editor', { name: 'Старый вход', password: null });
  assert.equal((await raw(c, 'GET', '/api/tree')).statusCode, 200);
  assert.equal((await raw(c, 'GET', '/api/changes')).statusCode, 200);
  assert.equal((await raw(c, 'GET', '/api/surveys')).statusCode, 403);
  assert.equal((await raw(c, 'POST', '/api/persons', { person: { given: 'Нельзя' } })).statusCode, 403);
  const o = await signIn(app, 'owner', { name: 'Старый владелец', password: null });
  assert.equal((await raw(o, 'GET', '/api/users')).statusCode, 403);
  assert.equal((await raw(o, 'GET', '/api/logins')).statusCode, 403);
  await call(o, 'POST', '/api/me/password', { password: 'хозяйский ключ' });
  assert.equal((await raw(o, 'GET', '/api/users')).statusCode, 200);
});

test('cookie входа: httpOnly, SameSite=Strict; сессия без дела больше года закрывается', async () => {
  const { token } = await createInvite({ role: 'viewer' });
  const r = await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token } });
  const [k] = r.cookies;
  assert.equal(k.httpOnly, true);
  assert.equal(k.sameSite, 'Strict');
  assert.equal(k.path, '/');
  assert.equal(k.maxAge, 365 * 24 * 3600);
  const c = cookieOf(r);
  // Заходили вчера — срок продлевается; сегодня — нет.
  assert.equal((await raw(c, 'GET', '/api/me')).cookies.length, 0);
  await q("update sessions set last_seen_at = now() - interval '2 days' where id = (select id from sessions order by created_at desc limit 1)");
  assert.equal((await raw(c, 'GET', '/api/me')).cookies[0]?.maxAge, 365 * 24 * 3600);
  await q("update sessions set last_seen_at = now() - interval '13 months' where id = (select id from sessions order by created_at desc limit 1)");
  assert.equal((await raw(c, 'GET', '/api/tree')).statusCode, 401);
  const before = (await q('select count(*)::int as n from sessions'))[0].n;
  await q("insert into logins (user_id, kind, role, at) select id, 'invite', role, now() - interval '91 days' from users limit 1");
  await cleanup();
  assert.equal((await q('select count(*)::int as n from sessions'))[0].n, before - 1);
  assert.equal((await q("select count(*)::int as n from logins where at < now() - interval '90 days'"))[0].n, 0);
});

test('владелец забыл пароль: команда сервера сбрасывает его и даёт новую ссылку', async () => {
  const run = (args) => promisify(execFile)('node', ['bin/password.js', ...args], { cwd: new URL('..', import.meta.url) }).catch((e) => e);
  // Владельцев несколько — без имени не угадывает.
  const many = await run([]);
  assert.equal(many.code, 1);
  assert.match(many.stderr, /Владельцев несколько/);
  const id = await userId('Второй владелец');
  const second = (await redeem((await call(owner, 'POST', `/api/users/${id}/login-link`)).url)).cookie;
  await call(second, 'POST', '/api/login/password', { password: 'новый пароль 1' });
  const { stdout } = await run(['--name', 'второй владелец']);
  assert.match(stdout, /сброшен/);
  assert.equal((await raw(second, 'GET', '/api/tree')).statusCode, 401);
  const link = stdout.match(/https?:\S+/)[0];
  const n = await redeem(link);
  assert.equal(n.password, false);
  const me = (await call(n.cookie, 'GET', '/api/me')).user;
  assert.deepEqual([me.id, me.role, me.needs_password], [id, 'owner', true]);
  // Остальные владельцы не тронуты.
  assert.equal((await raw(owner, 'GET', '/api/users')).statusCode, 200);
});
