<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store, loadMe, loadTree, canEdit, switchTenant } from './store.js';
import AddPersonSheet from './components/AddPersonSheet.vue';
import AskDialog from './components/AskDialog.vue';
import AskSheet from './components/AskSheet.vue';
import { askSheet } from './asks.js';
import PasswordView from './views/PasswordView.vue';
import Icon from './components/Icon.vue';
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

// Уведомление из другой семьи этого телефона открывает приложение с ?t=<номер семьи>: сначала — в ту семью,
// а до тех пор ничего из прежней не показываем.
const wanted = (t) => t && t !== store.tenant?.id && store.tenants.some((x) => x.id === t && !x.closed);
const switching = ref(new URLSearchParams(location.search).has('t'));
loadMe().then(() => {
  const t = new URLSearchParams(location.search).get('t');
  if (t) history.replaceState(null, '', `/${location.hash}`);
  if (wanted(t)) return switchTenant(t, location.hash);
  switching.value = false;
  if (!store.me) return;
  loadTree();
  syncPush();
});
// Нажали на уведомление, а приложение уже открыто: service worker просит перейти в нужное место.
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type !== 'drevo-open') return;
  const url = new URL(e.data.url);
  if (wanted(url.searchParams.get('t'))) switchTenant(url.searchParams.get('t'), url.hash);
  else router.push(url.hash.slice(1) || '/');
});
// Другие семьи этого телефона — на экране, когда в выбранную войти нельзя.
const others = computed(() => store.tenants.filter((t) => !t.current && !t.closed));
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
  <template v-else-if="!store.ready || switching"><div class="page muted">Загрузка…</div></template>
  <PasswordView v-else-if="!store.me && store.pending" mode="enter" />
  <PasswordView v-else-if="askPassword" mode="create" later @later="putOff" />
  <template v-else-if="!store.me">
    <!-- Ещё не вошли: что это за приложение и как войти. -->
    <div class="page welcome">
      <img src="/icon.svg" class="logo" alt="" />
      <h1>Древо</h1>
      <p class="lead">Закрытое семейное дерево. Вся семья вместе записывает родных, фотографии и воспоминания — чтобы память о семье не потерялась.</p>
      <div class="card" v-if="store.offline">Нет связи с сервером. Если вы уже входили, откройте приложение, когда появится интернет.</div>
      <div class="card" v-else-if="store.tenant?.closed">
        <p>Вход в дерево «{{ store.tenant.title }}» сейчас закрыт.</p>
        <p class="muted small">Его закрыл тот, кто держит сервер. Узнайте у владельца дерева, что случилось. Само дерево никуда не делось.</p>
      </div>
      <template v-else>
        <ul class="points">
          <li><span class="ico"><Icon name="tree" /></span><span><b>Дерево всей семьи</b> — от прадедов до внуков, с братьями, сёстрами и двоюродными.</span></li>
          <li><span class="ico"><Icon name="mic" /></span><span><b>Фото, документы и голоса родных</b> — в одном месте, на телефоне у каждого.</span></li>
          <li><span class="ico"><Icon name="print" /></span><span><b>На память</b> — плакат с деревом, родословная роспись и семейный архив.</span></li>
        </ul>
        <div class="card">
          <b>Как войти</b>
          <p>Войти можно только по личной ссылке-приглашению. Попросите её у того, кто ведёт ваше семейное дерево, и откройте на этом телефоне.</p>
          <p class="muted small">Ссылка срабатывает один раз. Если её уже открыли на другом телефоне, попросите новую. Дерево видят только приглашённые.</p>
        </div>
      </template>
      <template v-if="others.length">
        <h2>Другие ваши семьи</h2>
        <div class="list">
          <a v-for="t in others" :key="t.id" href="#" @click.prevent="switchTenant(t.id)">«{{ t.title }}»</a>
        </div>
      </template>
    </div>
  </template>
  <template v-else>
    <router-view v-slot="{ Component }">
      <keep-alive include="TreeView"><component :is="Component" /></keep-alive>
    </router-view>
    <!-- Нижняя панель: «Главная» (все разделы, что нового), дерево, добавить, люди, профиль. -->
    <nav class="nav">
      <router-link to="/">
        <span class="icon"><Icon name="home" /><i v-if="store.tree?.feed_new || store.tree?.asks_waiting" class="dot" aria-label="Есть новое"></i></span>
        Главная
      </router-link>
      <router-link to="/tree">
        <span class="icon"><Icon name="tree" /></span>
        Дерево
      </router-link>
      <a class="plus" href="#" v-if="canEdit()" @click.prevent="plus" aria-label="Добавить человека"><span class="icon" aria-hidden="true">+</span>Добавить</a>
      <router-link to="/people">
        <span class="icon"><Icon name="people" /></span>
        Люди
      </router-link>
      <router-link to="/profile">
        <span class="icon"><Icon name="user" /></span>
        Профиль
      </router-link>
    </nav>
    <AddPersonSheet v-if="addState.open" @done="added" />
    <AskSheet v-if="askSheet.open" />
  </template>
  <div class="toast" v-if="store.toast">{{ store.toast }}</div>
  <AskDialog />
</template>

<style scoped>
.welcome { text-align: left; }
.logo { display: block; width: 4.444rem; height: 4.444rem; margin: 0.667rem 0 0.444rem; border-radius: 1.111rem; }
.lead { font-size: 1.111rem; margin: 0 0 1rem; }
.points { list-style: none; margin: 0 0 1rem; padding: 0; display: grid; gap: 0.778rem; }
.points li { display: flex; gap: 0.778rem; align-items: flex-start; }
.points .ico { flex: none; display: grid; place-items: center; width: 2.444rem; height: 2.444rem; border-radius: 0.778rem; background: var(--accent-soft); color: var(--accent-soft-text); }
.points svg { width: 1.444rem; height: 1.444rem; }
.welcome .card p { margin: 0.333rem 0 0; }
</style>
