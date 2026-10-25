<script setup>
import { onMounted, ref } from 'vue';
import { store, isOwner, loadTree, toast, forget, switchTenant } from '../store.js';
import { api } from '../api.js';
import { sizeText } from '../size.js';
import { fullName } from '@shared/names.js';
import { disablePush } from '../push.js';
import { ask, askText } from '../components/ask.js';

// «Профиль» — только своё: имя, мои семьи, установка на телефон, уведомления, устройства и пароль, выход.
// У владельца — ещё название дерева и место на сервере. Разделы дерева — на «Главной» (HomeView).
const ROLE = { owner: 'владелец', editor: 'участник', relative: 'родственник: видит всё, не правит', viewer: 'гость (только просмотр)' };
const title = ref(store.title);
const installEvent = ref(null);
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

// Место на сервере для фото и записей — владельцу семьи, у которой есть предел.
const space = ref(null);
onMounted(async () => {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent.value = e; });
  if (isOwner() && !store.tenant?.main) space.value = await api('GET', '/api/tenants/space').catch(() => null);
});
// Несколько семей на этом телефоне: «Мои семьи».
const ROLE_SHORT = { owner: 'владелец', editor: 'участник', relative: 'родственник', viewer: 'гость' };
const others = () => store.tenants.filter((t) => !t.current);

async function saveTitle() {
  await api('PUT', '/api/settings/title', { title: title.value });
  await loadTree();
  toast('Название сохранено');
}
async function rename() {
  const name = (await askText({ text: 'Как вас зовут в семье?', note: 'Так вас подпишут в ленте и правках. Например: тётя Лена', value: store.me.name }))?.trim();
  if (!name) return;
  await api('PATCH', '/api/me', { name });
  await loadTree();
}

async function logout() {
  const more = others().length > 0;
  if (!await ask({
    text: more ? `Выйти из дерева «${store.title}» на этом телефоне?` : 'Выйти на этом телефоне?',
    note: `Войти снова можно будет только по новой ссылке-приглашению.${more ? ' Другие ваши семьи останутся.' : ''}`,
    yes: 'Выйти', no: 'Не выходить', danger: true,
  })) return;
  // Этот телефон больше не получает уведомлений и не хранит дерево. Если он есть и в других семьях,
  // уведомления от них остаются: о них сервер забывает вместе со входом.
  if (!more) await disablePush().catch(() => {});
  await api('POST', '/api/logout');
  forget();
  location.replace('/');
}
</script>

<template>
  <div class="page">
    <h1>Профиль</h1>
    <div class="card">
      <div><b>{{ store.me.name }}</b></div>
      <div class="muted small">{{ ROLE[store.me.role] }}<template v-if="store.me.person_id && store.idx?.persons.get(store.me.person_id)"> · в дереве: {{ fullName(store.idx.persons.get(store.me.person_id)) }}</template></div>
      <div class="muted small" v-if="store.tenants.length > 1">дерево «{{ store.title }}»</div>
      <button style="margin-top:0.667rem" @click="rename">Изменить имя</button>
    </div>
    <div v-if="store.me.needs_password" class="card nopass">
      <b>Придумайте пароль, чтобы править дерево.</b>
      <p class="small">Он нужен, только когда вы входите с нового телефона. Пока пароля нет, дерево можно только смотреть.</p>
      <router-link class="btn primary block" to="/password">Придумать пароль</router-link>
    </div>

    <template v-if="others().length">
      <h2 id="families">Мои семьи</h2>
      <p class="muted small hint">У каждой семьи своё дерево. Сейчас открыто «{{ store.title }}».</p>
      <div class="list">
        <a v-for="t in others()" :key="t.id" href="#" @click.prevent="!t.closed && switchTenant(t.id)">
          <span class="grow">«{{ t.title }}»<br /><span class="muted small">{{ t.closed ? 'вход закрыт' : t.pending ? 'ждёт пароль' : `вы — ${ROLE_SHORT[t.role]}` }}</span></span>
          <span v-if="!t.closed" class="go">Перейти</span>
        </a>
      </div>
    </template>

    <div v-if="!standalone" class="card" style="margin-top:12px">
      <b>Установить на телефон</b>
      <p class="small muted" v-if="isIos">В Safari нажмите «Поделиться» (квадрат со стрелкой), затем «На экран „Домой“».</p>
      <p class="small muted" v-else-if="!installEvent">В меню браузера выберите «Установить приложение» или «Добавить на главный экран».</p>
      <button v-else class="primary" @click="installEvent.prompt()">Установить</button>
    </div>

    <h2>Настройки</h2>
    <div class="list">
      <router-link to="/notify"><span class="grow">Уведомления<br /><span class="muted small">о чём сообщать на этот телефон</span></span></router-link>
      <router-link to="/devices"><span class="grow">Мои устройства{{ ['owner', 'editor'].includes(store.me.role) ? ' и пароль' : '' }}<br /><span class="muted small">где вы вошли, выйти на других устройствах</span></span></router-link>
      <router-link to="/help"><span class="grow">Как пользоваться Древом<br /><span class="muted small">для чего приложение и что где</span></span></router-link>
    </div>

    <template v-if="isOwner()">
      <h2>Название дерева</h2>
      <div class="row"><input v-model="title" class="grow" aria-label="Название дерева" /><button @click="saveTitle">Сохранить</button></div>
      <p v-if="space?.quota" class="small" :class="{ full: space.used >= space.quota * 0.9 }">
        Место на сервере для фото, документов и записей: занято {{ sizeText(space.used) }} из {{ sizeText(space.quota) }}.
        <template v-if="space.used >= space.quota">Новые файлы не загрузятся — попросите прибавить места того, кто дал ссылку на дерево.</template>
      </p>
    </template>

    <div style="margin-top:1.333rem"><button class="danger block" @click="logout">Выйти на этом устройстве</button></div>
  </div>
</template>

<style scoped>
.nopass { margin-top: 12px; background: var(--warn-bg); color: var(--warn-text); border-color: transparent; }
.nopass p { margin: 0.333rem 0 0.667rem; }
.hint { margin: 0 0 0.333rem; }
.go { flex: none; color: var(--accent-text); font-weight: 700; }
.full { color: var(--danger); font-weight: 700; }
</style>
