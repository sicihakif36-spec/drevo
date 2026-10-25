// Несколько семей на сервере (src/tenants.js): ссылка «Завести своё дерево», деревья, файлы, приглашения, ссылки без входа,
// уведомления и поток обновлений каждой семьи — только её; телефон в двух семьях; предел места, закрытый вход, предел числа семей;
// восстановление входа владельцу другой семьи скриптом на сервере.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool, q, core } from '../src/db.js';
import { config } from '../src/config.js';
import { createInvite } from '../src/auth.js';
import { createTenant, dataDir, loadTenants, mainTenant, tenantById, withTenant } from '../src/tenants.js';
import { PASSWORD } from './helpers.js';

const H = { 'x-drevo': '1' };
const MB = 1024 * 1024;
let app;
let base;
let sent = [];
let now = null;
const push = { send: async (sub, payload) => sent.push({ to: sub.endpoint.split('/').at(-1), msg: JSON.parse(payload) }), clock: () => now || new Date(), timer: false };
const to = (name) => sent.filter((s) => s.to === name).map((s) => s.msg);
const settle = async () => { await app.push.settled(); await app.push.settled(); };

// Телефон: свои cookie, как у браузера (новые ставятся, стёртые убираются).
class Phone {
  constructor() { this.jar = new Map(); }
  get cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  async raw(method, url, payload, headers = {}) {
    const r = await app.inject({ method, url, payload, headers: { ...H, cookie: this.cookie, ...headers } });
    for (const c of r.cookies) {
      if (c.value && !(c.expires && c.expires < new Date())) this.jar.set(c.name, c.value);
      else this.jar.delete(c.name);
    }
    return r;
  }
  async call(method, url, payload, headers) {
    const r = await this.raw(method, url, payload, headers);
    assert.equal(r.statusCode, 200, `${method} ${url}: ${r.body}`);
    return r.json();
  }
}

// Вход по приглашению семьи t; владелец и участник сразу придумывают пароль.
async function join(phone, t, role, name) {
  const { token } = await withTenant(t, () => createInvite({ role, label: name }));
  await phone.call('POST', '/api/invites/redeem', { token, name });
  if (['owner', 'editor'].includes(role)) await phone.call('POST', '/api/me/password', { password: PASSWORD });
  return phone;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
function multipart(fields, file) {
  const b = 'drevo-families';
  return {
    payload: Buffer.concat([
      Buffer.from(Object.entries(fields).map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('')),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data,
      Buffer.from(`\r\n--${b}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${b}` },
  };
}
const photo = (phone, personId) => {
  const m = multipart({ kind: 'photo' }, { name: 'p.png', type: 'image/png', data: PNG });
  return phone.raw('POST', `/api/persons/${personId}/media`, m.payload, m.headers);
};

// Семьи, кроме главной, — долой: этот тест не должен оставлять их другим.
async function dropFamilies() {
  for (const t of await core('select id, schema from core.tenants where not main')) {
    await core(`drop schema if exists ${t.schema} cascade`);
    fs.rmSync(path.join(config.dataDir, 'families', t.id), { recursive: true, force: true });
  }
  await core('delete from core.tenant_links');
  await core('delete from core.tenants where not main');
  await loadTenants();
}

let main;
let fam; // семья Ольги
const sergey = new Phone();
const olga = new Phone();
let olgaPerson;
let sergeyPerson;

before(async () => {
  await migrate(() => {});
  await dropFamilies();
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push, eventsPing: 200 });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;
  main = mainTenant();
  await join(sergey, main, 'owner', 'Сергей');
  await sergey.call('PUT', '/api/push/subscription', { endpoint: 'https://fcm.googleapis.com/fcm/send/sergey', keys: { p256dh: 'BKey', auth: 'auth' } });
  sergeyPerson = (await sergey.call('POST', '/api/persons', { person: { given: 'Сергей', surname: 'Иванов', sex: 'M' } })).id;
});
after(async () => {
  await app.close();
  await dropFamilies();
  await pool.end();
});

test('ссылку «Завести своё дерево» делают только владельцы главной семьи; по ней — новая пустая семья', async () => {
  const lena = await join(new Phone(), main, 'editor', 'Лена');
  assert.equal((await lena.raw('POST', '/api/tenant-links', { label: 'Ольге' })).statusCode, 403);
  assert.equal((await new Phone().raw('POST', '/api/tenant-links', { label: 'Ольге' })).statusCode, 401);

  const link = await sergey.call('POST', '/api/tenant-links', { label: 'Ольге' });
  assert.match(link.url, /\/#\/new\/[\w-]{40,}$/);
  assert.equal((await sergey.call('GET', '/api/tenant-links')).length, 1);
  assert.equal((await olga.call('POST', '/api/tenant-links/check', { token: link.token })).from, 'Сергей');
  assert.equal((await olga.raw('POST', '/api/tenant-links/check', { token: 'x'.repeat(43) })).statusCode, 400);
  assert.equal((await olga.raw('POST', '/api/tenant-links/redeem', { token: link.token, name: 'Ольга', title: '' })).statusCode, 400);

  const r = await olga.call('POST', '/api/tenant-links/redeem', { token: link.token, name: 'Ольга', title: 'Род Галиевых' });
  fam = tenantById(r.id);
  assert.ok(fam && !fam.main && fam.schema === `f_${fam.id}`);
  assert.equal(olga.jar.get('drevo_t'), fam.id);
  assert.ok(olga.jar.get(`drevo_s_${fam.id}`));
  assert.equal((await new Phone().raw('POST', '/api/tenant-links/redeem', { token: link.token, name: 'Чужой', title: 'Ещё одно' })).statusCode, 400);
  assert.equal((await sergey.call('GET', '/api/tenant-links')).length, 0);

  // Владелец новой семьи, пока без пароля — как у любого нового владельца.
  const me = await olga.call('GET', '/api/me');
  assert.equal(me.user.name, 'Ольга');
  assert.equal(me.user.role, 'owner');
  assert.equal(me.user.needs_password, true);
  assert.deepEqual(me.tenant, { id: fam.id, main: false, title: 'Род Галиевых', closed: false });
  assert.deepEqual(me.tenants.map((t) => [t.id, t.title, t.current]), [[fam.id, 'Род Галиевых', true]]);
  await olga.call('POST', '/api/me/password', { password: PASSWORD });
  const tree = await olga.call('GET', '/api/tree');
  assert.equal(tree.persons.length, 0);
  assert.equal(tree.settings.title, 'Род Галиевых');
  assert.ok(fs.existsSync(path.join(dataDir(fam), 'media')));

  // Владельцам главной семьи — уведомление.
  await settle();
  assert.deepEqual(to('sergey').filter((m) => m.tag === 'tenants').map((m) => [m.title, m.body, m.url]),
    [['Ольга — новое дерево на сервере', '«Род Галиевых». Его видит только эта семья.', '/#/tenants']]);
});

test('пока семей больше одной, обращение к базе вне семьи — ошибка, а не данные главной', async () => {
  await assert.rejects(q('select 1'), /вне семьи/);
  assert.equal((await withTenant(main, () => q('select 1 as x')))[0].x, 1);
});

test('деревья семей не видны друг другу', async () => {
  olgaPerson = (await olga.call('POST', '/api/persons', { person: { given: 'Ольга', surname: 'Галиева', sex: 'F', birth_date: '1980' } })).id;
  await olga.call('POST', '/api/persons', { person: { given: 'Рашит', surname: 'Галиев', sex: 'M' }, relation: { to: olgaPerson, type: 'father' } });
  const mine = await olga.call('GET', '/api/tree');
  assert.deepEqual(mine.persons.map((p) => p.given).sort(), ['Ольга', 'Рашит']);
  const theirs = await sergey.call('GET', '/api/tree');
  assert.deepEqual(theirs.persons.map((p) => p.given), ['Сергей']);
  assert.equal(theirs.settings.title, 'Наше семейное древо');
  // Чужой человек по номеру — как несуществующий.
  assert.equal((await sergey.raw('PATCH', `/api/persons/${olgaPerson}`, { occupation: 'x' })).statusCode, 404);
  assert.equal((await olga.raw('PATCH', `/api/persons/${sergeyPerson}`, { occupation: 'x' })).statusCode, 404);
  assert.equal((await sergey.raw('GET', `/api/persons/${olgaPerson}/card.pdf`)).statusCode, 404);
  // В базе — каждый у себя; журнал и входы тоже.
  assert.equal((await core(`select count(*)::int as n from ${fam.schema}.persons`))[0].n, 2);
  assert.equal((await core('select count(*)::int as n from public.persons'))[0].n, 1);
  assert.ok((await olga.call('GET', '/api/changes')).every((c) => c.user_name === 'Ольга'));
  assert.deepEqual((await olga.call('GET', '/api/users')).map((u) => u.name), ['Ольга']);
  assert.ok(!(await sergey.call('GET', '/api/users')).some((u) => u.name === 'Ольга'));
  const ged = (await olga.raw('GET', '/api/export.ged')).body;
  assert.ok(ged.includes('Галиев') && !ged.includes('Иванов'));
});

test('файлы семьи — в своей папке и чужим не отдаются', async () => {
  const r = await photo(olga, olgaPerson);
  assert.equal(r.statusCode, 200, r.body);
  const id = r.json().id;
  assert.ok(fs.existsSync(path.join(dataDir(fam), 'media', id)));
  assert.ok(!fs.existsSync(path.join(config.dataDir, 'media', id)));
  assert.equal((await olga.raw('GET', `/api/media/${id}`)).statusCode, 200);
  assert.equal((await sergey.raw('GET', `/api/media/${id}`)).statusCode, 404);
});

test('приглашения и ссылки без входа ведут в свою семью', async () => {
  // Приглашение Ольги — в её семью, на каком бы телефоне его ни открыли.
  const aunt = await join(new Phone(), fam, 'relative', 'Тётя Роза');
  assert.equal((await aunt.call('GET', '/api/me')).tenant.id, fam.id);
  assert.equal((await aunt.call('GET', '/api/tree')).persons.length, 2);

  // Вопрос по ссылке: страничка без входа, ответ с фото — в файлы семьи Ольги.
  const a = await olga.call('POST', '/api/asks', { person_id: olgaPerson, question: 'Где родилась Ольга?', to_name: 'Дядя Марат' });
  const x = { 'x-ask': a.token };
  for (const phone of [new Phone(), sergey]) {
    const page = await phone.call('GET', '/api/ask', undefined, x);
    assert.equal(page.from, 'Ольга');
    assert.equal(page.about, 'Галиева Ольга');
  }
  const m = multipart({}, { name: 'p.png', type: 'image/png', data: PNG });
  const f = await new Phone().call('POST', '/api/ask/files', m.payload, { ...x, ...m.headers });
  assert.ok(fs.existsSync(path.join(dataDir(fam), 'ask', f.id)));
  await new Phone().call('POST', '/api/ask/answer', { answer: 'В Казани' }, x);
  assert.equal((await olga.call('GET', `/api/asks/${a.id}`)).answer, 'В Казани');
  assert.equal((await new Phone().raw('GET', '/api/ask', undefined, { 'x-ask': 'n'.repeat(43) })).statusCode, 404);

  // Анкета по ссылке — тоже.
  const s = await olga.call('POST', '/api/surveys', { name: 'Марату' });
  assert.equal((await new Phone().call('GET', '/api/survey', undefined, { 'x-survey': s.token })).from, 'Ольга');
  // Интервью по ссылке — тоже.
  const iv = await olga.call('POST', '/api/interviews', { person_id: olgaPerson, own: ['Что вы помните о детстве?'] });
  const ivLink = await olga.call('POST', `/api/interviews/${iv.id}/link`, { to_name: 'Марату' });
  assert.ok((await new Phone().call('GET', '/api/interview', undefined, { 'x-interview': ivLink.token })).questions.length);
});

test('один телефон в двух семьях: «Мои семьи», переключение, выход из одной', async () => {
  await join(sergey, fam, 'editor', 'Сергей');
  let me = await sergey.call('GET', '/api/me');
  assert.equal(me.tenant.id, fam.id);
  assert.equal(me.user.role, 'editor');
  assert.deepEqual(me.tenants.map((t) => [t.main, t.title, t.role, t.current]), [[true, 'Наше семейное древо', 'owner', false], [false, 'Род Галиевых', 'editor', true]]);
  assert.equal((await sergey.call('GET', '/api/tree')).persons.length, 2);

  await sergey.call('POST', '/api/tenants/switch', { id: 'main' });
  me = await sergey.call('GET', '/api/me');
  assert.equal(me.tenant.id, 'main');
  assert.equal(me.user.role, 'owner');
  assert.deepEqual((await sergey.call('GET', '/api/tree')).persons.map((p) => p.given), ['Сергей']);
  // В семью, где этот телефон не входил, — нельзя.
  assert.equal((await olga.raw('POST', '/api/tenants/switch', { id: 'main' })).statusCode, 400);
  assert.equal((await olga.raw('POST', '/api/tenants/switch', { id: 'nosuch' })).statusCode, 400);

  // Выход из семьи Ольги: телефон остаётся в главной.
  await sergey.call('POST', '/api/tenants/switch', { id: fam.id });
  const out = await sergey.call('POST', '/api/logout');
  assert.equal(out.next, 'main');
  me = await sergey.call('GET', '/api/me');
  assert.equal(me.tenant.id, 'main');
  assert.equal(me.user.name, 'Сергей');
  assert.deepEqual(me.tenants.map((t) => t.id), ['main']);
});

// Поток настоящим HTTP-запросом: какие события пришли.
async function stream(phone) {
  const res = await new Promise((ok, fail) => http.get(`${base}/api/events`, { headers: { cookie: phone.cookie }, agent: false }, ok).on('error', fail));
  const kinds = [];
  res.setEncoding('utf8');
  res.on('data', (c) => { for (const k of c.matchAll(/^event: (.+)$/gm)) kinds.push(k[1]); });
  return { kinds, close: () => res.destroy() };
}

test('поток обновлений — только телефонам своей семьи', async () => {
  const a = await stream(olga);
  const b = await stream(sergey);
  await sleep(100);
  await olga.call('POST', '/api/persons', { person: { given: 'Гульнара', surname: 'Галиева', sex: 'F' }, relation: { to: olgaPerson, type: 'mother' } });
  for (let i = 0; i < 40 && !a.kinds.includes('tree'); i++) await sleep(50);
  assert.ok(a.kinds.includes('tree'));
  await sleep(400);
  assert.ok(!b.kinds.includes('tree'));
  a.close();
  b.close();
});

test('уведомления: по каждой семье, ссылка в свою семью, у телефона из двух семей — название дерева', async () => {
  const both = await join(new Phone(), main, 'relative', 'Марат');
  await join(both, fam, 'relative', 'Марат');
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/both', keys: { p256dh: 'BKey', auth: 'auth' } };
  await both.call('PUT', '/api/push/subscription', sub);
  await both.call('POST', '/api/tenants/switch', { id: 'main' });
  await both.call('PUT', '/api/push/subscription', sub);
  await olga.call('PUT', '/api/push/subscription', { endpoint: 'https://fcm.googleapis.com/fcm/send/olga', keys: { p256dh: 'BKey', auth: 'auth' } });

  sent = [];
  await olga.call('POST', `/api/persons/${olgaPerson}/comments`, { body: 'Нашла метрику' });
  await settle();
  assert.deepEqual(to('both').map((m) => [m.title, m.url]), [['Род Галиевых: Ольга — в обсуждении: Галиева Ольга', `/?t=${fam.id}#/person/${olgaPerson}?talk=1`]]);
  assert.equal(to('sergey').length, 0);
  // В главной — без названия: телефон Сергея только в ней.
  await sergey.call('POST', `/api/persons/${sergeyPerson}/comments`, { body: 'Привет' });
  await settle();
  assert.deepEqual(to('both').at(-1).url, `/?t=main#/person/${sergeyPerson}?talk=1`);
  assert.match(to('both').at(-1).title, /^Наше семейное древо: /);
  // Ольга — только в своей семье: у неё всё как раньше.
  await both.call('POST', '/api/tenants/switch', { id: fam.id });
  await both.call('POST', `/api/persons/${olgaPerson}/comments`, { body: 'Помню её' });
  await settle();
  assert.deepEqual(to('olga').map((m) => [m.title, m.url]), [['Марат — в обсуждении: Галиева Ольга', `/#/person/${olgaPerson}?talk=1`]]);

  // Сводка правок — по расписанию в каждой семье, своим.
  sent = [];
  now = new Date(Date.now() + 11 * 60000);
  await app.push.tick();
  now = null;
  const digests = sent.filter((s) => s.msg.title.endsWith('Правки в дереве'));
  assert.ok(digests.some((s) => s.to === 'both' && s.msg.body.startsWith('Ольга добавил') && s.msg.url === `/?t=${fam.id}#/feed`));
  assert.ok(!digests.some((s) => s.to === 'sergey' && s.msg.body.startsWith('Ольга')));
});

test('«Скачать всё» отмечается в своей семье', async () => {
  const r = await olga.raw('GET', '/api/archive.zip');
  assert.equal(r.statusCode, 200);
  let n = 0;
  for (let i = 0; i < 40 && !n; i++) {
    n = (await core(`select count(*)::int as n from ${fam.schema}.archive_downloads`))[0].n;
    if (!n) await sleep(50);
  }
  assert.equal(n, 1);
  assert.equal((await core('select count(*)::int as n from public.archive_downloads'))[0].n, 0);
});

test('«Семьи на сервере»: список без содержимого деревьев, предел места, закрыть вход', async () => {
  assert.equal((await olga.raw('GET', '/api/tenants')).statusCode, 403);
  const { list, max, count } = await sergey.call('GET', '/api/tenants');
  assert.equal(max, config.maxFamilies);
  assert.equal(count, 1);
  const f = list.find((x) => x.id === fam.id);
  assert.equal(f.title, 'Род Галиевых');
  assert.equal(f.owners, 'Ольга');
  assert.equal(f.created_by, 'Ольга');
  assert.equal(f.label, 'Ольге');
  assert.equal(f.persons, 3);
  assert.ok(f.used > 0);
  assert.equal(f.quota, config.familyQuotaMb * MB);
  assert.ok(!('persons_list' in f) && !JSON.stringify(list).includes('Рашит'));
  assert.equal((await sergey.raw('PATCH', '/api/tenants/main', { closed: true })).statusCode, 400);

  // Место закончилось — новые файлы не грузятся, остальное работает.
  assert.equal((await sergey.call('PATCH', `/api/tenants/${fam.id}`, { quota_mb: 100 })).quota, 100 * MB);
  assert.equal((await olga.call('GET', '/api/tenants/space')).quota, 100 * MB);
  assert.equal((await sergey.call('GET', '/api/tenants/space')).quota, null);
  await core(`update ${fam.schema}.media set bytes = $1`, [150 * MB]);
  const r = await photo(olga, olgaPerson);
  assert.equal(r.statusCode, 413);
  assert.match(r.json().error, /закончилось: занято 150 МБ из 100 МБ/);
  await olga.call('PATCH', `/api/persons/${olgaPerson}`, { occupation: 'учитель' });
  await sergey.call('PATCH', `/api/tenants/${fam.id}`, { quota_mb: 200 });
  assert.equal((await photo(olga, olgaPerson)).statusCode, 200);

  // Вход закрыт: телефоны семьи не входят, ссылки без входа не работают; открыли — всё как было.
  const closed = await sergey.call('PATCH', `/api/tenants/${fam.id}`, { closed: true });
  assert.ok(closed.closed_at);
  const me = await olga.call('GET', '/api/me');
  assert.equal(me.user, null);
  assert.equal(me.tenant.closed, true);
  assert.equal(me.tenant.title, 'Род Галиевых');
  assert.equal((await olga.raw('GET', '/api/tree')).statusCode, 401);
  const s = await withTenant(fam, () => q('select 1 from surveys limit 1'));
  assert.equal(s.length, 1);
  assert.equal((await sergey.call('GET', '/api/tenants')).list.find((x) => x.id === fam.id).title, 'Род Галиевых');
  await sergey.call('PATCH', `/api/tenants/${fam.id}`, { closed: false });
  assert.equal((await olga.call('GET', '/api/me')).user.name, 'Ольга');
});

test('семей не больше предела', async () => {
  const was = config.maxFamilies;
  config.maxFamilies = 1;
  try {
    assert.equal((await sergey.raw('POST', '/api/tenant-links', {})).statusCode, 409);
    await assert.rejects(createTenant({ title: 'Лишняя' }), /больше завести нельзя/);
  } finally {
    config.maxFamilies = was;
  }
});

test('владелец другой семьи потерял вход: новая ссылка скриптом на сервере', async () => {
  const bin = fileURLToPath(new URL('../bin/', import.meta.url));
  const out = execFileSync(process.execPath, [path.join(bin, 'password.js'), '--family', fam.id], { encoding: 'utf8' });
  assert.match(out, /Пароль владельца «Ольга» сброшен/);
  assert.equal((await olga.raw('GET', '/api/tree')).statusCode, 401);
  const token = out.trim().split('/').at(-1);
  const phone = new Phone();
  await phone.call('POST', '/api/invites/redeem', { token });
  const me = await phone.call('GET', '/api/me');
  assert.equal(me.tenant.id, fam.id);
  assert.equal(me.user.name, 'Ольга');
  assert.equal(me.user.needs_password, true);
  const list = execFileSync(process.execPath, [path.join(bin, 'families.js')], { encoding: 'utf8' });
  assert.match(list, new RegExp(`${fam.id}\\t«Род Галиевых»\\tвладельцы: Ольга\\tлюдей: 3`));
});
