<script setup>
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store, canEdit, toast } from '../store.js';
import { LEVELS, LEVEL_TITLE } from '@shared/checks.js';
import { findings, marked, unmark } from '../checks.js';
import { fullName } from '@shared/names.js';
import Finding from '../components/Finding.vue';

// «Главная → Проверка дерева»: что приложение нашло в данных — сначала ошибки, потом «стоит проверить», дубли, люди без связей.
const router = useRouter();
const PAGE = 30; // длинный список показываем по частям
const shown = reactive({});
const groups = computed(() => LEVELS.map((level) => {
  const list = findings.value.filter((x) => x.level === level);
  return { level, title: LEVEL_TITLE[level], list, items: list.slice(0, shown[level] || PAGE) };
}).filter((g) => g.list.length));
const showMarked = ref(false);

const NOTE = {
  error: 'Так не бывает — скорее всего, опечатка в годе или лишняя связь.',
  warn: 'Так бывает, но редко — проверьте по документам или спросите у родных.',
  dup: 'Похожие имя, фамилия и годы. Если это один человек — объедините карточки.',
  alone: 'Эти люди не связаны с остальным деревом.',
};
const names = (ids) => ids.map((id) => store.idx?.persons.get(id)).filter(Boolean).map(fullName).join(', ');
const when = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const jump = (level) => document.getElementById(`lv-${level}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

async function back(m) {
  try {
    await unmark(m.key);
    toast('Снова в проверке');
  } catch (e) { toast(e.message); }
}
</script>

<template>
  <div class="page" v-if="!canEdit()"><p class="muted">Проверка дерева — для владельца и участников.</p></div>
  <div class="page" v-else>
    <div class="row" style="margin-bottom:0.444rem">
      <button class="ghost" @click="router.back()" aria-label="Назад">‹ Назад</button>
    </div>
    <h1>Проверка дерева</h1>
    <p class="muted intro">Приложение само ищет в дереве то, что стоит уточнить у родных: невозможные даты, ошибки в связях,
      одного человека, записанного дважды. Если всё верно — отметьте, и находка пропадёт у всех.</p>

    <div v-if="!store.tree" class="muted">Загрузка…</div>
    <div v-else-if="!groups.length" class="card ok">Всё проверено — вопросов к данным нет.</div>
    <template v-else>
      <div class="sum">
        <button v-for="g in groups" :key="g.level" class="chip" :class="`lv-${g.level}`" @click="jump(g.level)">{{ g.title }}: {{ g.list.length }}</button>
      </div>
      <section v-for="g in groups" :id="`lv-${g.level}`" :key="g.level" class="sec">
        <h2>{{ g.title }} <span class="muted count">{{ g.list.length }}</span></h2>
        <p class="small muted">{{ NOTE[g.level] }}</p>
        <div class="list">
          <Finding v-for="x in g.items" :key="x.key" :finding="x" />
        </div>
        <button v-if="g.list.length > g.items.length" class="ghost block more" @click="shown[g.level] = g.items.length + PAGE">
          Показать ещё {{ Math.min(PAGE, g.list.length - g.items.length) }} из {{ g.list.length - g.items.length }}
        </button>
      </section>
    </template>

    <template v-if="marked.length">
      <h2>Отмечено как верное <span class="muted count">{{ marked.length }}</span></h2>
      <button v-if="!showMarked" class="block" @click="showMarked = true">Показать</button>
      <div v-else class="list">
        <div v-for="m in marked" :key="m.key" class="mark">
          <div class="text">{{ m.finding.text }}</div>
          <div class="small muted">{{ m.kind === 'dup' ? 'Это разные люди' : 'Всё верно' }} — {{ m.user_name || 'кто-то' }}, {{ when(m.at) }}</div>
          <div v-if="m.finding.level !== 'dup'" class="small muted">{{ names(m.persons) }}</div>
          <button class="back" @click="back(m)">Вернуть в проверку</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.intro { margin-top: 0; }
.sum { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.667rem 0 0.222rem; }
.sum .chip { font-weight: 700; }
.chip.lv-error { border-color: var(--danger); color: var(--danger); }
.sec { scroll-margin-top: 0.5rem; }
.sec .small { margin-top: -0.222rem; }
.count { font-weight: 400; }
.ok { font-weight: 700; }
.more { margin-top: 0.333rem; color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; }
.list > .mark { display: block; }
.mark .text { overflow-wrap: anywhere; }
.back { margin-top: 0.444rem; width: 100%; }
</style>
