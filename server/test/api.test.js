// Интеграционные проверки API на настоящей PostgreSQL (DATABASE_URL).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool } from '../src/db.js';
import { createInvite } from '../src/auth.js';

let app;
const H = { 'x-drevo': '1' };
let ownerCookie;

async function login(role) {
  const { token } = await createInvite({ role, label: role });
  const r = await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token } });
  assert.equal(r.statusCode, 200, r.body);
  return r.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
const call = (cookie, method, url, payload) => app.inject({ method, url, payload, headers: { ...H, cookie } });

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false });
  ownerCookie = await login('owner');
});
after(async () => { await app.close(); await pool.end(); });

test('без входа дерево закрыто, без заголовка изменения отклоняются', async () => {
  assert.equal((await app.inject({ url: '/api/tree' })).statusCode, 401);
  const r = await app.inject({ method: 'POST', url: '/api/persons', payload: {}, headers: { cookie: ownerCookie } });
  assert.equal(r.statusCode, 403);
});

test('ссылка-приглашение срабатывает один раз', async () => {
  const { token } = await createInvite({ role: 'viewer' });
  assert.equal((await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token } })).statusCode, 400);
});

test('семья из родителей, ребёнка и супруга; откат правки; печать и GEDCOM', async () => {
  const me = (await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Анна', surname: 'Смирнова', sex: 'F', birth_date: '1990' } })).json();
  const dad = (await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Пётр', surname: 'Смирнов', sex: 'M', birth_date: 'около 1960' }, relation: { to: me.id, type: 'father' } })).json();
  await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Мария', surname: 'Смирнова', sex: 'F' }, relation: { to: me.id, type: 'mother' } });
  const third = await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Лишний', sex: 'M' }, relation: { to: me.id, type: 'father' } });
  assert.equal(third.statusCode, 409);
  await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Иван', sex: 'M' }, relation: { to: me.id, type: 'sibling' } });
  await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Олег', surname: 'Иванов', sex: 'M' }, relation: { to: me.id, type: 'spouse' } });
  await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Вера', sex: 'F' }, relation: { to: me.id, type: 'child' } });
  await call(ownerCookie, 'POST', '/api/persons', { person: { given: 'Пётр-старший', sex: 'M' }, relation: { to: dad.id, type: 'father' } });

  const tree = (await call(ownerCookie, 'GET', '/api/tree')).json();
  assert.equal(tree.persons.length, 7);
  const parentsFam = tree.families.find((f) => tree.children.some((c) => c.family_id === f.id && c.child_id === me.id));
  assert.ok(parentsFam.partner1 && parentsFam.partner2);
  assert.equal(tree.children.filter((c) => c.family_id === parentsFam.id).length, 2);

  const upd = await call(ownerCookie, 'PATCH', `/api/persons/${dad.id}`, { birth_place: 'Тверь', version: dad.version });
  assert.equal(upd.statusCode, 200);
  const stale = await call(ownerCookie, 'PATCH', `/api/persons/${dad.id}`, { birth_place: 'Москва', version: dad.version });
  assert.equal(stale.statusCode, 409);
  const hist = (await call(ownerCookie, 'GET', `/api/persons/${dad.id}/history`)).json();
  const change = hist.find((h) => h.action === 'update');
  assert.equal((await call(ownerCookie, 'POST', `/api/changes/${change.id}/revert`)).statusCode, 200);
  const t2 = (await call(ownerCookie, 'GET', '/api/tree')).json();
  assert.equal(t2.persons.find((p) => p.id === dad.id).birth_place, '');

  const del = (await call(ownerCookie, 'DELETE', `/api/persons/${dad.id}`)).json();
  assert.equal((await call(ownerCookie, 'GET', '/api/tree')).json().persons.length, 6);
  assert.equal((await call(ownerCookie, 'POST', `/api/changes/${del.changeId}/revert`)).statusCode, 200);
  const t3 = (await call(ownerCookie, 'GET', '/api/tree')).json();
  assert.equal(t3.persons.length, 7);
  assert.ok(t3.families.some((f) => f.partner1 === dad.id || f.partner2 === dad.id));

  for (const qs of ['', '?mode=ancestors&paper=A3', `?fit=tiles&scale=150&root=${me.id}`]) {
    const pdf = await call(ownerCookie, 'GET', `/api/print.pdf${qs}`);
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
  }
  const ged = await call(ownerCookie, 'GET', '/api/export.ged');
  assert.match(ged.body, /1 NAME Пётр \/Смирнов\//);
  assert.match(ged.body, /2 DATE ABT 1960/);
});

test('гость не может править', async () => {
  const guest = await login('viewer');
  assert.equal((await call(guest, 'GET', '/api/tree')).statusCode, 200);
  assert.equal((await call(guest, 'POST', '/api/persons', { person: { given: 'X' } })).statusCode, 403);
  assert.equal((await call(guest, 'GET', '/api/users')).statusCode, 403);
});
