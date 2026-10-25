<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { store, canEdit, canTalk, onLive, toast } from '../store.js';
import { api, thumbUrl } from '../api.js';
import { namer, opLines, moreText } from '../history.js';
import { fullName, missingFields, upcomingDates, yearsText } from '@shared/names.js';
import { lastText } from '@shared/archive.js';
import { findings } from '../checks.js';
import Finding from '../components/Finding.vue';
import { when as day } from '../asks.js';
import { ask } from '../components/ask.js';

const items = ref([]);
const asked = ref([]); // «Вас спросили»: вопросы мне без ответа
// Владельцу: «Пора сохранить семейный архив» — { last } или null.
const archive = ref(null);
async function later() {
  await api('POST', '/api/archive/later').then(() => { archive.value = null; toast('Напомним через неделю'); }, (e) => toast(e.message));
}
// Свои интервью, брошенные больше суток назад: сами не удаляются — спрашиваем.
const left = ref([]);
const DAY = 24 * 3600 * 1000;
async function loadLeft() {
  if (!canTalk()) return;
  const list = await api('GET', '/api/interviews').catch(() => []);
  left.value = list.filter((x) => !x.saved && x.created_by === store.me?.id && Date.now() - new Date(x.updated_at) > DAY);
}
loadLeft();
const leftName = (x) => {
  const p = store.idx?.persons.get(x.person_id);
  return p ? [p.given, p.patronymic].filter(Boolean).join(' ') || fullName(p) : x.about;
};
async function dropLeft(x) {
  if (!await ask({ text: 'Удалить незаконченное интервью?', note: `${leftName(x)}: ${x.answered} из ${x.total} ответов. Записанные ответы пропадут.`, yes: 'Удалить', no: 'Не удалять', danger: true })) return;
  await api('DELETE', `/api/interviews/${x.id}`).then(() => toast('Интервью удалено'), (e) => toast(e.message));
  await loadLeft();
}
const open = ref(new Set()); // раскрытые «Ещё N изменений»
const loaded = ref(false);
const error = ref('');

async function load() {
  try {
    const feed = await api('GET', '/api/feed');
    items.value = feed.items;
    asked.value = feed.asked || [];
    archive.value = feed.archive || null;
    loaded.value = true;
    error.value = '';
    await api('POST', '/api/feed/seen', { at: feed.now });
    if (store.tree) store.tree.feed_new = 0;
  } catch (e) {
    error.value = e.message;
  }
}
onMounted(load);
// Лента открыта — новое сразу на экране и считается просмотренным.
onUnmounted(onLive(load));

const persons = computed(() => (store.idx ? [...store.idx.persons.values()] : []));

const dayMonth = (day, month) => new Date(Date.UTC(2000, month - 1, day)).toLocaleString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const dates = computed(() => upcomingDates(persons.value).map((d) => ({
  ...d,
  when: d.inDays === 0 ? 'Сегодня' : d.inDays === 1 ? 'Завтра' : dayMonth(d.day, d.month),
  text: d.kind === 'birthday' ? yearsText(d.years)
    : `${yearsText(d.years)} со дня ${d.kind === 'birth' ? 'рождения' : 'смерти'}`,
})));

// Что заполнить: по одной строке на пробел, если он есть хоть у кого-то.
const HINTS = [
  ['дата рождения', 'nodates', 'Нет даты рождения'],
  ['фото', 'nophoto', 'Нет фото'],
  ['родители', 'noparents', 'Не указаны родители'],
];
const people = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'человека' : 'человек'}`;
const hints = computed(() => {
  if (!canEdit()) return [];
  const miss = persons.value.map((p) => missingFields(p, store.idx));
  return HINTS.map(([field, f, label]) => ({ f, label, n: miss.filter((m) => m.includes(field)).length })).filter((h) => h.n);
});

const name = computed(() => namer(items.value.filter((i) => i.kind === 'op'), store.idx));
const feed = computed(() => items.value.map((i) => (i.kind === 'op' ? { ...i, lines: opLines(i, name.value) } : i.kind === 'comment' ? { ...i, who: name.value.gen(i.person_id) } : i)));
const short = (t, n = 160) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const toggle = (id) => { const s = new Set(open.value); if (s.has(id)) s.delete(id); else s.add(id); open.value = s; };
const when = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
</script>

<template>
  <div class="page">
    <h1>Лента</h1>

    <div v-if="archive" class="banner keep">
      <div><b>Пора сохранить семейный архив.</b>
        {{ archive.last ? `В последний раз его скачивали ${lastText(archive.last)}.` : 'Вы его ещё не скачивали.' }}
        Скачайте и сохраните у себя — на случай, если с сервером что-то случится.</div>
      <div class="row">
        <router-link class="btn primary grow" to="/more?archive=1">Скачать всё</router-link>
        <button class="ghost" @click="later">Напомнить позже</button>
      </div>
    </div>

    <div v-for="x in left" :key="x.id" class="banner leftiv">
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
            <div class="q">{{ short(a.question) }}</div>
            <span class="btn primary go">Ответить</span>
          </div>
        </router-link>
      </div>
    </template>

    <template v-if="dates.length">
      <h2>Ближайшие даты</h2>
      <div class="list">
        <router-link v-for="d in dates" :key="d.person.id + d.kind" :to="`/person/${d.person.id}`" :class="{ round: d.round }">
          <div class="grow">
            <div class="small date" :class="{ today: d.inDays === 0 }">{{ d.when }}</div>
            <div class="name">{{ fullName(d.person) }}</div>
            <div class="small" :class="d.round ? 'accent' : 'muted'">{{ d.text }}<template v-if="d.round"> · круглая дата</template></div>
          </div>
          <span class="muted" aria-hidden="true">›</span>
        </router-link>
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

    <template v-if="canEdit() && findings.length">
      <h2>Помогите уточнить</h2>
      <div class="list">
        <Finding v-for="x in findings.slice(0, 3)" :key="x.key" :finding="x" />
        <router-link v-if="findings.length > 3" to="/checks">
          <div class="grow">Все вопросы к данным ({{ findings.length }})</div>
          <span class="muted" aria-hidden="true">›</span>
        </router-link>
      </div>
    </template>

    <h2>Что нового</h2>
    <div v-if="error" class="error">{{ error }}</div>
    <div v-else-if="!loaded" class="muted">Загрузка…</div>
    <div v-else class="list">
      <template v-for="it in feed" :key="it.kind + it.id">
        <router-link v-if="it.kind === 'comment'" :to="`/person/${it.person_id}?talk=1`" :class="{ fresh: it.fresh }">
          <div class="grow">
            <div class="small muted">{{ when(it.at) }}<span v-if="it.fresh" class="badge">новое</span></div>
            <div><b>{{ it.user_name || 'Кто-то' }}:</b> в обсуждении у {{ it.who }}</div>
            <div class="quote">{{ it.body }}</div>
          </div>
          <span class="muted" aria-hidden="true">›</span>
        </router-link>
        <router-link v-else-if="it.kind === 'answer'" :to="`/asks/${it.id}`" :class="{ fresh: it.fresh }">
          <div class="grow">
            <div class="small muted">{{ when(it.at) }}<span v-if="it.fresh" class="badge">новое</span></div>
            <div><b>{{ it.who || 'Родственник' }}</b> — ответ на ваш вопрос</div>
            <div class="small muted">{{ it.about }}</div>
            <div class="quote">{{ it.answer || 'Фото или запись голоса' }}</div>
          </div>
          <span class="muted" aria-hidden="true">›</span>
        </router-link>
        <router-link v-else-if="it.kind === 'survey'" :to="`/surveys/${it.id}`" :class="{ fresh: it.fresh }">
          <div class="grow">
            <div class="small muted">{{ when(it.at) }}<span v-if="it.fresh" class="badge">новое</span></div>
            <div v-if="it.sex === 'F' || it.sex === 'M'"><b>{{ it.name }}</b> {{ it.sex === 'F' ? 'заполнила' : 'заполнил' }} анкету о семье</div>
            <div v-else>Заполнена анкета о семье: <b>{{ it.name }}</b></div>
            <div class="muted small">Посмотрите ответы и загрузите их в дерево</div>
          </div>
          <span class="muted" aria-hidden="true">›</span>
        </router-link>
        <div v-else class="op" :class="{ fresh: it.fresh }">
          <div class="small muted">{{ when(it.at) }}<span v-if="it.fresh" class="badge">новое</span></div>
          <div class="line"><b>{{ it.user_name || 'Кто-то' }}:</b> {{ it.lines[0] }}</div>
          <div v-if="it.photos?.length" class="thumbs">
            <img v-for="id in it.photos" :key="id" :src="thumbUrl(id)" alt="" loading="lazy" />
          </div>
          <template v-if="open.has(it.op)">
            <div v-for="(l, i) in it.lines.slice(1)" :key="i" class="line more-line">{{ l }}</div>
          </template>
          <button v-if="it.lines.length > 1" class="ghost more" :aria-expanded="open.has(it.op)" @click="toggle(it.op)">
            {{ open.has(it.op) ? 'Свернуть' : moreText(it.lines.length - 1) }}
          </button>
        </div>
      </template>
      <div v-if="!feed.length" class="muted">Пока ничего не происходило</div>
    </div>
  </div>
</template>

<style scoped>
.leftiv, .keep { display: grid; gap: 0.444rem; font-size: 1rem; }
.keep .btn { white-space: nowrap; }
.date { color: var(--muted); }
.date.today { color: var(--accent-text); font-weight: 700; }
.name { overflow-wrap: anywhere; }
.round { background: var(--accent-soft); }
.round .muted, .round .date { color: var(--accent-soft-text); }
.accent { color: var(--accent-soft-text); font-weight: 700; }
.fresh { box-shadow: inset 4px 0 var(--accent); }
.asked { border: 2px solid var(--accent); }
.asked .q { font-weight: 700; margin: 0.111rem 0 0.444rem; overflow-wrap: anywhere; }
.asked .go { width: 100%; min-height: 2.889rem; }
.list > .op { display: block; }
.line { overflow-wrap: anywhere; }
.more-line { margin-top: 0.222rem; padding-left: 0.667rem; border-left: 3px solid var(--line); }
.more { color: var(--accent-text); padding-left: 0; padding-right: 0; text-decoration: underline; text-underline-offset: 3px; }
.thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.333rem; margin-top: 0.444rem; max-width: 22rem; }
.thumbs img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 0.556rem; background: var(--line); display: block; }
.quote { margin-top: 0.111rem; color: var(--muted); font-style: italic; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.badge { margin-left: 0.444rem; padding: 0.056rem 0.5rem; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-size: 0.778rem; font-weight: 700; }
</style>
