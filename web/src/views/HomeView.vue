<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store, loadTree, canEdit, canTalk, isOwner, isAdmin, toast } from '../store.js';
import { api, photoUrl } from '../api.js';
import { fullName, lifespan, personHas } from '@shared/names.js';
import { lastText } from '@shared/archive.js';
import { findings } from '../checks.js';
import { when as day } from '../asks.js';
import { useFeed } from '../feed.js';
import { openAdd } from '../components/addState.js';
import FeedItem from '../components/FeedItem.vue';
import Finding from '../components/Finding.vue';
import Icon from '../components/Icon.vue';

// «Главная» — с неё открывается приложение: что требует вашего участия, ближайшие даты, коротко «Что нового»
// и все разделы плитками по смыслу. Каждому — только то, что ему можно.
const router = useRouter();
const { feed, asked, archive, left, loaded, dates, hints, later, leftName, dropLeft } = useFeed();

const persons = computed(() => (store.idx ? [...store.idx.persons.values()] : []));
const firstName = computed(() => String(store.me?.name || '').trim().split(/\s+/)[0]);
const others = computed(() => store.tenants.filter((t) => !t.current && !t.closed));

// Найти человека — сразу с главной.
const query = ref('');
const found = computed(() => {
  const s = query.value.trim();
  return s ? persons.value.filter((p) => personHas(p, s)).slice(0, 6) : [];
});

// «Найдите себя»: пока вошедший не отметил себя в дереве, родство не считается. Плашку можно убрать — как на дереве.
const findHidden = ref((() => { try { return localStorage.getItem('drevo.findme') === 'hide'; } catch { return false; } })());
const meInTree = computed(() => Boolean(store.me?.person_id && store.idx?.persons.has(store.me.person_id)));
const showFind = computed(() => persons.value.length > 0 && !meInTree.value && !findHidden.value);
const findQuery = ref('');
const findResults = computed(() => {
  const s = findQuery.value.trim();
  return s ? persons.value.filter((p) => personHas(p, s)).slice(0, 5) : [];
});
function hideFind() {
  findHidden.value = true;
  try { localStorage.setItem('drevo.findme', 'hide'); } catch {}
}
async function itsMe(p) {
  await api('PATCH', '/api/me', { person_id: p.id });
  await loadTree();
  toast('Теперь дерево открывается с вас, а родство считается от вас');
}

const showDates = ref(3);
const PLURAL = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many}`;
const people = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'человека' : 'человек'}`;

// Разделы — по смыслу. Пустые группы не показываются.
const groups = computed(() => [
  { title: 'Семья', tiles: [
    { to: '/tree', icon: 'tree', title: 'Дерево', hint: 'все родные на одном экране' },
    { to: '/people', icon: 'people', title: 'Люди', hint: persons.value.length ? `в дереве ${PLURAL(persons.value.length, 'человек', 'человека', 'человек')}` : 'список и поиск' },
    { to: '/places', icon: 'place', title: 'Места', hint: 'где родились, жили, похоронены' },
    { to: '/feed', icon: 'news', title: 'Что нового', hint: 'все правки и сообщения' },
  ] },
  { title: 'Воспоминания', tiles: [
    canTalk() && { to: '/interviews', icon: 'mic', title: 'Интервью', hint: 'воспоминания старших голосом' },
    canEdit() ? { to: '/asks', icon: 'ask', title: 'Вопросы родным', hint: 'спросить, ответы — в дерево', count: store.tree?.asks_waiting }
      : canTalk() && store.tree?.asks_waiting && { to: '/asks', icon: 'ask', title: 'Вас спросили', hint: 'ответьте родным', count: store.tree.asks_waiting },
    canEdit() && { to: '/surveys', icon: 'form', title: 'Анкеты', hint: 'родные заполняют без входа' },
  ] },
  { title: 'Уточнить дерево', tiles: [
    canEdit() && { to: '/checks', icon: 'check', title: 'Проверка дерева', hint: findings.value.length ? `вопросов к данным: ${findings.value.length}` : 'ошибки в датах, двойники', count: findings.value.length },
    canEdit() && { to: '/research', icon: 'search', title: 'Исследование', hint: 'поиск предков в архивах' },
    canEdit() && { to: '/names', icon: 'pen', title: 'Написание имён', hint: 'татарское и русское' },
    canTalk() && { to: '/changes', icon: 'history', title: 'Последние правки', hint: 'кто что изменил, отменить' },
  ] },
  { title: 'Печать и копии', tiles: [
    { to: '/print', icon: 'print', title: 'Печать', hint: 'плакат, веер предков, роспись' },
    isOwner() && { to: '/archive', icon: 'archive', title: 'Скачать всё', hint: 'семейный архив на память' },
    { href: '/api/export.ged', icon: 'download', title: 'Файл GEDCOM', hint: 'дерево для другой программы' },
    canEdit() && { to: '/import', icon: 'upload', title: 'Загрузить из файла', hint: 'из другой программы' },
  ] },
  { title: 'Управление', tiles: [
    isOwner() && { to: '/family', icon: 'invite', title: 'Родственники', hint: 'приглашения, права, входы' },
    isAdmin() && { to: '/tenants', icon: 'server', title: 'Семьи на сервере', hint: 'дерево другой семье' },
  ] },
  { title: 'Помощь', tiles: [
    { to: '/help', icon: 'help', title: 'Как пользоваться', hint: 'для чего Древо и что где' },
  ] },
].map((g) => ({ ...g, tiles: g.tiles.filter(Boolean) })).filter((g) => g.tiles.length));
</script>

<template>
  <div class="page home">
    <h1>{{ store.title }}</h1>
    <p class="hello">Здравствуйте{{ firstName ? `, ${firstName}` : '' }}!
      <router-link v-if="others.length" to="/profile" class="small">Другие ваши семьи ›</router-link></p>

    <label class="search">
      <Icon name="search" />
      <input v-model="query" type="search" placeholder="Найти человека" aria-label="Найти человека" autocomplete="off" />
    </label>
    <div v-if="query.trim()" class="list found">
      <router-link v-for="p in found" :key="p.id" :to="`/person/${p.id}`">
        <img v-if="p.photo_id" :src="photoUrl(p.photo_id)" class="avatar" alt="" />
        <div v-else class="avatar" :class="p.sex">{{ (p.given || p.surname || '?')[0] }}</div>
        <span class="grow">{{ fullName(p) }}<br /><span class="muted small">{{ lifespan(p) }}</span></span>
      </router-link>
      <div v-if="!found.length" class="muted">Никого не нашлось</div>
    </div>

    <!-- Что требует участия: только когда есть. -->
    <div v-if="store.me?.needs_password" class="card warn">
      <b>Придумайте пароль, чтобы править дерево.</b>
      <p class="small">Он нужен, только когда вы входите с нового телефона. Пока пароля нет, дерево можно только смотреть.</p>
      <router-link class="btn primary block" to="/password">Придумать пароль</router-link>
    </div>

    <div v-if="store.tree && !persons.length" class="card">
      <b>Дерево пока пустое.</b>
      <template v-if="canEdit()">
        <p class="small">Начните с себя, потом добавьте родителей, бабушек и дедушек.</p>
        <button class="primary block" @click="openAdd(null)">Добавить себя</button>
      </template>
      <p v-else class="small">Скоро здесь появятся родные.</p>
    </div>

    <div v-if="showFind" class="card find">
      <div class="row"><b class="grow">Найдите себя в дереве</b><button class="ghost x" aria-label="Убрать подсказку" @click="hideFind">✕</button></div>
      <p class="small">Тогда дерево будет открываться с вас, а родство считаться от вас: «ваша бабушка», «ваш двоюродный брат».</p>
      <input v-model="findQuery" type="search" placeholder="Ваше имя или фамилия" aria-label="Ваше имя или фамилия" />
      <div v-if="findResults.length" class="list" style="margin-top:0.444rem">
        <div v-for="p in findResults" :key="p.id">
          <span class="grow">{{ fullName(p) }} <span class="muted small">{{ lifespan(p) }}</span></span>
          <button class="primary" @click="itsMe(p)">Это я</button>
        </div>
      </div>
    </div>

    <div v-if="archive" class="banner keep">
      <div><b>Пора сохранить семейный архив.</b>
        {{ archive.last ? `В последний раз его скачивали ${lastText(archive.last)}.` : 'Вы его ещё не скачивали.' }}
        Скачайте и сохраните у себя — на случай, если с сервером что-то случится.</div>
      <div class="row">
        <router-link class="btn primary grow" to="/archive">Скачать всё</router-link>
        <button class="ghost" @click="later">Напомнить позже</button>
      </div>
    </div>

    <div v-for="x in left" :key="x.id" class="banner keep">
      <div>У вас есть незаконченное интервью — <b>{{ leftName(x) }}</b>, {{ x.answered }} из {{ x.total }} ответов.</div>
      <div class="row">
        <router-link class="btn primary grow" :to="`/interview/${x.id}`">Продолжить</router-link>
        <button class="ghost danger" @click="dropLeft(x)">Удалить</button>
      </div>
    </div>

    <template v-if="asked.length">
      <h2>Вас спросили</h2>
      <div class="list asked">
        <router-link v-for="a in asked" :key="a.id" :to="`/asks/${a.id}`">
          <div class="grow">
            <div class="small muted">{{ a.from_name || 'Кто-то' }} · {{ day(a.created_at) }} · о ком: {{ a.about }}</div>
            <div class="q">{{ a.question }}</div>
            <span class="btn primary go">Ответить</span>
          </div>
        </router-link>
      </div>
    </template>

    <template v-if="dates.length">
      <h2>Ближайшие даты</h2>
      <div class="list">
        <router-link v-for="d in dates.slice(0, showDates)" :key="d.person.id + d.kind" :to="`/person/${d.person.id}`" :class="{ round: d.round }">
          <div class="grow">
            <div class="small date" :class="{ today: d.inDays === 0 }">{{ d.when }}</div>
            <div class="name">{{ fullName(d.person) }}</div>
            <div class="small" :class="d.round ? 'accent' : 'muted'">{{ d.text }}<template v-if="d.round"> · круглая дата</template></div>
          </div>
          <span class="muted" aria-hidden="true">›</span>
        </router-link>
        <button v-if="dates.length > showDates" class="more" @click="showDates = dates.length">Ещё {{ PLURAL(dates.length - showDates, 'дата', 'даты', 'дат') }}</button>
      </div>
    </template>

    <template v-if="loaded && feed.length">
      <h2>Что нового</h2>
      <div class="list">
        <FeedItem v-for="it in feed.slice(0, 3)" :key="it.kind + it.id" :it="it" />
        <router-link to="/feed" class="all"><span class="grow">Вся лента</span><span aria-hidden="true">›</span></router-link>
      </div>
    </template>

    <template v-for="g in groups" :key="g.title">
      <h2>{{ g.title }}</h2>
      <div class="tiles">
        <component :is="t.href ? 'a' : 'router-link'" v-for="t in g.tiles" :key="t.title" class="tile"
          v-bind="t.href ? { href: t.href, download: '' } : { to: t.to }">
          <span class="ico"><Icon :name="t.icon" /><i v-if="t.count" class="count">{{ t.count }}</i></span>
          <span class="txt"><b>{{ t.title }}</b><span class="muted small">{{ t.hint }}</span></span>
        </component>
      </div>
    </template>

    <template v-if="canEdit() && findings.length">
      <h2>Помогите уточнить</h2>
      <div class="list">
        <Finding v-for="x in findings.slice(0, 2)" :key="x.key" :finding="x" />
        <router-link v-if="findings.length > 2" to="/checks" class="all"><span class="grow">Все вопросы к данным ({{ findings.length }})</span><span aria-hidden="true">›</span></router-link>
      </div>
    </template>

    <template v-if="hints.length">
      <h2>Что можно дополнить</h2>
      <div class="list">
        <router-link v-for="h in hints" :key="h.f" :to="`/people?f=${h.f}`">
          <div class="grow">{{ h.label }} у {{ people(h.n) }}</div>
          <span class="muted" aria-hidden="true">›</span>
        </router-link>
      </div>
    </template>
  </div>
</template>

<style scoped>
.home h1 { margin-bottom: 0.222rem; overflow-wrap: anywhere; }
.hello { margin: 0 0 0.889rem; font-size: 1.111rem; }
.hello a { margin-left: 0.444rem; white-space: nowrap; }
.search { display: flex; align-items: center; gap: 0.556rem; padding: 0 0.889rem; background: var(--card); border: 2px solid var(--field); border-radius: var(--radius); }
.search:focus-within { border-color: var(--accent); }
.search svg { width: 1.333rem; height: 1.333rem; flex: none; color: var(--muted); }
.search input { border: 0; background: transparent; padding-left: 0; padding-right: 0; box-shadow: none; outline: none; }
.found { margin-top: 0.444rem; }
.card { margin-top: 0.889rem; }
.card p { margin: 0.333rem 0 0.667rem; }
.warn { background: var(--warn-bg); color: var(--warn-text); border-color: transparent; }
.find .x { min-height: 0; padding: 0.222rem 0.444rem; }
.banner.keep { display: grid; gap: 0.444rem; margin-top: 0.889rem; font-size: 1rem; }
.keep .btn { white-space: nowrap; }
.asked { border: 2px solid var(--accent); }
.asked .q { font-weight: 700; margin: 0.111rem 0 0.444rem; overflow-wrap: anywhere; }
.asked .go { width: 100%; min-height: 2.889rem; }
.date { color: var(--muted); }
.date.today { color: var(--accent-text); font-weight: 700; }
.name { overflow-wrap: anywhere; }
.round { background: var(--accent-soft); }
.round .muted, .round .date { color: var(--accent-soft-text); }
.accent { color: var(--accent-soft-text); font-weight: 700; }
.list > .more, .list > .all { color: var(--accent-text); font-weight: 700; }
.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.556rem; }
.tile { display: flex; flex-direction: column; gap: 0.222rem; min-height: 6.667rem; padding: 0.778rem; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); color: inherit; text-decoration: none; }
.tile:active { background: var(--accent-soft); }
.txt { display: flex; flex-direction: column; gap: 0.222rem; min-width: 0; }
.tile b { line-height: 1.25; overflow-wrap: anywhere; }
.tile .small { line-height: 1.3; }
/* Последняя плитка без пары — во всю ширину: значок слева, текст справа. */
.tile:last-child:nth-child(odd) { grid-column: 1 / -1; flex-direction: row; align-items: center; gap: 0.778rem; min-height: 0; }
.tile:last-child:nth-child(odd) .ico { flex: none; margin-bottom: 0; }
.ico { position: relative; display: grid; place-items: center; width: 2.444rem; height: 2.444rem; margin-bottom: 0.222rem; border-radius: 0.778rem; background: var(--accent-soft); color: var(--accent-soft-text); }
.ico svg { width: 1.444rem; height: 1.444rem; }
.count { position: absolute; top: -0.444rem; right: -0.667rem; min-width: 1.444rem; padding: 0 0.333rem; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-size: 0.778rem; font-style: normal; font-weight: 700; line-height: 1.444rem; text-align: center; }
</style>
