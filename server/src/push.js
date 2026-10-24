// Уведомления на телефон через Web Push (VAPID): приходят и при закрытом приложении.
// Три вида, у каждого свой переключатель: новый комментарий — сразу; правки в дереве — одной сводкой по автору,
// когда он 10 минут ничего не правил; дни рождения и памятные даты — в 9:00 по Москве.
// Расписание — раз в минуту внутри процесса. Что уже отправлено, отмечается в базе до отправки (migrations/006_push.sql):
// одно и то же не уйдёт дважды и после перезапуска. Содержимое шифруется для телефона, сервис браузера его не видит.
import webpush from 'web-push';
import { q } from './db.js';
import { config } from './config.js';
import { need } from './auth.js';
import { HttpError } from './tree.js';
import { STANDS, RESEARCH } from './changes.js';
import { isGuest, hideLiving } from './privacy.js';
import { fullName, isPrivate, upcomingDates, yearsText } from '../../shared/names.js';
import { deviceName } from '../../shared/device.js';

const TICK = 60000;
const QUIET = 10; // минут тишины после последней правки автора
const HOUR = 9; // во сколько по Москве присылать даты
const MSK = 3 * 3600000; // Москва без перехода на летнее время
const CATCH_UP = 15; // минут: комментарии, которые не успели разослать (сервер перезапускался)
const FLAGS = { comments: 'notify_comments', edits: 'notify_edits', dates: 'notify_dates' };
// Адреса подписок — только сервисы уведомлений браузеров: сервер не должен ходить куда попало по чужой указке.
const SERVICES = /(^|\.)(googleapis\.com|mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;

const plural = (n, one, few, many) => {
  const a = n % 10;
  const b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`;
};
const verb = (stem, sex) => stem + (sex === 'F' ? 'а' : sex === 'M' ? '' : '(а)');
const short = (text, n = 140) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

// Дата и час по Москве; date — полночь этого дня по часам сервера, как ждёт upcomingDates.
function moscow(now) {
  const m = new Date(now.getTime() + MSK);
  return { day: m.toISOString().slice(0, 10), hour: m.getUTCHours(), date: new Date(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate()) };
}

// «Елена добавила 3 человек и 2 фото, изменила 1 карточку».
export function digestText(name, sex, entries, ops) {
  const n = { added: 0, removed: 0, photos: 0, docs: 0, dropPhotos: 0, dropDocs: 0, cards: new Set(), files: new Set(),
    stories: 0, dropStories: 0, storyEdits: new Set(), sources: 0, dropSources: 0, sourceEdits: new Set(), cited: new Set(), quality: 0,
    events: 0, dropEvents: 0, eventEdits: new Set(), places: 0, dropPlaces: 0, placeEdits: new Set(), merged: 0 };
  let links = 0;
  const loads = [];
  for (const op of ops) {
    const mine = entries.filter((e) => e.op === op);
    // Загрузка из файла — одной фразой по сводке, без счёта сотен записей.
    const imp = mine.find((e) => e.entity === 'import');
    if (imp) {
      loads.push(imp.action === 'load' ? imp.after || {} : null);
      continue;
    }
    // Первое фото само становится главным, удалённое перестаёт им быть: это часть добавления или удаления файла.
    const withFiles = mine.some((e) => e.entity === 'media' && ['add', 'delete'].includes(e.action));
    // Новый источник сразу привязывается к сведению: это часть добавления, а не правка.
    const newSources = new Set(mine.filter((e) => e.entity === 'source' && e.action === 'add').map((e) => e.entity_id));
    // Новое название места само меняется в карточках: это часть правки места, а не правка карточек.
    const withPlace = mine.some((e) => e.entity === 'place');
    for (const e of mine) {
      if (withPlace && e.entity !== 'place') continue;
      if (e.entity === 'media') {
        if (e.action === 'add') n[e.after?.kind === 'doc' ? 'docs' : 'photos']++;
        else if (e.action === 'delete') n[e.before?.kind === 'doc' ? 'dropDocs' : 'dropPhotos']++;
        else n.files.add(e.entity_id);
      } else if (e.entity === 'story') {
        if (e.action === 'add') n.stories++;
        else if (e.action === 'delete') n.dropStories++;
        else n.storyEdits.add(e.entity_id);
      } else if (e.entity === 'event') {
        if (e.action === 'add') n.events++;
        else if (e.action === 'delete') n.dropEvents++;
        else n.eventEdits.add(e.entity_id);
      } else if (e.entity === 'source') {
        if (e.action === 'add') n.sources++;
        else if (e.action === 'delete') n.dropSources++;
        else n.sourceEdits.add(e.entity_id);
      } else if (e.entity === 'citation') {
        const id = (e.after || e.before)?.source_id;
        if (e.action !== 'add') n.sourceEdits.add(id);
        else if (!newSources.has(id)) n.cited.add(id);
      } else if (e.entity === 'place') {
        if (e.action === 'add') n.places++;
        else if (e.action === 'delete') n.dropPlaces++;
        else n.placeEdits.add(e.entity_id);
      } else if (e.entity === 'quality') {
        n.quality++;
      } else if (e.entity === 'person') {
        // Объединение дублей — одной фразой: правка оставшейся карточки и удаление второй — его части.
        if (e.action === 'merge') n.merged++;
        else if (mine.some((x) => x.entity === 'person' && x.action === 'merge')) continue;
        else if (e.action === 'create') n.added++;
        else if (e.action === 'delete') n.removed++;
        else if (e.action !== 'photo' || !withFiles) n.cards.add(e.entity_id);
      }
    }
    if (mine.every((e) => e.entity === 'family')) links++;
  }
  const docs = (k) => k && plural(k, 'документ', 'документа', 'документов');
  const stories = (k) => k && plural(k, 'историю', 'истории', 'историй');
  const sources = (k) => k && plural(k, 'источник', 'источника', 'источников');
  const events = (k) => k && plural(k, 'событие', 'события', 'событий');
  const places = (k) => k && plural(k, 'место', 'места', 'мест');
  const groups = [
    [verb('добавил', sex), [n.added && plural(n.added, 'человека', 'человек', 'человек'), n.photos && `${n.photos} фото`, docs(n.docs), stories(n.stories),
      events(n.events), sources(n.sources), places(n.places)]],
    [verb('изменил', sex), [n.cards.size && plural(n.cards.size, 'карточку', 'карточки', 'карточек'), n.files.size && `${n.files.size} фото`,
      stories(n.storyEdits.size), events(n.eventEdits.size), sources(n.sourceEdits.size), places(n.placeEdits.size), links && plural(links, 'связь', 'связи', 'связей')]],
    [verb('объединил', sex), [n.merged && `${plural(n.merged, 'пару', 'пары', 'пар')} карточек-дублей`]],
    [verb('указал', sex), [sources(n.cited.size)]],
    [verb('отметил', sex), [n.quality && `достоверность ${plural(n.quality, 'сведения', 'сведений', 'сведений')}`]],
    [verb('удалил', sex), [n.removed && plural(n.removed, 'человека', 'человек', 'человек'), n.dropPhotos && `${n.dropPhotos} фото`, docs(n.dropDocs), stories(n.dropStories),
      events(n.dropEvents), sources(n.dropSources), places(n.dropPlaces)]],
  ].map(([v, items]) => [v, items.filter(Boolean)]).filter(([, items]) => items.length);
  const files = loads.filter(Boolean);
  if (files.length) {
    const n = files.reduce((sum, x) => sum + (x.persons || 0), 0);
    const m = files.reduce((sum, x) => sum + (x.matched || 0), 0);
    if (n || !m) groups.unshift([`${verb('загрузил', sex)} из файла`, [plural(n, 'человека', 'человек', 'человек')]]);
    else groups.unshift([`${verb('дополнил', sex)} из файла`, [plural(m, 'карточку', 'карточки', 'карточек')]]);
  }
  if (loads.some((x) => !x)) groups.push([verb('отменил', sex), ['загрузку из файла']]);
  const what = groups.map(([v, items]) => `${v} ${items.length > 1 ? `${items.slice(0, -1).join(', ')} и ${items.at(-1)}` : items[0]}`).join(', ');
  return `${name || 'Кто-то'} ${what || `${verb('сделал', sex)} ${plural(ops.length, 'правку', 'правки', 'правок')}`}`;
}

const ROLE = { owner: 'владелец', editor: 'участник', relative: 'родственник', viewer: 'гость' };
// «24 октября, 14:05» по Москве.
const when = (at) => {
  const t = (o) => new Date(at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', ...o });
  return `${t({ day: 'numeric', month: 'long' })}, ${t({ hour: '2-digit', minute: '2-digit' })}`;
};

// Вход для владельца: «Вошла Ольга (участник)», «Android, Chrome · 24 октября, 14:05».
export function loginText(l) {
  const by = { F: ['Вошла', 'она'], M: ['Вошёл', 'он'] }[l.sex] || ['Вошёл(а)', 'он(а)'];
  const line = `${deviceName(l.user_agent)} · ${when(l.at)}`;
  if (l.kind === 'fails') {
    return { title: `${l.name}: пять раз неверный пароль`, body: `${line}. Кто-то пробует войти. Вход закрыт на 15 минут.` };
  }
  return {
    title: l.pending ? `${l.name} (${ROLE[l.role]}) открыл${l.sex === 'F' ? 'а' : l.sex === 'M' ? '' : '(а)'} ссылку для входа` : `${by[0]} ${l.name} (${ROLE[l.role]})`,
    body: `${line}.${l.pending ? ' Войдёт после пароля.' : ''} Если это не ${by[1]} — отключите в «Ещё → Родственники и приглашения».`,
  };
}

function dateLine(d) {
  const name = [d.person.given, d.person.surname].filter(Boolean).join(' ') || fullName(d.person);
  if (d.kind === 'birthday') return `Сегодня день рождения: ${name}, ${yearsText(d.years)}`;
  return `Сегодня ${yearsText(d.years)} со дня ${d.kind === 'birth' ? 'рождения' : 'смерти'}: ${name}`;
}

// opts.send(subscription, payload, options) — отправитель (в тестах подменяется), opts.clock() — часы,
// opts.timer: false — без расписания, проходы вызываются вручную через app.push.tick().
export function pushPlugin(app, opts = {}) {
  const send = opts.send || webpush.sendNotification.bind(webpush);
  const clock = opts.clock || (() => new Date());
  const pending = new Set();
  let keys = null;
  let busy = null;
  let timer = null;
  let cleaned = '';

  // Ключи VAPID создаются при первом запуске. Публичный отдаётся телефонам, закрытый не покидает базу.
  function vapid() {
    keys ??= (async () => {
      const read = async () => (await q('select public_key, private_key from push_keys'))[0];
      const k = await read();
      if (k) return k;
      const g = webpush.generateVAPIDKeys();
      await q('insert into push_keys (public_key, private_key) values ($1, $2) on conflict do nothing', [g.publicKey, g.privateKey]);
      return read();
    })();
    keys.catch(() => { keys = null; });
    return keys;
  }

  const claim = async (kind, key) => (await q(
    'insert into push_sent (kind, key) values ($1, $2) on conflict do nothing returning 1', [kind, String(key)],
  )).length > 0;

  // Подписки тех, у кого включён этот вид уведомлений, кроме автора. Роль — нынешняя.
  const recipients = (what, except = null) => q(
    `select s.endpoint, s.p256dh, s.auth, u.id as user_id, u.role from push_subs s join users u on u.id = s.user_id
     where not u.disabled and u.${FLAGS[what]} and u.id is distinct from $1`,
    [except],
  );

  // Разослать; подписку, которой больше нет (404/410 от сервиса), удалить. Возвращает, сколько ушло.
  async function deliver(subs, msg) {
    if (!subs.length) return 0;
    const k = await vapid();
    const options = {
      vapidDetails: {
        subject: config.publicUrl.startsWith('https:') ? config.publicUrl : 'mailto:drevo@localhost',
        publicKey: k.public_key,
        privateKey: k.private_key,
      },
      TTL: 24 * 3600,
      timeout: 15000,
    };
    const payload = JSON.stringify(msg);
    const done = await Promise.all(subs.map(async (s) => {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options);
        return 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) await q('delete from push_subs where endpoint = $1', [s.endpoint]);
        else app.log.warn({ status: err.statusCode, error: err.message }, 'уведомление не ушло');
        return 0;
      }
    }));
    return done.reduce((a, b) => a + b, 0);
  }

  async function comment(id) {
    const c = (await q(
      `select c.id, c.person_id, c.user_id, c.body, u.name as user_name, p.surname, p.given, p.patronymic, p.living, p.birth_date
       from comments c join users u on u.id = c.user_id join persons p on p.id = c.person_id
       where c.id = $1 and c.deleted_at is null and p.deleted_at is null`,
      [id],
    ))[0];
    if (!c || !(await claim('comment', c.id))) return;
    // Гость не видит обсуждений живых — и уведомлений о них не получает.
    const hidden = isPrivate(c);
    const subs = (await recipients('comments', c.user_id)).filter((s) => !(hidden && isGuest(s)));
    await deliver(subs, {
      title: `${c.user_name || 'Кто-то'} — в обсуждении: ${fullName(c)}`,
      body: short(c.body),
      url: `/#/person/${c.person_id}?talk=1`,
      tag: `talk-${c.person_id}`,
    });
  }

  // Анкету отправили: сообщить тому, кто её создал, и владельцу — если они по-прежнему правят дерево.
  async function survey(id) {
    const s = (await q(
      `select id, name, created_by, answers->'people'->'self'->>'sex' as sex from surveys where id = $1 and submitted_at is not null`, [id],
    ))[0];
    if (!s || !(await claim('survey', s.id))) return;
    const subs = await q(
      `select s.endpoint, s.p256dh, s.auth from push_subs s join users u on u.id = s.user_id
       where not u.disabled and (u.role = 'owner' or (u.id = $1 and u.role = 'editor'))`,
      [s.created_by],
    );
    await deliver(subs, {
      title: `${s.name} ${verb('заполнил', s.sex)} анкету`,
      body: 'Посмотрите ответы и загрузите их в дерево',
      url: `/#/surveys/${s.id}`,
      tag: `survey-${s.id}`,
    });
  }

  // Новый вход или пять неверных паролей — всем владельцам, на все их телефоны; без переключателя: это защита.
  async function login(id) {
    const [l] = await q(
      `select l.at, l.kind, l.role, l.user_agent, u.name, p.sex, coalesce(s.pending, false) as pending
       from logins l join users u on u.id = l.user_id left join persons p on p.id = u.person_id
       left join sessions s on s.token_hash = l.session_hash where l.id = $1`,
      [id],
    );
    if (!l || !(await claim('login', id))) return;
    const subs = await q(
      `select s.endpoint, s.p256dh, s.auth from push_subs s join users u on u.id = s.user_id join sessions x on x.token_hash = s.session_hash
       where not u.disabled and u.role = 'owner' and u.password_hash is not null and not x.pending`,
    );
    await deliver(subs, { ...loginText(l), url: '/#/family', tag: `login-${id}` });
  }

  // Комментарии, о которых не успели сообщить сразу.
  async function missedComments(now) {
    const rows = await q(
      `select c.id from comments c where c.deleted_at is null and c.created_at between $1::timestamptz - make_interval(mins => $2) and $1
       and not exists (select 1 from push_sent s where s.kind = 'comment' and s.key = c.id::text) order by c.created_at`,
      [now, CATCH_UP],
    );
    for (const r of rows) await comment(r.id);
  }

  // Сводки правок: по автору, который QUIET минут ничего не правил. Только действия, оставшиеся в силе, как в ленте.
  async function digests(now) {
    const due = await q(
      `select c.user_id, max(c.id) as last, coalesce(max(d.last_change), 0) as prev
       from changes c left join push_digests d on d.user_id = c.user_id
       where c.user_id is not null and c.id > coalesce(d.last_change, 0)
       group by c.user_id having max(c.at) < $1::timestamptz - make_interval(mins => $2)`,
      [now, QUIET],
    );
    for (const d of due) {
      // Отметка до отправки: второй проход (или второй процесс) ту же сводку не разошлёт.
      const won = await q(
        `insert into push_digests (user_id, last_change) values ($1, $2)
         on conflict (user_id) do update set last_change = excluded.last_change, sent_at = now()
         where push_digests.last_change < excluded.last_change returning 1`,
        [d.user_id, d.last],
      );
      if (!won.length) continue;
      const entries = await q(
        `select c.op, c.entity, c.entity_id, c.action, c.before, c.after from changes c where c.op in (
           select c.op from changes c where c.user_id = $1 group by c.op
           having max(c.id) > $2 and max(c.id) <= $3 and ${STANDS})
         and c.entity <> all($4)
         order by c.id`,
        [d.user_id, d.prev, d.last, RESEARCH],
      );
      if (!entries.length) continue;
      const [author] = await q('select u.name, p.sex from users u left join persons p on p.id = u.person_id where u.id = $1', [d.user_id]);
      const ops = [...new Set(entries.map((e) => e.op))];
      await deliver(await recipients('edits', d.user_id), {
        title: 'Правки в дереве',
        body: digestText(author?.name, author?.sex, entries, ops),
        url: '/#/feed',
        tag: `edits-${d.user_id}`,
      });
    }
  }

  // Даты — с 9:00 по Москве, одно уведомление в день на каждого. Сервер был выключен в 9:00 — уйдут при запуске.
  async function dates(now) {
    const t = moscow(now);
    if (t.hour < HOUR) return;
    if (cleaned !== t.day) {
      await q("delete from push_sent where sent_at < now() - interval '40 days'");
      cleaned = t.day;
    }
    const subs = await q(
      `select s.endpoint, s.p256dh, s.auth, u.id as user_id, u.role from push_subs s join users u on u.id = s.user_id
       where not u.disabled and u.notify_dates
       and not exists (select 1 from push_sent x where x.kind = 'dates' and x.key = $1 || ':' || u.id)`,
      [t.day],
    );
    if (!subs.length) return;
    const persons = await q('select * from persons where deleted_at is null');
    const lists = {
      full: upcomingDates(persons, t.date, 0),
      // Гостю — по тем же данным, что он видит: без дат живых.
      guest: upcomingDates(hideLiving({ persons, families: [] }).persons, t.date, 0),
    };
    for (const userId of new Set(subs.map((s) => s.user_id))) {
      const mine = subs.filter((s) => s.user_id === userId);
      if (!(await claim('dates', `${t.day}:${userId}`))) continue;
      const list = lists[isGuest(mine[0]) ? 'guest' : 'full'];
      if (!list.length) continue;
      const lines = list.map(dateLine);
      await deliver(mine, {
        ...(lines.length === 1 ? { title: lines[0], body: '' } : { title: 'Памятные даты сегодня', body: lines.join('\n') }),
        url: list.length === 1 ? `/#/person/${list[0].person.id}` : '/#/feed',
        tag: `dates-${t.day}`,
      });
    }
  }

  // Один проход расписания; если предыдущий ещё идёт — ждём его, а не запускаем второй.
  function tick() {
    busy ??= (async () => {
      const now = clock();
      for (const step of [missedComments, digests, dates]) {
        try {
          await step(now);
        } catch (err) {
          app.log.error({ err }, 'уведомления: ошибка в расписании');
        }
      }
    })().finally(() => { busy = null; });
    return busy;
  }

  // Отправка не задерживает ответ телефону.
  function later(fn) {
    const p = fn().catch((err) => app.log.error({ err }, 'уведомление не ушло')).finally(() => pending.delete(p));
    pending.add(p);
  }

  app.decorate('push', {
    comment: (id) => later(() => comment(id)),
    survey: (id) => later(() => survey(id)),
    login: (id) => later(() => login(id)),
    tick,
    settled: () => Promise.all([...pending, busy]),
  });

  app.get('/api/push/key', { preHandler: need('viewer') }, async () => ({ key: (await vapid()).public_key }));

  app.put('/api/push/subscription', { preHandler: need('viewer') }, async (req) => {
    const { endpoint, keys: k } = req.body || {};
    let host = '';
    try {
      const u = new URL(typeof endpoint === 'string' ? endpoint : '');
      if (u.protocol === 'https:') host = u.hostname;
    } catch { /* не адрес */ }
    if (!SERVICES.test(host) || endpoint.length > 1000 || typeof k?.p256dh !== 'string' || typeof k?.auth !== 'string'
      || !k.p256dh || !k.auth || k.p256dh.length > 200 || k.auth.length > 100) {
      throw new HttpError(400, 'Этот браузер прислал непонятную подписку на уведомления');
    }
    await q(
      `insert into push_subs (endpoint, user_id, session_hash, p256dh, auth) values ($1, $2, $3, $4, $5)
       on conflict (endpoint) do update set user_id = excluded.user_id, session_hash = excluded.session_hash,
         p256dh = excluded.p256dh, auth = excluded.auth`,
      [endpoint, req.user.id, req.sessionHash, k.p256dh, k.auth],
    );
    return { ok: true };
  });

  app.delete('/api/push/subscription', { preHandler: need('viewer') }, async (req) => {
    await q('delete from push_subs where endpoint = $1 and user_id = $2', [String(req.body?.endpoint || ''), req.user.id]);
    return { ok: true };
  });

  const settings = async (userId) => {
    const u = (await q('select notify_comments, notify_edits, notify_dates from users where id = $1', [userId]))[0];
    return Object.fromEntries(Object.entries(FLAGS).map(([k, col]) => [k, u[col]]));
  };

  app.get('/api/push/settings', { preHandler: need('viewer') }, async (req) => settings(req.user.id));

  app.patch('/api/push/settings', { preHandler: need('viewer') }, async (req) => {
    const set = Object.entries(FLAGS).filter(([k]) => typeof req.body?.[k] === 'boolean');
    if (set.length) {
      await q(`update users set ${set.map(([, col], i) => `${col} = $${i + 2}`).join(', ')} where id = $1`,
        [req.user.id, ...set.map(([k]) => req.body[k])]);
    }
    return settings(req.user.id);
  });

  // Проверочное — на этот телефон (endpoint), а если он не указан — на все телефоны человека.
  app.post('/api/push/test', { preHandler: need('viewer') }, async (req) => {
    const endpoint = req.body?.endpoint ? String(req.body.endpoint) : null;
    const subs = await q('select endpoint, p256dh, auth from push_subs where user_id = $1 and ($2::text is null or endpoint = $2)',
      [req.user.id, endpoint]);
    if (!subs.length) throw new HttpError(400, 'Уведомления на этом телефоне не включены');
    const sent = await deliver(subs, {
      title: 'Проверка уведомлений',
      body: 'Всё работает. Так будут приходить новости семейного дерева.',
      url: '/#/notify',
      tag: 'test',
    });
    return { sent };
  });

  app.addHook('onReady', async () => {
    await vapid();
    if (opts.timer === false) return;
    tick();
    timer = setInterval(tick, TICK);
    timer.unref();
  });

  app.addHook('onClose', async () => {
    clearInterval(timer);
    await Promise.all([...pending, busy]);
  });
}
