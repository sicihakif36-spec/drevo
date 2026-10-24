<script setup>
// «Мои устройства и пароль»: где я вошёл, выйти на одном или на всех, кроме этого; придумать или сменить пароль.
import { computed, onMounted, ref } from 'vue';
import { store, toast, forget } from '../store.js';
import { api } from '../api.js';
import { ask } from '../components/ask.js';
import { disablePush } from '../push.js';
import { whenText } from '../when.js';

const list = ref(null);
const error = ref('');
const others = computed(() => (list.value || []).filter((s) => !s.current));
// Пароль — у тех, кто правит дерево.
const withPassword = computed(() => ['owner', 'editor'].includes(store.me?.role));

async function load() {
  try {
    list.value = await api('GET', '/api/me/sessions');
  } catch (e) {
    error.value = e.message;
  }
}
onMounted(load);

async function out(s) {
  if (s.current) {
    if (!await ask({ text: 'Выйти на этом телефоне?', note: 'Войти снова можно будет только по новой ссылке от того, кто ведёт дерево.', yes: 'Выйти', no: 'Не выходить', danger: true })) return;
    await disablePush().catch(() => {});
    await api('DELETE', `/api/me/sessions/${s.id}`);
    forget();
    location.replace('/');
    return;
  }
  if (!await ask({ text: `Выйти на устройстве «${s.device}»?`, note: 'На нём придётся входить заново по новой ссылке.', yes: 'Выйти на нём', no: 'Не выходить', danger: true })) return;
  await api('DELETE', `/api/me/sessions/${s.id}`);
  toast('Готово: на том устройстве вход закрыт');
  load();
}

async function outOthers() {
  if (!await ask({ text: 'Выйти на всех, кроме этого?', note: `Устройств: ${others.value.length}. На них придётся входить заново по новой ссылке.`, yes: 'Выйти на всех', no: 'Не выходить', danger: true })) return;
  await api('POST', '/api/me/sessions/others');
  toast('Готово: остался только этот телефон');
  load();
}
</script>

<template>
  <div class="page">
    <h1>Мои устройства</h1>
    <p class="muted small">Здесь видно, на каких телефонах и компьютерах вы вошли в «Древо». Если какое-то устройство потеряно или вы его не узнаёте — выйдите на нём.</p>
    <p class="error" v-if="error">{{ error }}</p>
    <p v-else-if="!list" class="muted">Загрузка…</p>
    <div v-else class="list">
      <div v-for="s in list" :key="s.id" class="device">
        <div class="grow">
          <div><b>{{ s.device }}</b><span v-if="s.current" class="mark">это устройство</span></div>
          <div class="muted small">вошли {{ whenText(s.created_at) }}<template v-if="!s.current"> · были {{ whenText(s.last_seen_at) }}</template></div>
          <div v-if="s.pending" class="small warn">вход ждёт пароль — если это не вы, выйдите на нём</div>
        </div>
        <button :class="{ danger: !s.current }" @click="out(s)">Выйти</button>
      </div>
    </div>
    <button v-if="others.length" class="danger block" style="margin-top:0.667rem" @click="outOthers">Выйти на всех, кроме этого</button>

    <template v-if="withPassword">
      <h2>Пароль</h2>
      <div class="card">
        <template v-if="store.me.has_password">
          <p class="small" style="margin-top:0">Пароль нужен, когда вы входите с нового телефона. Сменить его — значит выйти на всех других устройствах.</p>
          <router-link class="btn block" to="/password">Сменить пароль</router-link>
        </template>
        <template v-else>
          <p class="small" style="margin-top:0"><b>Пароля пока нет.</b> Без него дерево можно смотреть, но не править.</p>
          <router-link class="btn primary block" to="/password">Придумать пароль</router-link>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.device { align-items: center; }
.mark { display: inline-block; margin-left: 0.444rem; padding: 0 0.444rem; border-radius: 999px; background: var(--accent-soft); color: var(--accent-soft-text); font-size: 0.778rem; font-weight: 700; }
.warn { color: var(--danger); font-weight: 700; }
</style>
