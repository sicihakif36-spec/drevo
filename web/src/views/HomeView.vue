<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store, loadTree, canEdit, toast } from '../store.js';
import { api, photoUrl } from '../api.js';
import { fullName, lifespan, personHas } from '@shared/names.js';
import { lastText } from '@shared/archive.js';
import { findings } from '../checks.js';
import { sections as groups, PLURAL } from '../sections.js';
import { wide } from '../wide.js';
import { when as day } from '../asks.js';
import { useFeed } from '../feed.js';
import { openAdd } from '../components/addState.js';
import FeedItem from '../components/FeedItem.vue';
import Finding from '../components/Finding.vue';
import Icon from '../components/Icon.vue';

// «Главная» — с неё открывается приложение: что требует вашего участия, ближайшие даты, коротко «Что нового»
// и все разделы плитками по смыслу (sections.js). Каждому — только то, что ему можно.
// На компьютере — две колонки: даты и новости слева, «Помогите уточнить» и «Что можно дополнить» справа.
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
const people = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'человека' : 'человек'}`;
// Дата значком-календарём: число и месяц коротко.
const allTiles = computed(() => groups.value.flatMap((g) => g.tiles));
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
</script>

<template>
  <div class="page home wide">
    <div class="head">
      <div class="grow">
        <h1>{{ store.title }}</h1>
        <p class="hello">Здравствуйте{{ firstName ? `, ${firstName}` : '' }}!
          <router-link v-if="others.length" to="/profile" class="small">Другие ваши семьи ›</router-link></p>
      </div>
      <router-link v-if="wide && persons.length" to="/tree" class="btn"><Icon name="tree" />Открыть дерево</router-link>
    </div>

    <!-- На компьютере поиск — в боковом меню. -->
    <template v-if="!wide">
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
    </template>

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
      <div class="grow"><b>Пора сохранить семейный архив.</b>
        {{ archive.last ? `В последний раз его скачивали ${lastText(archive.last)}.` : 'Вы его ещё не скачивали.' }}
        Скачайте и сохраните у себя — на случай, если с сервером что-то случится.</div>
      <div class="row">
        <router-link class="btn primary grow" to="/archive">Скачать всё</router-link>
        <button class="ghost" @click="later">Напомнить позже</button>
      </div>
    </div>

    <div v-for="x in left" :key="x.id" class="banner keep">
      <div class="grow">У вас есть незаконченное интервью — <b>{{ leftName(x) }}</b>, {{ x.answered }} из {{ x.total }} ответов.</div>
      <div class="row">
        <router-link class="btn primary grow" :to="`/interview/${x.id}`">Продолжить</router-link>
        <button class="ghost danger" @click="dropLeft(x)">Удалить</button>
      </div>
    </div>

    <!-- На телефоне — одной колонкой в порядке разметки; на компьютере: слева главное, справа уточнить, ниже разделы. -->
    <div class="dash" :class="{ solo: !(canEdit() && findings.length) && !hints.length }">
      <div class="col-main">
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
          <div class="list dates">
            <router-link v-for="d in dates.slice(0, showDates)" :key="d.person.id + d.kind" :to="`/person/${d.person.id}`"
              :class="{ round: d.round, today: d.inDays === 0 }">
              <span class="cal" :aria-label="d.when"><b>{{ d.day }}</b><span>{{ MON[d.month - 1] }}</span></span>
              <div class="grow">
                <div class="name">{{ fullName(d.person) }}</div>
                <div class="small" :class="d.inDays === 0 || d.round ? 'accent' : 'muted'">
                  <template v-if="d.inDays < 2">{{ d.when }} · </template>{{ d.text }}<template v-if="d.round"> · круглая дата</template>
                </div>
              </div>
              <span class="muted" aria-hidden="true">›</span>
            </router-link>
            <button v-if="dates.length > showDates" class="more" @click="showDates = dates.length">Ещё {{ PLURAL(dates.length - showDates, 'дата', 'даты', 'дат') }}</button>
          </div>
        </template>

        <template v-if="loaded && feed.length">
          <h2>Что нового</h2>
          <div class="list">
            <FeedItem v-for="it in feed.slice(0, wide ? 4 : 3)" :key="it.kind + it.id" :it="it" />
            <router-link to="/feed" class="all"><span class="grow">Вся лента</span><span aria-hidden="true">›</span></router-link>
          </div>
        </template>
      </div>

      <section class="col-all">
        <!-- На компьютере разделы и так слева в меню: здесь — одной сеткой с пояснениями. -->
        <template v-if="wide">
          <h2>Все разделы</h2>
          <div class="tiles">
            <component :is="t.href ? 'a' : 'router-link'" v-for="t in allTiles" :key="t.title" class="tile"
              v-bind="t.href ? { href: t.href, download: '' } : { to: t.to }">
              <span class="ico"><Icon :name="t.icon" /><i v-if="t.count" class="count">{{ t.count }}</i></span>
              <span class="txt"><b>{{ t.title }}</b><span class="muted small">{{ t.hint }}</span></span>
            </component>
          </div>
        </template>
        <template v-else v-for="g in groups" :key="g.title">
          <h2>{{ g.title }}</h2>
          <div class="tiles">
            <component :is="t.href ? 'a' : 'router-link'" v-for="t in g.tiles" :key="t.title" class="tile"
              v-bind="t.href ? { href: t.href, download: '' } : { to: t.to }">
              <span class="ico"><Icon :name="t.icon" /><i v-if="t.count" class="count">{{ t.count }}</i></span>
              <span class="txt"><b>{{ t.title }}</b><span class="muted small">{{ t.hint }}</span></span>
            </component>
          </div>
        </template>
      </section>

      <div class="col-side">
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
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: flex-end; gap: 1rem; flex-wrap: wrap; }
.home h1 { margin-bottom: 0.222rem; overflow-wrap: anywhere; }
.hello { margin: 0 0 0.889rem; font-size: 1.111rem; }
.hello a { margin-left: 0.444rem; white-space: nowrap; }
.head .btn { margin-bottom: 0.889rem; }
.head .btn svg { width: 1.333rem; height: 1.333rem; }
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
/* Даты: число и месяц значком-календарём, сегодня — заливкой, круглая дата — светло-зелёным. */
.dates > a { gap: 0.778rem; }
.cal { flex: none; width: 3.111rem; height: 3.111rem; border-radius: var(--radius-s); background: var(--bg); border: 1.5px solid var(--line); display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.05; }
.cal b { font-size: 1.222rem; }
.cal span { font-size: 0.778rem; color: var(--muted); }
.today .cal { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.today .cal span { color: var(--on-accent); }
.round .cal { background: var(--card); border-color: var(--accent); }
.round .cal span { color: var(--accent-soft-text); }
.name { overflow-wrap: anywhere; font-weight: 700; line-height: 1.3; }
.round { background: var(--accent-soft); }
.round .muted { color: var(--accent-soft-text); }
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
@media (hover: hover) { .tile:hover { background: var(--hover); border-color: var(--field); } }
/* Планшет: плитки по три. */
@media (min-width: 48em) {
  .tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .tile:last-child:nth-child(odd) { grid-column: auto; flex-direction: column; align-items: flex-start; min-height: 6.667rem; }
}
/* Компьютер: две колонки, разделы ниже — плитками со значком слева. */
@media (min-width: 64em) {
  .banner.keep { grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: 1.333rem; padding: 0.889rem 1.111rem; border-radius: var(--radius); }
  .col-all { order: 3; }
  .col-all .tiles { grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: 0.667rem; }
  .col-all .tile, .col-all .tile:last-child:nth-child(odd) { flex-direction: row; align-items: center; gap: 0.778rem; min-height: 4.667rem; }
  .col-all .ico { flex: none; margin-bottom: 0; }
  .list > a, .list > button, .list > div { padding-left: 1.111rem; padding-right: 1.111rem; }
  /* Между 1024 и 1280 — одной колонкой рядом с меню: даты и новости, «уточнить», потом разделы. */
  .dash { display: flex; flex-direction: column; }
}
/* Широкий экран: две колонки — места хватает и для имён, и для правой колонки. */
@media (min-width: 80em) {
  .dash { display: grid; grid-template-columns: minmax(0, 1fr) clamp(18rem, 30%, 22rem); grid-template-areas: "main side" "all all"; column-gap: 2rem; align-items: start; }
  .dash.solo { grid-template-columns: minmax(0, 1fr); grid-template-areas: "main" "all"; }
  .col-main { grid-area: main; min-width: 0; }
  .col-side { grid-area: side; min-width: 0; }
  .col-all { grid-area: all; }
}
</style>
