<script setup>
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store, loadMe, loadTree } from './store.js';
import AddPersonSheet from './components/AddPersonSheet.vue';
import { addState, openAdd } from './components/addState.js';

const route = useRoute();
const router = useRouter();
const isPublic = computed(() => route.meta.public);

loadMe().then(() => { if (store.me) loadTree(); });
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="5" r="2.5"/><circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M12 7.5V12M6 14.5V12h12v2.5"/></svg>
        Дерево
      </router-link>
      <router-link to="/people">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.8a3.4 3.4 0 0 1 0 6.4M18.5 14.8c1.6.8 2.6 2.5 3 5.2"/></svg>
        Люди
      </router-link>
      <a class="plus" href="#" v-if="store.me.role !== 'viewer'" @click.prevent="plus" aria-label="Добавить человека"><span>+</span></a>
      <router-link to="/print">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2"/><path d="M6 14h12v7H6z"/></svg>
        Печать
      </router-link>
      <router-link to="/more">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
        Ещё
      </router-link>
    </nav>
    <AddPersonSheet v-if="addState.open" @done="added" />
  </template>
  <div class="toast" v-if="store.toast">{{ store.toast }}</div>
</template>
