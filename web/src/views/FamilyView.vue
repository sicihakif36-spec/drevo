<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { store, toast } from '../store.js';
import { api } from '../api.js';
import { ask } from '../components/ask.js';
import { fullName, lifespan, personHas } from '@shared/names.js';
import { whenText } from '../when.js';

// Кто что увидит и сможет.
const ROLES = [
  ['editor', 'Участник', 'видит всё, дополняет и правит'],
  ['relative', 'Родственник', 'видит всё, не правит, может обсуждать'],
  ['viewer', 'Гость', 'у живых видит только имена'],
  ['owner', 'Владелец', 'всё, включая приглашения'],
];
const HINT = Object.fromEntries(ROLES.map(([k, l, t]) => [k, `${l} — ${t}`]));
const ROLE = { owner: 'владелец', editor: 'участник', relative: 'родственник', viewer: 'гость' };
// Пароль при входе с нового телефона — у тех, кто правит дерево.
const withPassword = (r) => ['owner', 'editor'].includes(r);
const label = ref('');
const role = ref('editor');
// Сколько живёт ссылка: короче — надёжнее, если она попадёт не тому.
const DAYS = [[1, '1 день'], [3, '3 дня'], [7, '7 дней'], [14, '14 дней']];
const days = ref(3);
const link = ref(null);
// Кто это в дереве (можно не указывать): вошедший сразу связан с собой, родство считается от него.
const personId = ref(null);
const find = ref('');
const person = computed(() => store.idx?.persons.get(personId.value));
const candidates = computed(() => {
  const s = find.value.trim();
  if (s.length < 2) return [];
  return [...(store.idx?.persons.values() || [])].filter((p) => personHas(p, s)).slice(0, 6);
});
function pick(p) {
  personId.value = p.id;
  find.value = '';
  if (!label.value.trim()) label.value = [p.given, p.patronymic].filter(Boolean).join(' ');
}
const inTree = (id) => store.idx?.persons.get(id);
const invites = ref([]);
const users = ref([]);
const logins = ref([]);
const allLogins = ref(false);
const shownLogins = computed(() => (allLogins.value ? logins.value : logins.value.slice(0, 5)));

async function load() {
  [invites.value, users.value, logins.value] = await Promise.all([api('GET', '/api/invites'), api('GET', '/api/users'), api('GET', '/api/logins')]);
}
onMounted(load);

const linkCard = ref(null);
async function showLink(l) {
  link.value = l;
  await nextTick();
  linkCard.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function create() {
  await showLink({ ...(await api('POST', '/api/invites', { label: label.value, role: role.value, person_id: personId.value, days: days.value })), label: label.value, days: days.value });
  label.value = '';
  personId.value = null;
  load();
}
async function loginLink(u) {
  await showLink({ ...(await api('POST', `/api/users/${u.id}/login-link`)), label: u.name, days: 3 });
}

// «Вошла Ольга», «Вошёл Пётр»; пол — по карточке человека в дереве.
const by = (l) => ({ F: ['Вошла', 'она', 'Она'], M: ['Вошёл', 'он', 'Он'] }[l.sex] || ['Вошёл(а)', 'он(а)', 'Он(а)']);
function loginTitle(l) {
  if (l.kind === 'fails') return `${l.name}: пять раз неверный пароль`;
  return `${by(l)[0]} ${l.name} (${ROLE[l.role]})`;
}
function loginState(l) {
  if (l.disabled) return 'вход отключён';
  if (l.kind === 'fails') return 'кто-то пробует войти — вход закрыт на 15 минут';
  if (l.pending) return `ещё не ${{ F: 'ввела', M: 'ввёл' }[l.sex] || 'ввёл(а)'} пароль`;
  if (l.active) return l.kind === 'link' ? 'по ссылке для нового телефона' : 'по приглашению';
  return 'с этого устройства уже вышли';
}
// Кнопка «Это не она» — у чужих входов, пока вход не отключён.
const suspect = (l) => l.user_id !== store.me.id && !l.disabled;

async function intruder(l) {
  const [, who, Who] = by(l);
  if (!await ask({
    text: `Это не ${who}? Отключить вход «${l.name}»?`,
    note: `${Who} выйдет на всех устройствах, пароль забудется. Всё, что сделано в дереве, видно в «Последних правках» и отменяется там.`,
    yes: 'Отключить', no: 'Не отключать', danger: true,
  })) return;
  await api('POST', `/api/users/${l.user_id}/intruder`);
  await load();
  if (!await ask({
    text: `Сделать новую ссылку для «${l.name}»?`,
    note: 'Отправьте её сами тому, кому она нужна, и лучше позвоните и убедитесь, что открыл именно он. По ссылке он придумает новый пароль.',
    yes: 'Сделать ссылку', no: 'Не сейчас',
  })) return;
  await api('PATCH', `/api/users/${l.user_id}`, { disabled: false });
  await loginLink({ id: l.user_id, name: l.name });
  load();
}

// Устройства и пароль участника — в нижнем листе.
const sheet = ref(null);
async function openDevices(u) {
  sheet.value = { user: u, list: null };
  sheet.value.list = await api('GET', `/api/users/${u.id}/sessions`);
}
async function dropSession(s) {
  const u = sheet.value.user;
  if (!await ask({ text: `Выйти на устройстве «${s.device}»?`, note: `${u.name} придётся входить на нём заново по новой ссылке.`, yes: 'Выйти на нём', no: 'Не выходить', danger: true })) return;
  await api('DELETE', `/api/users/${u.id}/sessions/${s.id}`);
  await openDevices(u);
  load();
}
async function dropAll() {
  const u = sheet.value.user;
  if (!await ask({ text: `Выйти на всех устройствах «${u.name}»?`, note: 'Вход не отключается: по новой ссылке можно войти снова.', yes: 'Выйти на всех', no: 'Не выходить', danger: true })) return;
  await api('DELETE', `/api/users/${u.id}/sessions`);
  await openDevices(u);
  load();
}
async function resetPassword() {
  const u = sheet.value.user;
  if (!await ask({ text: `Сбросить пароль «${u.name}»?`, note: 'Все входы закроются. Будет новая ссылка: по ней придумывают новый пароль.', yes: 'Сбросить пароль', no: 'Не сбрасывать', danger: true })) return;
  const l = await api('POST', `/api/users/${u.id}/reset-password`);
  sheet.value = null;
  await showLink({ ...l, label: u.name, days: 3 });
  load();
}
async function share(l) {
  const text = `Приглашаю в наше семейное древо. Ссылка открывается один раз: ${l.url}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Семейное древо', text }); return; } catch { /* отмена */ }
  }
  await navigator.clipboard?.writeText(l.url);
  toast('Ссылка скопирована');
}
async function drop(i) {
  if (!await ask({ text: `Отключить ссылку${i.label ? ` для «${i.label}»` : ''}?`, note: 'Войти по ней будет нельзя. Если нужно, сделайте новую.', yes: 'Отключить ссылку', no: 'Не отключать', danger: true })) return;
  await api('DELETE', `/api/invites/${i.id}`);
  load();
}
async function setRole(u, r) { await api('PATCH', `/api/users/${u.id}`, { role: r }); load(); }
async function toggle(u) {
  if (!u.disabled && !await ask({ text: `${u.name} больше не сможет войти. Отключить?`, note: 'Вход на всех телефонах отключится, неоткрытые ссылки перестанут действовать. Включить снова можно здесь же.', yes: 'Отключить вход', no: 'Не отключать', danger: true })) return;
  await api('PATCH', `/api/users/${u.id}`, { disabled: !u.disabled });
  load();
}
const when = (t) => (t ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : 'ещё не входили');
</script>

<template>
  <div class="page">
    <h1>Родственники</h1>
    <div class="card">
      <b>Пригласить</b>
      <label class="field"><span>Кого (для себя, например «Бабушка Валя»)</span><input v-model="label" /></label>
      <div class="field">
        <span>Кто это в дереве (можно не указывать)</span>
        <p class="muted small hint">Тогда дерево откроется с него и родство будет считаться от него.</p>
        <div v-if="person" class="row picked">
          <span class="grow">{{ fullName(person) }} <span class="muted small">{{ lifespan(person) }}</span></span>
          <button class="ghost" @click="personId = null">Убрать</button>
        </div>
        <template v-else>
          <input v-model="find" placeholder="Начните вводить имя" />
          <div v-if="candidates.length" class="list" style="margin-top:6px">
            <a v-for="p in candidates" :key="p.id" href="#" @click.prevent="pick(p)">{{ fullName(p) }} <span class="muted small">{{ lifespan(p) }}</span></a>
          </div>
        </template>
      </div>
      <div class="field"><span>Что можно этому человеку</span>
        <div class="roles" role="radiogroup" aria-label="Права">
          <button v-for="[k, l, t] in ROLES" :key="k" type="button" role="radio" :aria-checked="role === k" :class="{ on: role === k }" @click="role = k">
            <b>{{ l }}</b><span>{{ t }}</span>
          </button>
        </div>
      </div>
      <div class="field"><span>Сколько действует ссылка</span>
        <div class="chips" role="radiogroup" aria-label="Срок ссылки">
          <button v-for="[d, t] in DAYS" :key="d" type="button" role="radio" class="chip" :class="{ on: days === d }" :aria-checked="days === d" @click="days = d">{{ t }}</button>
        </div>
      </div>
      <button class="primary block" @click="create">Создать ссылку</button>
    </div>

    <div v-if="link" ref="linkCard" class="card" style="margin-top:0.667rem">
      <b>Ссылка{{ link.label ? ' — ' + link.label : '' }}</b>
      <p class="small" style="word-break:break-all">{{ link.url }}</p>
      <p class="muted small">Откроется один раз, на одном телефоне, в течение {{ DAYS.find((d) => d[0] === link.days)?.[1] || '3 дня' }}. Отправьте её в мессенджер. Когда по ней войдут, вам придёт уведомление.</p>
      <button class="primary block" @click="share(link)">Отправить</button>
    </div>

    <template v-if="logins.length">
      <h2>Входы</h2>
      <p class="muted small hint">Кто и с какого устройства вошёл за последние 90 дней. Если это не тот человек — отключите.</p>
      <div class="list">
        <div v-for="l in shownLogins" :key="l.id" class="login">
          <div class="grow">
            <div :class="{ bad: l.kind === 'fails' }"><b>{{ loginTitle(l) }}</b></div>
            <div class="small">{{ l.device }} · {{ whenText(l.at) }}</div>
            <div class="muted small">{{ loginState(l) }}</div>
            <button v-if="suspect(l)" class="danger" style="margin-top:0.444rem" @click="intruder(l)">Это не {{ by(l)[1] }} — отключить</button>
          </div>
        </div>
        <button v-if="logins.length > 5 && !allLogins" class="more" @click="allLogins = true">Показать все ({{ logins.length }})</button>
      </div>
    </template>

    <h2>Участники</h2>
    <div class="list">
      <div v-for="u in users" :key="u.id" class="user">
        <div class="grow">
          <div class="ellipsis"><b>{{ u.name }}</b><span v-if="u.disabled" class="muted"> · вход отключён</span></div>
          <div class="small">{{ HINT[u.role] }}</div>
          <div class="muted small">последний вход: {{ when(u.last_seen_at) }} · устройств: {{ u.devices }}<template v-if="withPassword(u.role)"> · {{ u.has_password ? 'пароль есть' : 'пароля пока нет' }}</template></div>
          <div class="acts" v-if="u.id !== store.me.id">
            <select :value="u.role" aria-label="Права" @change="setRole(u, $event.target.value)">
              <option v-for="[k, l] in ROLES" :key="k" :value="k">{{ l.toLowerCase() }}</option>
            </select>
            <button v-if="!u.disabled" @click="loginLink(u)">Ссылка для нового телефона</button>
            <button v-if="!u.disabled" @click="openDevices(u)">Устройства{{ withPassword(u.role) ? ' и пароль' : '' }}</button>
            <button :class="{ danger: !u.disabled }" @click="toggle(u)">{{ u.disabled ? 'Включить вход' : 'Отключить вход' }}</button>
          </div>
        </div>
      </div>
    </div>

    <h2 v-if="invites.length">Неиспользованные ссылки</h2>
    <div class="list" v-if="invites.length">
      <div v-for="i in invites" :key="i.id">
        <div class="grow">{{ i.label || 'без подписи' }} <span class="muted small">· {{ ROLES.find((r) => r[0] === i.role)?.[1].toLowerCase() }}<template v-if="inTree(i.person_id)"> · в дереве: {{ fullName(inTree(i.person_id)) }}</template> · до {{ when(i.expires_at) }}</span></div>
        <button class="danger" @click="drop(i)">Отключить ссылку</button>
      </div>
    </div>

    <template v-if="sheet">
      <div class="sheet-backdrop" @click="sheet = null" />
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="devices-title">
        <h2 id="devices-title" style="margin-top:0">{{ sheet.user.name }}: устройства</h2>
        <p v-if="!sheet.list" class="muted">Загрузка…</p>
        <p v-else-if="!sheet.list.length" class="muted">Ни на одном устройстве не вошли.</p>
        <div v-else class="list">
          <div v-for="s in sheet.list" :key="s.id">
            <div class="grow">
              <b>{{ s.device }}</b>
              <div class="muted small">вошли {{ whenText(s.created_at) }} · были {{ whenText(s.last_seen_at) }}</div>
              <div v-if="s.pending" class="small bad">ждёт пароль</div>
            </div>
            <button class="danger" @click="dropSession(s)">Выйти</button>
          </div>
        </div>
        <button v-if="sheet.list?.length" class="danger block" style="margin-top:0.667rem" @click="dropAll">Выйти на всех устройствах</button>
        <template v-if="withPassword(sheet.user.role)">
          <h2>Пароль</h2>
          <p class="small">{{ sheet.user.has_password ? 'Пароль есть. Если забыли — сбросьте: будет новая ссылка, по ней придумают новый.' : 'Пароля пока нет: придумают при следующем открытии приложения.' }}</p>
          <button v-if="sheet.user.has_password" class="danger block" @click="resetPassword">Сбросить пароль</button>
        </template>
        <button class="ghost block" style="margin-top:8px" @click="sheet = null">Закрыть</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.user, .login { align-items: flex-start !important; }
.bad { color: var(--danger); font-weight: 700; }
.list > button.more { color: var(--accent-text); font-weight: 700; }
.picked { background: var(--accent-soft); color: var(--accent-soft-text); border-radius: var(--radius-s); padding: 0.222rem 0.222rem 0.222rem 0.667rem; }
.picked .ghost { color: var(--accent-soft-text); }
.hint { margin: 0 0 0.333rem; }
.roles { display: flex; flex-direction: column; gap: 0.444rem; margin-top: 0.222rem; }
.acts { display: grid; gap: 0.444rem; margin-top: 0.444rem; }
.acts > * { width: 100%; }
.roles button { display: block; text-align: left; background: var(--card); border: 2px solid var(--field); min-height: 3.111rem; padding: 0.444rem 0.667rem; color: var(--text); }
.roles button.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-soft-text); box-shadow: inset 0 0 0 1px var(--accent); }
.roles b { display: block; }
.roles span { display: block; font-size: 0.889rem; font-weight: 400; }
</style>
