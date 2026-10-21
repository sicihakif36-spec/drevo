<script setup>
import { computed, onMounted, ref } from 'vue';
import { store, canEdit } from '../store.js';
import { api } from '../api.js';
import { namer, opLines } from '../history.js';
import { fullName, missingFields, upcomingDates, yearsText } from '@shared/names.js';

const items = ref([]);
const loaded = ref(false);
const error = ref('');

onMounted(async () => {
  try {
    const feed = await api('GET', '/api/feed');
    items.value = feed.items;
    loaded.value = true;
    await api('POST', '/api/feed/seen', { at: feed.now });
    if (store.tree) store.tree.feed_new = 0;
  } catch (e) {
    error.value = e.message;
  }
});

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
const feed = computed(() => items.value.map((i) => ({ ...i, lines: opLines(i, name.value) })));
const when = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
</script>

<template>
  <div class="page">
    <h1>Лента</h1>

    <template v-if="dates.length">
      <h2>Ближайшие даты</h2>
      <div class="list">
        <router-link v-for="d in dates" :key="d.person.id + d.kind" :to="`/person/${d.person.id}`" :class="{ round: d.round }">
          <div class="when small" :class="{ today: d.inDays === 0 }">{{ d.when }}</div>
          <div class="grow">
            <div>{{ fullName(d.person) }}</div>
            <div class="small" :class="d.round ? 'accent' : 'muted'">{{ d.text }}<template v-if="d.round"> · круглая дата</template></div>
          </div>
        </router-link>
      </div>
    </template>

    <template v-if="hints.length">
      <h2>Что можно дополнить</h2>
      <div class="list">
        <router-link v-for="h in hints" :key="h.f" :to="`/people?f=${h.f}`">
          <div class="grow">{{ h.label }} у {{ people(h.n) }}</div>
          <span class="muted">›</span>
        </router-link>
      </div>
    </template>

    <h2>Что нового</h2>
    <div v-if="error" class="error">{{ error }}</div>
    <div v-else-if="!loaded" class="muted">Загрузка…</div>
    <div v-else class="list">
      <div v-for="it in feed" :key="it.kind + it.id" :class="{ fresh: it.fresh }">
        <div class="grow">
          <div class="small"><b>{{ it.user_name || 'Кто-то' }}</b> <span class="muted">· {{ when(it.at) }}</span><span v-if="it.fresh" class="badge">новое</span></div>
          <div v-for="(l, i) in it.lines" :key="i">{{ l }}</div>
        </div>
      </div>
      <div v-if="!feed.length" class="muted">Пока ничего не происходило</div>
    </div>
  </div>
</template>

<style scoped>
.when { flex: none; width: 84px; color: var(--muted); }
.when.today { color: var(--accent); font-weight: 600; }
.round { background: var(--accent-soft); }
.accent { color: var(--accent); font-weight: 600; }
.fresh { box-shadow: inset 3px 0 var(--accent); }
.badge { margin-left: 8px; padding: 1px 8px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 12px; }
</style>
