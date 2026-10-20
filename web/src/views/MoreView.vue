<script setup>
import { onMounted, ref } from 'vue';
import { store, isOwner, loadTree, toast } from '../store.js';
import { api } from '../api.js';
import { fullName } from '@shared/names.js';

const ROLE = { owner: 'владелец', editor: 'участник', viewer: 'гость (только просмотр)' };
const title = ref(store.title);
const installEvent = ref(null);
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

onMounted(() => {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent.value = e; });
});

async function saveTitle() {
  await api('PUT', '/api/settings/title', { title: title.value });
  await loadTree();
  toast('Название сохранено');
}
async function rename() {
  const name = prompt('Как вас подписывать в истории правок?', store.me.name);
  if (!name) return;
  await api('PATCH', '/api/me', { name });
  await loadTree();
}
async function logout() {
  if (!confirm('Выйти на этом устройстве? Войти снова можно будет только по новой ссылке.')) return;
  await api('POST', '/api/logout');
  location.reload();
}
</script>

<template>
  <div class="page">
    <h1>Ещё</h1>
    <div class="card">
      <div><b>{{ store.me.name }}</b> <a href="#" class="small" @click.prevent="rename">изменить</a></div>
      <div class="muted small">{{ ROLE[store.me.role] }}<template v-if="store.me.person_id && store.idx?.persons.get(store.me.person_id)"> · в дереве: {{ fullName(store.idx.persons.get(store.me.person_id)) }}</template></div>
    </div>

    <div v-if="!standalone" class="card" style="margin-top:12px">
      <b>Установить на телефон</b>
      <p class="small muted" v-if="isIos">В Safari нажмите «Поделиться» (квадрат со стрелкой), затем «На экран „Домой“».</p>
      <p class="small muted" v-else-if="!installEvent">В меню браузера выберите «Установить приложение» или «Добавить на главный экран».</p>
      <button v-else class="primary" @click="installEvent.prompt()">Установить</button>
    </div>

    <h2>Дерево</h2>
    <div class="list">
      <router-link to="/print">Печать и PDF</router-link>
      <router-link to="/changes">Последние правки</router-link>
      <a href="/api/export.ged" download>Скачать всё дерево (GEDCOM)</a>
      <router-link v-if="isOwner()" to="/family">Родственники и приглашения</router-link>
    </div>

    <template v-if="isOwner()">
      <h2>Название дерева</h2>
      <div class="row"><input v-model="title" class="grow" /><button @click="saveTitle">Сохранить</button></div>
    </template>

    <h2>О датах</h2>
    <div class="card small">
      Даты можно писать как удобно: <b>12.03.1890</b>, <b>1890</b>, <b>около 1890</b>, <b>до 1917</b>, <b>между 1880 и 1885</b>. Для старых записей можно добавить «ст. ст.».
    </div>

    <div style="margin-top:24px"><button class="danger block" @click="logout">Выйти на этом устройстве</button></div>
  </div>
</template>
