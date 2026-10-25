<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { store, isOwner, canTalk, canEdit, loadTree, toast, forget } from '../store.js';
import { api } from '../api.js';
import { fullName } from '@shared/names.js';
import { disablePush } from '../push.js';
import { ask, askText } from '../components/ask.js';
import { findings } from '../checks.js';
import { lastText, KEEP_HINT } from '@shared/archive.js';

const ROLE = { owner: 'владелец', editor: 'участник', relative: 'родственник: видит всё, не правит', viewer: 'гость (только просмотр)' };
const title = ref(store.title);
const installEvent = ref(null);
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

const route = useRoute();
onMounted(() => {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent.value = e; });
  // Из плашки в ленте и из уведомления: «Ещё → Скачать всё» сразу открыто.
  if (route.query.archive && isOwner()) openArchive();
});

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
// Полный архив: сначала — сколько весит, потом скачивание обычной ссылкой (браузер сам покажет ход).
const archive = ref(null);
// Пока идёт скачивание, раз в 5 секунд спрашиваем, не дошло ли оно до конца: тогда «в последний раз» обновится.
let watch = null;
const stopWatch = () => { clearInterval(watch); watch = null; };
onUnmounted(stopWatch);
function startDownload() {
  const a = archive.value;
  a.started = true;
  const was = a.last?.at;
  const until = Date.now() + 30 * 60000;
  stopWatch();
  watch = setInterval(async () => {
    if (!archive.value || Date.now() > until) return stopWatch();
    const { last } = await api('GET', '/api/archive/last').catch(() => ({}));
    if (last && last.at !== was && archive.value) {
      archive.value = { ...archive.value, last, done: true };
      stopWatch();
    }
  }, 5000);
}
function closeArchive() {
  archive.value = null;
  stopWatch();
}
async function openArchive() {
  archive.value = { loading: true };
  try {
    archive.value = await api('GET', '/api/archive');
  } catch (err) {
    archive.value = null;
    toast(err.message);
  }
}
const BIG = 200 * 1024 * 1024;
function sizeText(n) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} КБ`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toLocaleString('ru-RU', { maximumFractionDigits: n < 10 * 1024 ** 2 ? 1 : 0 })} МБ`;
  return `${(n / 1024 ** 3).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ГБ`;
}

async function logout() {
  if (!await ask({ text: 'Выйти на этом телефоне?', note: 'Войти снова можно будет только по новой ссылке-приглашению.', yes: 'Выйти', no: 'Не выходить', danger: true })) return;
  // Этот телефон больше не получает уведомлений и не хранит дерево.
  await disablePush().catch(() => {});
  await api('POST', '/api/logout');
  forget();
  location.replace('/');
}
</script>

<template>
  <div class="page">
    <h1>Ещё</h1>
    <div class="card">
      <div><b>{{ store.me.name }}</b></div>
      <div class="muted small">{{ ROLE[store.me.role] }}<template v-if="store.me.person_id && store.idx?.persons.get(store.me.person_id)"> · в дереве: {{ fullName(store.idx.persons.get(store.me.person_id)) }}</template></div>
      <button style="margin-top:0.667rem" @click="rename">Изменить имя</button>
    </div>
    <div v-if="store.me.needs_password" class="card nopass">
      <b>Придумайте пароль, чтобы править дерево.</b>
      <p class="small">Он нужен, только когда вы входите с нового телефона. Пока пароля нет, дерево можно только смотреть.</p>
      <router-link class="btn primary block" to="/password">Придумать пароль</router-link>
    </div>

    <div v-if="!standalone" class="card" style="margin-top:12px">
      <b>Установить на телефон</b>
      <p class="small muted" v-if="isIos">В Safari нажмите «Поделиться» (квадрат со стрелкой), затем «На экран „Домой“».</p>
      <p class="small muted" v-else-if="!installEvent">В меню браузера выберите «Установить приложение» или «Добавить на главный экран».</p>
      <button v-else class="primary" @click="installEvent.prompt()">Установить</button>
    </div>

    <div class="list" style="margin-top:12px">
      <router-link v-if="canTalk() && !canEdit() && store.tree?.asks_waiting" to="/asks"><span class="grow"><b>Вас спросили</b></span><span class="count">{{ store.tree.asks_waiting }}</span></router-link>
      <router-link to="/notify">Уведомления</router-link>
    </div>

    <h2>Дерево</h2>
    <div class="list">
      <router-link to="/print">Печать и PDF</router-link>
      <router-link to="/places">Места</router-link>
      <router-link v-if="canTalk()" to="/changes">Последние правки</router-link>
      <router-link v-if="canEdit()" to="/checks"><span class="grow">Проверка дерева<br /><span class="muted small">{{ findings.length ? `вопросов к данным: ${findings.length}` : 'ошибки в датах, дубли, люди без связей' }}</span></span></router-link>
      <router-link v-if="canEdit()" to="/names"><span class="grow">Написание имён<br /><span class="muted small">татарское и русское, как в документах</span></span></router-link>
      <router-link v-if="canEdit()" to="/research"><span>Исследование<br /><span class="muted small">поиск предков в архивах, запрос ИИ-помощнику</span></span></router-link>
      <router-link v-if="canEdit()" to="/asks"><span class="grow">Вопросы родным<br /><span class="muted small">кого о чём спросили, ответы — в дерево</span></span><span v-if="store.tree?.asks_waiting" class="count">{{ store.tree.asks_waiting }}</span></router-link>
      <router-link v-if="canTalk()" to="/interviews"><span class="grow">Интервью<br /><span class="muted small">воспоминания старших голосом, по вопросам</span></span></router-link>
      <router-link v-if="canEdit()" to="/surveys">Анкеты для родственников</router-link>
      <a v-if="isOwner()" href="#" @click.prevent="openArchive">Скачать всё: дерево, фото, документы</a>
      <a href="/api/export.ged" download><span>Скачать дерево для другой программы<br /><span class="muted small">файл GEDCOM</span></span></a>
      <router-link v-if="canEdit()" to="/import"><span>Загрузить дерево из файла<br /><span class="muted small">из другой программы, файл GEDCOM</span></span></router-link>
      <router-link v-if="isOwner()" to="/family">Родственники и приглашения</router-link>
    </div>

    <template v-if="isOwner()">
      <h2>Название дерева</h2>
      <div class="row"><input v-model="title" class="grow" /><button @click="saveTitle">Сохранить</button></div>
    </template>

    <h2>О датах</h2>
    <div class="card small">
      Даты можно писать как удобно: <b>12.03.1890</b>, <b>1890</b>, <b>около 1890</b>, <b>до 1917</b>, <b>между 1880 и 1885</b>.
      Даты до 14 февраля 1918 года в старых документах — по старому стилю: отметьте галочку «по старому стилю» под датой,
      и она покажется в обоих стилях: <b>12 (24) марта 1890</b>. Годовщины считаются по новому стилю.
    </div>

    <h2>Вход</h2>
    <div class="list">
      <router-link to="/devices"><span>Мои устройства{{ ['owner', 'editor'].includes(store.me.role) ? ' и пароль' : '' }}<br /><span class="muted small">где вы вошли, выйти на других устройствах</span></span></router-link>
    </div>
    <div style="margin-top:0.667rem"><button class="danger block" @click="logout">Выйти на этом устройстве</button></div>

    <template v-if="archive">
      <div class="sheet-backdrop" @click="closeArchive" />
      <div class="sheet" role="dialog" aria-modal="true">
        <h2 style="margin-top:0">Скачать всё</h2>
        <p class="small">Один архив со всем деревом: люди, фото, документы, истории, записи голоса, журнал поиска,
          вопросы родным и черновики интервью.
          Это копия на случай, если с сервером что-то случится, и способ перенести дерево в другую программу.</p>
        <p v-if="archive.loading" class="muted">Считаю, сколько весит архив…</p>
        <template v-else>
          <p>В архиве: {{ archive.summary }}.<br />Весит примерно <b>{{ sizeText(archive.bytes) }}</b>.</p>
          <p v-if="archive.missing" class="small muted">Не нашлось на сервере файлов: {{ archive.missing }}. Их в архиве не будет.</p>
          <p v-if="archive.bytes > BIG" class="small"><b>Архив большой.</b> Лучше скачивать с компьютера или по Wi-Fi,
            а на телефоне проверьте, хватит ли места.</p>
          <p class="small muted">После скачивания распакуйте архив и откройте файл index.html — дерево откроется в браузере без интернета.</p>
          <p class="last" :class="{ done: archive.done }">
            <template v-if="archive.done">Архив скачан. Теперь сохраните его у себя.</template>
            <template v-else-if="archive.last">В последний раз {{ archive.last.name && archive.last.name !== store.me.name ? `архив скачивал(а) ${archive.last.name}` : 'вы скачивали' }} {{ lastText(archive.last.at) }}.</template>
            <template v-else>Вы ещё ни разу не скачивали архив.</template>
          </p>
          <p class="small">{{ KEEP_HINT }}</p>
          <a class="btn primary" style="width:100%;box-sizing:border-box" href="/api/archive.zip" download @click="startDownload">Скачать архив</a>
          <p v-if="archive.started && !archive.done" class="small">Скачивание началось. Ход виден в браузере, в списке загрузок.</p>
        </template>
        <button class="ghost block" style="margin-top:8px" @click="closeArchive">Закрыть</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.nopass { margin-top: 12px; background: var(--warn-bg); color: var(--warn-text); border-color: transparent; }
.nopass p { margin: 0.333rem 0 0.667rem; }
.last { margin: 0.667rem 0 0.333rem; }
.last.done { color: var(--accent-text); font-weight: 700; }
.count { flex: none; min-width: 1.778rem; padding: 0 0.444rem; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-weight: 700; text-align: center; }
</style>
