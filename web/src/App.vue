<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store, loadMe, loadTree, canEdit } from './store.js';
import AddPersonSheet from './components/AddPersonSheet.vue';
import AskDialog from './components/AskDialog.vue';
import AskSheet from './components/AskSheet.vue';
import { askSheet } from './asks.js';
import PasswordView from './views/PasswordView.vue';
import { addState, openAdd } from './components/addState.js';
import { syncPush } from './push.js';

const route = useRoute();
const router = useRouter();
const isPublic = computed(() => route.meta.public);
// Участник без пароля: экран «Придумайте пароль» при каждом открытии, пока не придумает; можно отложить до следующего.
const LATER = 'drevo-password-later';
const later = ref((() => { try { return sessionStorage.getItem(LATER) === '1'; } catch { return false; } })());
function putOff() {
  later.value = true;
  try { sessionStorage.setItem(LATER, '1'); } catch { /* без хранилища — до перезагрузки */ }
}
const askPassword = computed(() => store.me?.needs_password && !later.value && route.path !== '/password');

loadMe().then(() => {
  if (!store.me) return;
  loadTree();
  syncPush();
});
// Нажали на уведомление, а приложение уже открыто: service worker просит перейти в нужное место.
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'drevo-open') router.push(new URL(e.data.url).hash.slice(1) || '/');
});
watch(() => store.me?.id, (id, old) => { if (id && id !== old && !store.tree) loadTree(); });

function plus() {
  const to = route.params.id || store.selectedId || store.me?.person_id;
  openAdd(to ? { to, type: null } : null);
}
function added(id) {
  if (id) router.push(`/person/${id}`);
}
</script>

<template>
  <template v-if="isPublic"><router-view /></template>
  <template v-else-if="!store.ready"><div class="page muted">Загрузка…</div></template>
  <PasswordView v-else-if="!store.me && store.pending" mode="enter" />
  <PasswordView v-else-if="askPassword" mode="create" later @later="putOff" />
  <template v-else-if="!store.me">
    <div class="page">
      <h1>Древо</h1>
      <div class="card" v-if="store.offline">Нет связи с сервером. Если вы уже входили, откройте приложение, когда появится интернет.</div>
      <div class="card" v-else>
        <p>Это закрытое семейное дерево. Войти можно только по ссылке-приглашению.</p>
        <p class="muted small">Попросите ссылку у того, кто ведёт дерево. Если ссылка уже открыта на другом телефоне, попросите новую: она срабатывает один раз.</p>
      </div>
    </div>
  </template>
  <template v-else>
    <router-view v-slot="{ Component }">
      <keep-alive include="TreeView"><component :is="Component" /></keep-alive>
    </router-view>
    <nav class="nav">
      <router-link to="/">
        <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="12" cy="5" r="2.5"/><circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M12 7.5V12M6 14.5V12h12v2.5"/></svg></span>
        Дерево
      </router-link>
      <router-link to="/people">
        <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.8a3.4 3.4 0 0 1 0 6.4M18.5 14.8c1.6.8 2.6 2.5 3 5.2"/></svg></span>
        Люди
      </router-link>
      <a class="plus" href="#" v-if="canEdit()" @click.prevent="plus" aria-label="Добавить человека"><span class="icon" aria-hidden="true">+</span>Добавить</a>
      <router-link to="/feed">
        <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M8 8.5h8M8 12.5h8M8 16.5h5"/></svg><i v-if="store.tree?.feed_new" class="dot" aria-label="Есть новое"></i></span>
        Лента
      </router-link>
      <router-link to="/more">
        <span class="icon"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></span>
        Ещё
      </router-link>
    </nav>
    <AddPersonSheet v-if="addState.open" @done="added" />
    <AskSheet v-if="askSheet.open" />
  </template>
  <div class="toast" v-if="store.toast">{{ store.toast }}</div>
  <AskDialog />
</template>
