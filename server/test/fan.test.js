// Веерная схема предков: раскладка (секторы по поколениям, отец слева, пустые места, родственные браки без зацикливания,
// подписи внутри своих секторов и не мельче читаемого), приватность (гость и «скрыть живых»), PDF на 3 и 8 поколений,
// на A4 и плакатом; удалённые люди не попадают.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { pool } from '../src/db.js';
import { createInvite } from '../src/auth.js';
import { loadTreeData, parsePrintOptions } from '../src/routes/print.js';
import { buildIndex } from '../../shared/names.js';
import { FAN, layoutFan, fanGeometry, nameVariants, textWidth } from '../../shared/fan.js';

// ---------- Раскладка на выдуманном дереве ----------

// Полное дерево предков на gens поколений; skip(k) — номера (по Аненталю), которых нет.
function pedigree(gens, skip = () => false, extra = {}) {
  const persons = [];
  const families = [];
  const children = [];
  const make = (k) => {
    const g = Math.floor(Math.log2(k));
    const sex = k === 1 ? 'M' : k % 2 ? 'F' : 'M';
    persons.push({ id: `p${k}`, sex, surname: `${['Смирнов', 'Орлов', 'Кузнецов', 'Воронцов-Дашков'][k % 4]}${sex === 'F' ? 'а' : ''}`,
      given: sex === 'F' ? 'Прасковья' : 'Константин', patronymic: sex === 'F' ? 'Ивановна' : 'Петрович',
      birth_surname: sex === 'F' && k % 3 === 0 ? 'Белова' : '', living: g === 0, birth_date: String(1990 - g * 28),
      death_date: g === 0 ? '' : String(2050 - g * 28), photo_id: null, ...extra[k] });
  };
  make(1);
  for (let k = 1; k < 2 ** gens; k++) {
    if (!persons.some((p) => p.id === `p${k}`)) continue;
    const kids = [2 * k, 2 * k + 1].filter((n) => !skip(n));
    kids.forEach(make);
    if (!kids.length) continue;
    // мать первой — пол, а не порядок, решает, кто отец
    const [a, b] = kids.length === 2 ? [`p${2 * k + 1}`, `p${2 * k}`] : [`p${kids[0]}`, null];
    families.push({ id: `f${k}`, partner1: a, partner2: b });
    children.push({ family_id: `f${k}`, child_id: `p${k}` });
  }
  return { persons, families, children };
}

const O = (o = {}) => parsePrintOptions({ mode: 'fan', root: 'p1', ...o });
const people = (fan) => fan.sectors.filter((s) => s.id);

test('секторы по поколениям: 2, 4, 8…; отец слева, мать справа, их родители — по порядку по часовой', () => {
  const idx = buildIndex(pedigree(4));
  const fan = fanGeometry(idx, 'p1', { gens: 4, shape: 180, empty: true });
  for (let g = 1; g <= 4; g++) assert.equal(fan.sectors.filter((s) => s.gen === g).length, 2 ** g);
  const at = (k) => fan.sectors.find((s) => s.k === k);
  assert.deepEqual([at(2).id, at(2).a0, at(2).a1, at(2).side], ['p2', 180, 270, 'father']); // отец — левая четверть
  assert.deepEqual([at(3).id, at(3).a0, at(3).a1, at(3).side], ['p3', 270, 360, 'mother']);
  assert.deepEqual([at(4).id, at(5).id, at(4).a1], ['p4', 'p5', 225]); // дед по отцу левее бабушки
  assert.ok(at(4).r0 === at(2).r1 && at(2).r0 === FAN.center);
  // Круг и три четверти: та же середина сверху, отец слева.
  const full = fanGeometry(idx, 'p1', { gens: 2, shape: 360, empty: true });
  assert.deepEqual([full.sectors[0].a0, full.sectors[0].a1, full.sectors[1].a1], [90, 270, 450]);
  const t = fanGeometry(idx, 'p1', { gens: 1, shape: 270, empty: true });
  assert.deepEqual([t.sectors[0].a0, t.sectors[1].a1], [135, 405]);
  // Поколения по умолчанию и границы.
  assert.deepEqual([O().gens, O({ gens: 1 }).gens, O({ gens: 20 }).gens, O().shape, O({ shape: 90 }).shape, O().empty, O({ empty: '0' }).empty],
    [5, 3, 8, 180, 180, true, false]);
});

test('неизвестные предки — пустые места; дальше первого неизвестного — по галочке', () => {
  const idx = buildIndex(pedigree(3, (k) => k === 3)); // нет матери
  const on = fanGeometry(idx, 'p1', { gens: 3, shape: 180, empty: true });
  assert.equal(on.sectors.length, 2 + 4 + 8);
  assert.deepEqual(on.sectors.filter((s) => !s.id).map((s) => s.k), [3, 6, 7, 12, 13, 14, 15]);
  const off = fanGeometry(idx, 'p1', { gens: 3, shape: 180, empty: false });
  // мать — пустое место у известного сына, её родители и дальше — нет
  assert.deepEqual(off.sectors.filter((s) => !s.id).map((s) => s.k), [3]);
  assert.equal(people(off).length, 1 + 2 + 4);
});

test('родственный брак: общий предок в обоих местах; человек — сам себе предок — без зацикливания', () => {
  // Родители — двоюродные: у отца и матери общий дед.
  const data = pedigree(3);
  data.persons = data.persons.filter((p) => p.id !== 'p6');
  data.families.find((f) => f.id === 'f3').partner2 = 'p4';
  const fan = fanGeometry(buildIndex(data), 'p1', { gens: 3, shape: 180, empty: true });
  assert.deepEqual(fan.sectors.filter((s) => s.id === 'p4').map((s) => s.k), [4, 6]);
  assert.deepEqual([fan.sectors.find((s) => s.k === 12).id, fan.sectors.find((s) => s.k === 8).id], ['p8', 'p8']);
  // Ошибка в дереве: отец оказался собственным дедом.
  const loop = pedigree(2);
  loop.families.find((f) => f.id === 'f2').partner2 = 'p2';
  const l = fanGeometry(buildIndex(loop), 'p1', { gens: 8, shape: 180, empty: false });
  assert.ok(l.sectors.length < 20);
  assert.ok(!l.sectors.some((s) => s.id === 'p2' && s.k !== 2));
});

// Углы строки (ширина по таблице букв, высота — кегль) лежат внутри своего сектора.
function insideSector(s, l, eps) {
  const w = textWidth(l.text, l.bold) * l.size;
  const h = l.size * 1.0;
  const r = (l.rot * Math.PI) / 180;
  const [ux, uy, vx, vy] = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r)];
  for (const [a, b] of [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]) {
    const x = l.x + a * ux + b * vx;
    const y = l.y + a * uy + b * vy;
    const d = Math.hypot(x, y);
    if (d < s.r0 - eps || d > s.r1 + eps) return false;
    let ang = (Math.atan2(y, x) * 180) / Math.PI;
    while (ang < s.a0 - 1) ang += 360;
    const tol = (eps / d) * (180 / Math.PI);
    if (ang < s.a0 - tol || ang > s.a1 + tol) return false;
  }
  return true;
}

test('подписи: внутри своих секторов, не мельче читаемого; где тесно — сокращение, а не наложение', () => {
  const idx = buildIndex(pedigree(8, (k) => k % 11 === 7));
  for (const o of [{ paper: 'A2' }, { paper: 'A4' }, { fit: 'tiles' }, { paper: 'A3', shape: '360' }, { paper: 'A4', gens: 3, shape: '270' }]) {
    const fan = layoutFan(idx, 'p1', O({ gens: 8, ...o }));
    const s = fan.plan.s;
    let lines = 0;
    for (const sec of fan.sectors) {
      for (const l of sec.lines) {
        lines++;
        assert.ok(l.size * s >= FAN.minPt - 1e-6, `${JSON.stringify(o)}: «${l.text}» ${(l.size * s).toFixed(1)} пт`);
        assert.ok(insideSector(sec, l, 0.5), `${JSON.stringify(o)}: «${l.text}» вылезает из сектора ${sec.k}`);
      }
      if (!sec.id) assert.equal(sec.lines.length, 0);
    }
    assert.ok(lines > 0);
    assert.ok(fan.center.lines.length);
    // Пустой сектор — белый, известный — цветной.
    assert.ok(fan.sectors.every((x) => (x.id ? x.fill !== '#ffffff' : x.fill === '#ffffff')));
  }
  // На A2 все восемь колец подписаны; на A4 дальние не помещаются — это видно в подсказке.
  assert.equal(layoutFan(idx, 'p1', O({ gens: 8, paper: 'A2' })).crowded, 0);
  assert.ok(layoutFan(idx, 'p1', O({ gens: 8, paper: 'A4' })).crowded > 0);
  // Пять поколений на A4 — полностью, с годами.
  const five = layoutFan(idx, 'p1', O({ gens: 5 }));
  assert.equal(five.crowded, 0);
  assert.ok(people(five).every((x) => x.lines.some((l) => /\d{4}/.test(l.text))));
});

test('подписи женщин: фамилия при рождении в скобках, сокращение — инициалы', () => {
  const v = nameVariants({ surname: 'Смирнова', birth_surname: 'Орлова', given: 'Клавдия', patronymic: 'Николаевна' }, '1918 – 2001');
  const t = v.map((x) => x.map((l) => l.text).join(' / '));
  assert.equal(t[0], 'Смирнова / (Орлова) / Клавдия Николаевна / 1918 – 2001');
  assert.ok(t.includes('Смирнова (Орлова) / Клавдия Николаевна / 1918 – 2001'));
  assert.ok(t.includes('Смирнова (Орлова) К. Н. / 1918 – 2001'));
  assert.equal(t.at(-1), 'С. К. Н.');
  assert.deepEqual(nameVariants({ given: 'Иван' }, '').map((x) => x[0].text), ['Иван', 'И.']);
});

// ---------- Сервер ----------

let app;
const H = { 'x-drevo': '1' };
let owner;
let guest;

async function login(role) {
  const { token } = await createInvite({ role, label: role });
  const r = await app.inject({ method: 'POST', url: '/api/invites/redeem', headers: H, payload: { token } });
  assert.equal(r.statusCode, 200, r.body);
  return r.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
const call = (cookie, url) => app.inject({ method: 'GET', url, headers: { ...H, cookie } });
const add = async (person, relation) => {
  const r = await app.inject({ method: 'POST', url: '/api/persons', payload: { person, relation }, headers: { ...H, cookie: owner } });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};

let me; let dad; let mom; let gone;

before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(() => {});
  app = await buildApp({ logger: false, push: { timer: false, send: async () => {} } });
  owner = await login('owner');
  guest = await login('viewer');
  me = await add({ sex: 'M', surname: 'Смирнов', given: 'Дмитрий', patronymic: 'Сергеевич', living: true, birth_date: '2003' });
  dad = await add({ sex: 'M', surname: 'Смирнов', given: 'Сергей', living: true, birth_date: '1972' }, { to: me.id, type: 'father' });
  mom = await add({ sex: 'F', surname: 'Смирнова', birth_surname: 'Белова', given: 'Ольга', living: true, birth_date: '1975' }, { to: me.id, type: 'mother' });
  await add({ sex: 'M', surname: 'Смирнов', given: 'Юрий', living: false, birth_date: '1946', death_date: '2019' }, { to: dad.id, type: 'father' });
  gone = await add({ sex: 'F', surname: 'Удалённова', given: 'Галина', living: false, birth_date: '1949' }, { to: dad.id, type: 'mother' });
  const r = await app.inject({ method: 'DELETE', url: `/api/persons/${gone.id}`, headers: { ...H, cookie: owner } });
  assert.equal(r.statusCode, 200, r.body);
});
after(async () => { await app.close(); await pool.end(); });

const texts = (fan) => [...fan.sectors.flatMap((s) => s.lines), ...fan.center.lines].map((l) => l.text).join(' | ');

test('приватность: гость — живые без дат; у владельца — с датами, с галочкой «скрыть живых» — без; удалённых нет', async () => {
  const fanFor = async (user, hide, o = {}) => layoutFan(buildIndex(await loadTreeData(user, hide)), me.id, O({ root: me.id, hideLiving: hide ? '1' : '0', ...o }));
  const own = await fanFor({ role: 'owner' }, false);
  assert.match(texts(own), /р\. 2003/);
  assert.match(texts(own), /р\. 1972/);
  assert.match(texts(own), /\(Белова\)/);
  assert.match(texts(own), /1946 – 2019/);
  // Удалённая бабушка — пустое место для записи от руки.
  assert.doesNotMatch(texts(own), /Удалённова/);
  assert.equal(own.sectors.find((s) => s.k === 5).id, null);
  for (const fan of [await fanFor({ role: 'viewer' }, true), await fanFor({ role: 'owner' }, true)]) {
    const t = texts(fan);
    assert.doesNotMatch(t, /2003|1972|1975|Белова/);
    assert.match(t, /Дмитрий/);
    assert.match(t, /1946 – 2019/); // ушедшие — с датами
  }
});

test('PDF: 3 и 8 поколений, A4 и плакат; гость — тоже, имя файла', async () => {
  const pages = (r) => (r.rawPayload.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  for (const [qs, n] of [['gens=3', 1], ['gens=8', 1], ['gens=8&paper=A2&shape=360', 1], ['gens=8&fit=tiles', 9], ['gens=5&fit=tiles&scale=40&theme=bw&colors=gens', 1]]) {
    const r = await call(owner, `/api/print.pdf?mode=fan&root=${me.id}&${qs}`);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.headers['content-type'], 'application/pdf');
    assert.equal(r.rawPayload.subarray(0, 5).toString(), '%PDF-');
    if (qs.includes('tiles')) assert.ok(pages(r) >= n, `${qs}: ${pages(r)} листов`);
    else assert.equal(pages(r), n, qs);
  }
  const r = await call(guest, `/api/print.pdf?mode=fan&root=${me.id}&download=1&hideLiving=0`);
  assert.equal(r.statusCode, 200);
  assert.match(decodeURIComponent(r.headers['content-disposition']), /^attachment; .*Веер предков — Смирнов Дмитрий Сергеевич\.pdf$/);
  assert.equal((await app.inject({ method: 'GET', url: '/api/print.pdf?mode=fan', headers: H })).statusCode, 401);
});
