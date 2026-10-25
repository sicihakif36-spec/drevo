// Семьи на сервере (src/tenants.js).
// У телефона: «Мои семьи» — в каких семьях он вошёл, и переключение между ними.
// У владельцев главной семьи: «Семьи на сервере» — ссылки «Завести своё дерево» и список семей: название, владельцы,
// сколько людей и места, когда заходили; предел места и «Закрыть вход». Самих деревьев других семей они не видят.
// Кто открыл ссылку — владелец новой пустой семьи; дальше он зовёт своих родных обычными приглашениями.
import { q, core } from '../db.js';
import { need, hash, newToken, startSession, chooseTenant, ALIVE } from '../auth.js';
import { config } from '../config.js';
import { HttpError } from '../tree.js';
import { checkRate, badLink } from '../limit.js';
import { USED, createTenant, loadTenants, mainTenant, space, tenantById, tenantOfCookie, tenants, withTenant } from '../tenants.js';

const DAYS = [1, 3, 7, 14];
const LINK_DAYS = 7;
const MB = 1024 * 1024;
const text = (v, n) => String(v ?? '').trim().slice(0, n);
const linkOf = (token) => `${config.publicUrl}/#/new/${token}`;
const titleOf = async () => (await q("select value #>> '{}' as title from settings where key = 'title'"))[0]?.title || '';

// Семья запроса — для телефона: номер, главная ли, название дерева.
export async function tenantInfo(t) {
  return { id: t.id, main: t.main, title: t.closed_at ? t.title : await titleOf(), closed: Boolean(t.closed_at) };
}

// В каких семьях вошёл этот телефон: по cookie входа каждой семьи, только живые входы.
export async function myTenants(req) {
  const out = [];
  for (const [name, token] of Object.entries(req.cookies || {})) {
    const t = tenantOfCookie(name);
    if (!t || !token) continue;
    const [row] = await withTenant(t, () => q(
      `select u.name, u.role, s.pending, (select value #>> '{}' from settings where key = 'title') as title
       from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and not u.disabled and ${ALIVE}`,
      [hash(token)],
    ));
    if (row) out.push({ id: t.id, main: t.main, title: row.title || t.title, name: row.name, role: row.role, pending: row.pending, closed: Boolean(t.closed_at), current: t.id === req.tenant.id });
  }
  // Главная — первой, дальше — по порядку создания.
  const order = tenants().map((t) => t.id);
  return out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

// Семьями на сервере управляют владельцы главной семьи (и только из неё): need('owner') и это.
function mainOnly(req) {
  if (!req.tenant.main) throw new HttpError(403, 'Семьями на сервере управляют владельцы главной семьи');
}

// Семья для списка: только сводка, ничего из самого дерева, кроме названия.
async function summary(t) {
  const [r] = await withTenant(t, () => q(
    `select (select value #>> '{}' from settings where key = 'title') as title,
       (select count(*)::int from persons where deleted_at is null) as persons,
       (select count(*)::int from users where not disabled) as users,
       (select coalesce(string_agg(name, ', ' order by created_at), '') from users where role = 'owner' and not disabled) as owners,
       (select max(last_seen_at) from sessions) as last_seen_at,
       ${USED} as used`,
  ));
  return {
    id: t.id, main: t.main, title: r.title || t.title, created_at: t.created_at, created_by: t.created_by || '', label: t.link_label || '',
    owners: r.owners, persons: r.persons, users: r.users, last_seen_at: r.last_seen_at, used: Number(r.used),
    quota: t.quota_mb ? t.quota_mb * MB : null, closed_at: t.closed_at,
  };
}

const count = () => tenants().filter((t) => !t.main).length;

export default async function tenantRoutes(app) {
  // ---------- Телефон: мои семьи ----------

  app.get('/api/tenants/mine', async (req) => myTenants(req));

  // Перейти в другую семью, в которой этот телефон уже вошёл.
  app.post('/api/tenants/switch', async (req, reply) => {
    const t = tenantById(String(req.body?.id || ''));
    if (!t || !(await myTenants(req)).some((x) => x.id === t.id)) throw new HttpError(400, 'В эту семью на этом телефоне не входили. Нужна ссылка-приглашение.');
    if (t.closed_at) throw new HttpError(403, 'Вход в это дерево закрыт');
    chooseTenant(reply, t);
    return { ok: true };
  });

  // Место семьи для её владельца: сколько занято и сколько можно (null — без предела).
  app.get('/api/tenants/space', { preHandler: need('owner') }, async (req) => space(req.tenant));

  // ---------- Владельцы главной семьи: семьи на сервере ----------

  app.get('/api/tenants', { preHandler: need('owner') }, async (req) => {
    mainOnly(req);
    const list = [];
    for (const t of tenants()) list.push(await summary(t));
    return { list, max: config.maxFamilies, count: count(), quota: config.familyQuotaMb * MB };
  });

  // Предел места (МБ) и «Закрыть вход» / «Открыть вход». Главную семью закрыть и ограничить нельзя.
  app.patch('/api/tenants/:id', { preHandler: need('owner') }, async (req) => {
    mainOnly(req);
    const t = tenantById(req.params.id);
    if (!t) throw new HttpError(404, 'Семья не найдена');
    if (t.main) throw new HttpError(400, 'Главную семью закрыть или ограничить нельзя');
    const { quota_mb: quota, closed } = req.body || {};
    if (quota !== undefined) {
      if (!Number.isInteger(quota) || quota < 100 || quota > 1024 * 1024) throw new HttpError(400, 'Предел места — от 100 МБ до 1 ТБ');
      await core('update core.tenants set quota_mb = $2 where id = $1', [t.id, quota]);
    }
    if (closed !== undefined) {
      // Название на момент закрытия: пока вход закрыт, в список его берём отсюда.
      const title = await withTenant(t, titleOf);
      await core(`update core.tenants set closed_at = ${closed ? 'coalesce(closed_at, now())' : 'null'}, title = coalesce(nullif($2, ''), title) where id = $1`, [t.id, title]);
    }
    await loadTenants();
    return summary(tenantById(t.id));
  });

  app.get('/api/tenant-links', { preHandler: need('owner') }, async (req) => {
    mainOnly(req);
    return core(`select token_hash as id, label, created_at, expires_at from core.tenant_links
      where used_at is null and expires_at > now() order by created_at desc`);
  });

  app.post('/api/tenant-links', { preHandler: need('owner') }, async (req) => {
    mainOnly(req);
    if (count() >= config.maxFamilies) throw new HttpError(409, `На сервере уже ${config.maxFamilies} семей — больше нельзя`);
    const days = req.body?.days === undefined ? LINK_DAYS : Number(req.body.days);
    if (!DAYS.includes(days)) throw new HttpError(400, `Срок ссылки — ${DAYS.join(', ')} дней`);
    const token = newToken();
    await core(
      `insert into core.tenant_links (token_hash, label, created_by, expires_at) values ($1, $2, $3, now() + make_interval(days => $4))`,
      [hash(token), text(req.body?.label, 80), req.user.id, days],
    );
    return { token, url: linkOf(token) };
  });

  app.delete('/api/tenant-links/:id', { preHandler: need('owner') }, async (req) => {
    mainOnly(req);
    await core('delete from core.tenant_links where token_hash = $1 and used_at is null', [req.params.id]);
    return { ok: true };
  });

  // ---------- По ссылке «Завести своё дерево», без входа ----------

  async function link(req) {
    checkRate('family', req.ip);
    const token = String(req.body?.token || '');
    const [l] = token.length >= 20 && token.length <= 100
      ? await core('select * from core.tenant_links where token_hash = $1 and used_at is null and expires_at > now()', [hash(token)]) : [];
    if (!l) {
      badLink('family', req.ip);
      throw new HttpError(400, 'Ссылка недействительна или уже использована. Попросите новую у того, кто её прислал.');
    }
    return l;
  }

  // Годится ли ссылка и кто зовёт — до того, как человек заполнит форму.
  app.post('/api/tenant-links/check', async (req) => {
    const l = await link(req);
    const from = l.created_by ? await withTenant(mainTenant(), async () => (await q('select name from users where id = $1', [l.created_by]))[0]?.name) : '';
    return { ok: true, from: from || '' };
  });

  // Завести дерево: новая семья, её владелец — тот, кто открыл ссылку; телефон сразу в ней.
  app.post('/api/tenant-links/redeem', async (req, reply) => {
    const l = await link(req);
    const name = text(req.body?.name, 80);
    const title = text(req.body?.title, 80);
    if (!name) throw new HttpError(400, 'Напишите, как вас зовут');
    if (!title) throw new HttpError(400, 'Напишите, как назвать дерево');
    // Ссылка срабатывает один раз: забираем её до создания, при неудаче — возвращаем.
    if (!(await core('update core.tenant_links set used_at = now() where token_hash = $1 and used_at is null returning 1', [l.token_hash])).length) {
      throw new HttpError(400, 'Ссылка уже использована. Попросите новую у того, кто её прислал.');
    }
    let t;
    try {
      t = await createTenant({ title, createdBy: name, linkLabel: l.label });
    } catch (err) {
      await core('update core.tenant_links set used_at = null where token_hash = $1', [l.token_hash]);
      throw err;
    }
    await core('update core.tenant_links set tenant_id = $2 where token_hash = $1', [l.token_hash, t.id]);
    await withTenant(t, async () => {
      const userAgent = String(req.headers['user-agent'] || '');
      const [u] = await q("insert into users (name, role) values ($1, 'owner') returning id", [name]);
      const session = await startSession(reply, u.id, { userAgent, ip: req.ip });
      await q("insert into logins (user_id, kind, role, user_agent, ip, session_hash) values ($1, 'invite', 'owner', $2, $3, $4)",
        [u.id, userAgent.slice(0, 300), req.ip || '', session]);
    });
    req.log.info({ tenant: t.id }, 'новая семья');
    withTenant(mainTenant(), () => app.push.tenant({ name, title }));
    return { ok: true, id: t.id };
  });
}
