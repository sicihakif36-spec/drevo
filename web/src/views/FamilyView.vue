<script setup>
import { onMounted, ref } from 'vue';
import { store, toast } from '../store.js';
import { api } from '../api.js';
import { ask } from '../components/ask.js';

// Кто что увидит и сможет.
const ROLES = [
  ['editor', 'Участник', 'видит всё, дополняет и правит'],
  ['relative', 'Родственник', 'видит всё, не правит, может обсуждать'],
  ['viewer', 'Гость', 'у живых видит только имена'],
  ['owner', 'Владелец', 'всё, включая приглашения'],
];
const HINT = Object.fromEntries(ROLES.map(([k, l, t]) => [k, `${l} — ${t}`]));
const label = ref('');
const role = ref('editor');
const link = ref(null);
const invites = ref([]);
const users = ref([]);

async function load() {
  [invites.value, users.value] = await Promise.all([api('GET', '/api/invites'), api('GET', '/api/users')]);
}
onMounted(load);

async function create() {
  link.value = { ...(await api('POST', '/api/invites', { label: label.value, role: role.value })), label: label.value };
  label.value = '';
  load();
}
async function loginLink(u) {
  link.value = { ...(await api('POST', `/api/users/${u.id}/login-link`)), label: u.name };
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
  if (!u.disabled && !await ask({ text: `${u.name} больше не сможет войти. Отключить?`, note: 'Вход на всех телефонах отключится. Включить снова можно здесь же.', yes: 'Отключить вход', no: 'Не отключать', danger: true })) return;
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
      <div class="field"><span>Что можно этому человеку</span>
        <div class="roles" role="radiogroup" aria-label="Права">
          <button v-for="[k, l, t] in ROLES" :key="k" type="button" role="radio" :aria-checked="role === k" :class="{ on: role === k }" @click="role = k">
            <b>{{ l }}</b><span>{{ t }}</span>
          </button>
        </div>
      </div>
      <button class="primary block" @click="create">Создать ссылку</button>
    </div>

    <div v-if="link" class="card" style="margin-top:0.667rem">
      <b>Ссылка{{ link.label ? ' для ' + link.label : '' }}</b>
      <p class="small" style="word-break:break-all">{{ link.url }}</p>
      <p class="muted small">Откроется один раз, на одном телефоне. Отправьте её в мессенджер.</p>
      <button class="primary block" @click="share(link)">Отправить</button>
    </div>

    <h2>Участники</h2>
    <div class="list">
      <div v-for="u in users" :key="u.id" class="user">
        <div class="grow">
          <div class="ellipsis"><b>{{ u.name }}</b><span v-if="u.disabled" class="muted"> · вход отключён</span></div>
          <div class="small">{{ HINT[u.role] }}</div>
          <div class="muted small">последний вход: {{ when(u.last_seen_at) }}</div>
          <div class="acts" v-if="u.id !== store.me.id">
            <select :value="u.role" aria-label="Права" @change="setRole(u, $event.target.value)">
              <option v-for="[k, l] in ROLES" :key="k" :value="k">{{ l.toLowerCase() }}</option>
            </select>
            <button @click="loginLink(u)">Ссылка для нового телефона</button>
            <button :class="{ danger: !u.disabled }" @click="toggle(u)">{{ u.disabled ? 'Включить вход' : 'Отключить вход' }}</button>
          </div>
        </div>
      </div>
    </div>

    <h2 v-if="invites.length">Неиспользованные ссылки</h2>
    <div class="list" v-if="invites.length">
      <div v-for="i in invites" :key="i.id">
        <div class="grow">{{ i.label || 'без подписи' }} <span class="muted small">· {{ ROLES.find((r) => r[0] === i.role)?.[1].toLowerCase() }} · до {{ when(i.expires_at) }}</span></div>
        <button class="danger" @click="drop(i)">Отключить ссылку</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.user { align-items: flex-start !important; }
.roles { display: flex; flex-direction: column; gap: 0.444rem; margin-top: 0.222rem; }
.acts { display: grid; gap: 0.444rem; margin-top: 0.444rem; }
.acts > * { width: 100%; }
.roles button { display: block; text-align: left; background: var(--card); border: 2px solid var(--field); min-height: 3.111rem; padding: 0.444rem 0.667rem; color: var(--text); }
.roles button.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-soft-text); box-shadow: inset 0 0 0 1px var(--accent); }
.roles b { display: block; }
.roles span { display: block; font-size: 0.889rem; font-weight: 400; }
</style>
