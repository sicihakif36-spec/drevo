<script setup>
import { onMounted, ref } from 'vue';
import { store, toast } from '../store.js';
import { api } from '../api.js';

const ROLES = [['editor', 'Участник: добавляет и правит'], ['viewer', 'Гость: только смотрит'], ['owner', 'Владелец: всё, включая приглашения']];
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
async function drop(i) { await api('DELETE', `/api/invites/${i.id}`); load(); }
async function setRole(u, r) { await api('PATCH', `/api/users/${u.id}`, { role: r }); load(); }
async function toggle(u) {
  if (!u.disabled && !confirm(`Закрыть доступ для «${u.name}»? Все его входы будут отключены.`)) return;
  await api('PATCH', `/api/users/${u.id}`, { disabled: !u.disabled });
  load();
}
const when = (t) => (t ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : 'не входил(а)');
</script>

<template>
  <div class="page">
    <h1>Родственники</h1>
    <div class="card">
      <b>Пригласить</b>
      <label class="field"><span>Кого (для себя, например «Бабушка Валя»)</span><input v-model="label" /></label>
      <label class="field"><span>Права</span>
        <select v-model="role"><option v-for="[k, t] in ROLES" :key="k" :value="k">{{ t }}</option></select>
      </label>
      <button class="primary block" @click="create">Создать ссылку</button>
    </div>

    <div v-if="link" class="card" style="margin-top:12px">
      <b>Ссылка{{ link.label ? ' для ' + link.label : '' }}</b>
      <p class="small" style="word-break:break-all">{{ link.url }}</p>
      <p class="muted small">Откроется один раз, на одном телефоне. Отправьте её в мессенджер.</p>
      <button class="primary block" @click="share(link)">Отправить</button>
    </div>

    <h2>Участники</h2>
    <div class="list">
      <div v-for="u in users" :key="u.id" class="user">
        <div class="grow">
          <div class="ellipsis"><b>{{ u.name }}</b><span v-if="u.disabled" class="muted"> · доступ закрыт</span></div>
          <div class="muted small">последний вход: {{ when(u.last_seen_at) }}</div>
          <div class="row wrap" style="margin-top:6px" v-if="u.id !== store.me.id">
            <select :value="u.role" @change="setRole(u, $event.target.value)" style="width:auto;min-height:38px;padding:6px 10px">
              <option value="owner">владелец</option><option value="editor">участник</option><option value="viewer">гость</option>
            </select>
            <button class="chip" @click="loginLink(u)">Вход на новом телефоне</button>
            <button class="chip" @click="toggle(u)">{{ u.disabled ? 'Вернуть доступ' : 'Закрыть доступ' }}</button>
          </div>
        </div>
      </div>
    </div>

    <h2 v-if="invites.length">Неиспользованные ссылки</h2>
    <div class="list" v-if="invites.length">
      <div v-for="i in invites" :key="i.id">
        <div class="grow">{{ i.label || 'без подписи' }} <span class="muted small">· до {{ when(i.expires_at) }}</span></div>
        <button class="danger" @click="drop(i)">Отозвать</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.user { align-items: flex-start !important; }
</style>
