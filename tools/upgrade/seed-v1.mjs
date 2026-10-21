// Наполняет первую версию «Древа» (коммит 8b36643) правдоподобными данными через её API, как родственники с телефонов.
// Запускается из tools/upgrade/check.sh. Печатает в stdout состояние для проверки после обновления (JSON):
// куки вошедших, неиспользованные приглашения, ожидаемые числа.
//   node seed-v1.mjs http://127.0.0.1:8096 <ссылка владельца> <папка со снимками>
import fs from 'node:fs';
import path from 'node:path';

const [base, ownerLink, imgDir] = process.argv.slice(2);
const H = { 'x-drevo': '1', 'content-type': 'application/json' };

async function api(cookie, method, url, body) {
  const r = await fetch(base + url, { method, headers: { ...H, cookie }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function redeem(token, name) {
  const r = await fetch(base + '/api/invites/redeem', { method: 'POST', headers: H, body: JSON.stringify({ token, name }) });
  if (!r.ok) throw new Error(`redeem: ${r.status} ${await r.text()}`);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

async function photo(cookie, personId, file) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(imgDir, file))], { type: 'image/jpeg' }), file);
  const r = await fetch(`${base}/api/persons/${personId}/photo`, { method: 'POST', headers: { 'x-drevo': '1', cookie }, body: fd });
  if (!r.ok) throw new Error(`photo: ${r.status} ${await r.text()}`);
  return (await r.json()).photo_id;
}

const tokenOf = (url) => url.split('/invite/')[1];
const owner = await redeem(tokenOf(ownerLink), 'Сергей');
await api(owner, 'PUT', '/api/settings/title', { title: 'Древо Смирновых и Орловых' });

const add = (cookie, person, relation) => api(cookie, 'POST', '/api/persons', { person, relation });

// Владелец заполняет себя, родителей, дедов.
const me = await add(owner, { given: 'Сергей', patronymic: 'Петрович', surname: 'Смирнов', sex: 'M', birth_date: '12.03.1975', birth_place: 'Тверь', occupation: 'инженер' });
await api(owner, 'PATCH', '/api/me', { person_id: me.id });
const dad = await add(owner, { given: 'Пётр', patronymic: 'Иванович', surname: 'Смирнов', sex: 'M', birth_date: '1948', birth_place: 'деревня Горки' }, { to: me.id, type: 'father' });
const mom = await add(owner, { given: 'Валентина', patronymic: 'Николаевна', surname: 'Смирнова', birth_surname: 'Орлова', sex: 'F', birth_date: '05.07.1950', notes: 'Работала учителем в школе №3' }, { to: me.id, type: 'mother' });
const gf = await add(owner, { given: 'Иван', patronymic: 'Фёдорович', surname: 'Смирнов', sex: 'M', living: false, birth_date: 'около 1915', death_date: '1987', death_place: 'Тверь', burial_place: 'Дмитрово-Черкасское кладбище', occupation: 'кузнец' }, { to: dad.id, type: 'father' });
const gm = await add(owner, { given: 'Анна', patronymic: 'Степановна', surname: 'Смирнова', sex: 'F', living: false, birth_date: '1920', death_date: '2001' }, { to: dad.id, type: 'mother' });
const ggf = await add(owner, { given: 'Фёдор', surname: 'Смирнов', sex: 'M', living: false, birth_date: 'до 1890', notes: 'Со слов бабушки — служил в Первую мировую' }, { to: gf.id, type: 'father' });
const mgf = await add(owner, { given: 'Николай', patronymic: 'Андреевич', surname: 'Орлов', sex: 'M', living: false, birth_date: '1922', death_date: '1944', death_place: 'под Витебском' }, { to: mom.id, type: 'father' });
const mgm = await add(owner, { given: 'Мария', surname: 'Орлова', sex: 'F', living: false, birth_date: '1925', death_date: '2010' }, { to: mom.id, type: 'mother' });
const wife = await add(owner, { given: 'Елена', patronymic: 'Викторовна', surname: 'Смирнова', birth_surname: 'Кузнецова', sex: 'F', birth_date: '1978' }, { to: me.id, type: 'spouse' });
const son = await add(owner, { given: 'Андрей', patronymic: 'Сергеевич', surname: 'Смирнов', sex: 'M', birth_date: '2003' }, { to: me.id, type: 'child' });
const daughter = await add(owner, { given: 'Ольга', patronymic: 'Сергеевна', surname: 'Смирнова', sex: 'F', birth_date: '2008' }, { to: me.id, type: 'child' });
const sister = await add(owner, { given: 'Татьяна', patronymic: 'Петровна', surname: 'Белова', sex: 'F', birth_date: '1979' }, { to: me.id, type: 'sibling' });
const uncle = await add(owner, { given: 'Василий', patronymic: 'Иванович', surname: 'Смирнов', sex: 'M', living: false, birth_date: '1945', death_date: '2015' }, { to: dad.id, type: 'sibling' });
const cousin = await add(owner, { given: 'Дмитрий', patronymic: 'Васильевич', surname: 'Смирнов', sex: 'M', birth_date: '1970' }, { to: uncle.id, type: 'child' });
// Брак родителей: дата.
const tree = await api(owner, 'GET', '/api/tree');
const parents = tree.families.find((f) => [f.partner1, f.partner2].includes(dad.id) && [f.partner1, f.partner2].includes(mom.id));
await api(owner, 'PATCH', `/api/families/${parents.id}`, { start_date: '1973', kind: 'marriage' });

// Приглашения: участник и гость входят, ещё по одному приглашению не используются.
const inv = async (role, label) => (await api(owner, 'POST', '/api/invites', { role, label, days: 30 })).url;
const editor = await redeem(tokenOf(await inv('editor', 'Елена')), 'Елена');
const guest = await redeem(tokenOf(await inv('viewer', 'Дядя Коля')), 'Дядя Коля');
const unusedEditor = tokenOf(await inv('editor', 'Татьяна'));
const unusedViewer = tokenOf(await inv('viewer', 'Соседка'));
const usedTwice = tokenOf(await inv('viewer', 'Ещё гость'));
await redeem(usedTwice, 'Ещё гость');
const users = await api(owner, 'GET', '/api/users');
const elena = users.find((u) => u.name === 'Елена');
const relink = tokenOf((await api(owner, 'POST', `/api/users/${elena.id}/login-link`)).url);
// Владелец входит ещё и со второго устройства.
const ownerTablet = await redeem(tokenOf((await api(owner, 'POST', `/api/users/${users.find((u) => u.role === 'owner').id}/login-link`)).url));
// Елена — участница: дополняет свою родню.
await api(editor, 'PATCH', '/api/me', { person_id: wife.id });
const wDad = await add(editor, { given: 'Виктор', patronymic: 'Павлович', surname: 'Кузнецов', sex: 'M', birth_date: '1951', birth_place: 'Ржев' }, { to: wife.id, type: 'father' });
const wMom = await add(editor, { given: 'Галина', surname: 'Кузнецова', sex: 'F', birth_date: '1953' }, { to: wife.id, type: 'mother' });
const wBro = await add(editor, { given: 'Павел', patronymic: 'Викторович', surname: 'Кузнецов', sex: 'M', birth_date: '1981' }, { to: wife.id, type: 'sibling' });

// Правки и откаты.
let p = await api(owner, 'PATCH', `/api/persons/${dad.id}`, { birth_place: 'деревня Горки, Старицкий район', occupation: 'тракторист', version: dad.version });
p = await api(editor, 'PATCH', `/api/persons/${dad.id}`, { occupation: 'механизатор', version: p.version });
const hist = await api(owner, 'GET', `/api/persons/${dad.id}/history`);
await api(owner, 'POST', `/api/changes/${hist.find((h) => h.action === 'update' && h.after.occupation === 'механизатор').id}/revert`);
await api(owner, 'PATCH', `/api/persons/${gm.id}`, { birth_date: '1921', notes: 'Родилась в Старице' });
const gmHist = await api(owner, 'GET', `/api/persons/${gm.id}/history`);
await api(editor, 'POST', `/api/changes/${gmHist.find((h) => h.action === 'update').id}/revert`);

// Удаления: ошибочно добавленный — удалён насовсем; удалённый по ошибке — возвращён.
const wrong = await add(owner, { given: 'Ошибочный', surname: 'Смирнов', sex: 'M' }, { to: me.id, type: 'sibling' });
await api(owner, 'DELETE', `/api/persons/${wrong.id}`);
const del = await api(owner, 'DELETE', `/api/persons/${uncle.id}`);
await api(owner, 'POST', `/api/changes/${del.changeId}/revert`);
// Удалённый вместе с семьёй, которую удаление разобрало (у него один ребёнок): возврата не было.
const lonely = await add(editor, { given: 'Зинаида', surname: 'Орлова', sex: 'F', living: false, birth_date: '1900' }, { to: mgm.id, type: 'mother' });
const delLonely = await api(editor, 'DELETE', `/api/persons/${lonely.id}`);
// Удаление дяди разобрало его семью (один ребёнок), возврат её не вернул — привязываем сына заново, как сделал бы владелец.
await api(owner, 'POST', '/api/relations', { personId: cousin.id, to: uncle.id, type: 'child' });
// Связь: сын отвязан от родителей и привязан заново.
const t2 = await api(owner, 'GET', '/api/tree');
const sonFam = t2.children.find((c) => c.child_id === son.id).family_id;
await api(owner, 'DELETE', `/api/families/${sonFam}/members/${son.id}`);
await api(owner, 'POST', '/api/relations', { personId: son.id, to: me.id, type: 'child' });

// Фото: обычные, заменённое, убранное, убранное и загруженное снова.
const photos = {};
photos.gf = await photo(owner, gf.id, 'a.jpg');
photos.gm = await photo(owner, gm.id, 'b.jpg');
photos.dadOld = await photo(owner, dad.id, 'c.jpg');
photos.dadNew = await photo(editor, dad.id, 'd.jpg'); // заменила фото
photos.momRemoved = await photo(owner, mom.id, 'a.jpg');
await api(owner, 'DELETE', `/api/persons/${mom.id}/photo`); // убрали фото
photos.sisterFirst = await photo(editor, sister.id, 'b.jpg');
await api(editor, 'DELETE', `/api/persons/${sister.id}/photo`);
photos.sisterSecond = await photo(editor, sister.id, 'c.jpg');
photos.ggf = await photo(owner, ggf.id, 'd.jpg');
photos.mgf = await photo(owner, mgf.id, 'a.jpg');

const final = await api(owner, 'GET', '/api/tree');
const changes = await api(owner, 'GET', '/api/changes');
console.log(JSON.stringify({
  cookies: { owner, ownerTablet, editor, guest },
  invites: { unusedEditor, unusedViewer, usedTwice, relink },
  ids: { me: me.id, dad: dad.id, mom: mom.id, gf: gf.id, gm: gm.id, sister: sister.id, uncle: uncle.id, cousin: cousin.id, wrong: wrong.id, lonely: lonely.id, elena: elena.id },
  photos,
  delLonely: delLonely.changeId,
  expect: { persons: final.persons.length, families: final.families.length, children: final.children.length, changesTop: changes[0].id, title: final.settings.title },
}, null, 2));
