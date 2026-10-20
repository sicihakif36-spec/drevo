<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { store, canEdit } from '../store.js';
import { layoutTree } from '@shared/layout.js';
import { fullName, lifespan, kinship } from '@shared/names.js';
import TreeCanvas from '../components/TreeCanvas.vue';
import { openAdd } from '../components/addState.js';
import { photoUrl } from '../api.js';

defineOptions({ name: 'TreeView' });
const router = useRouter();

const saved = (() => { try { return JSON.parse(localStorage.getItem('drevo.view') || '{}'); } catch { return {}; } })();
const mode = ref(saved.mode || 'hourglass');
const up = ref(saved.up ?? 4);
const down = ref(saved.down ?? 3);
const rootId = ref(saved.root || null);
const selected = ref(null);
const searching = ref(false);
const query = ref('');
const canvas = ref(null);

const idx = computed(() => store.idx);
const root = computed(() => {
  if (!idx.value) return null;
  if (rootId.value && idx.value.persons.has(rootId.value)) return rootId.value;
  return store.me?.person_id && idx.value.persons.has(store.me.person_id) ? store.me.person_id : store.tree.persons[0]?.id || null;
});
const layout = computed(() => (idx.value && root.value
  ? layoutTree(idx.value, root.value, { mode: mode.value, up: up.value, down: down.value, placeholders: canEdit() })
  : { nodes: [], edges: [], bounds: { w: 0 } }));

watch([mode, up, down, rootId], () => {
  try { localStorage.setItem('drevo.view', JSON.stringify({ mode: mode.value, up: up.value, down: down.value, root: rootId.value })); } catch {}
});
watch(selected, (id) => (store.selectedId = id));

const sel = computed(() => (selected.value ? idx.value?.persons.get(selected.value) : null));
const selKin = computed(() => sel.value && kinship(idx.value, store.me?.person_id, sel.value.id));

function makeRoot(id) {
  rootId.value = id;
  selected.value = id;
  setTimeout(() => canvas.value?.centerOn(id), 0);
}
watch(() => store.treeRoot, (id) => { if (id) { makeRoot(id); store.treeRoot = null; } }, { immediate: true });
function add(type) { openAdd({ to: selected.value, type }); }
function onPlaceholder(ph) { selected.value = ph.of; openAdd({ to: ph.of, type: ph.relation }); }

const results = computed(() => {
  const s = query.value.trim().toLowerCase();
  if (!s || !idx.value) return [];
  return [...idx.value.persons.values()].filter((p) => fullName(p).toLowerCase().includes(s) || p.birth_surname.toLowerCase().includes(s)).slice(0, 12);
});
function pick(p) {
  searching.value = false;
  query.value = '';
  const onTree = layout.value.nodes.some((n) => n.id === p.id);
  if (onTree) { selected.value = p.id; canvas.value?.centerOn(p.id, Math.max(0.8, 0.8)); } else makeRoot(p.id);
}
const gensLabel = computed(() => (mode.value === 'ancestors' ? up.value : mode.value === 'descendants' ? down.value : `${up.value}↑ ${down.value}↓`));
function gens(delta) {
  if (mode.value !== 'descendants') up.value = Math.min(12, Math.max(1, up.value + delta));
  if (mode.value !== 'ancestors') down.value = Math.min(12, Math.max(1, down.value + delta));
}
</script>

<template>
  <div class="tree-page">
    <div class="top">
      <div class="seg">
        <button :class="{ on: mode === 'ancestors' }" @click="mode = 'ancestors'">Предки</button>
        <button :class="{ on: mode === 'hourglass' }" @click="mode = 'hourglass'">Все</button>
        <button :class="{ on: mode === 'descendants' }" @click="mode = 'descendants'">Потомки</button>
      </div>
      <button class="round" @click="searching = true" aria-label="Поиск">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      </button>
    </div>
    <div class="banner offline" v-if="store.offline">Нет связи. Показано сохранённое дерево.</div>

    <div v-if="!store.tree" class="page muted">Загрузка дерева…</div>
    <div v-else-if="!store.tree.persons.length" class="page empty">
      <h1>{{ store.title }}</h1>
      <p>Дерево пока пустое. Начните с себя, потом добавьте родителей, бабушек и дедушек.</p>
      <button class="primary block" v-if="canEdit()" @click="openAdd(null)">Добавить себя</button>
    </div>
    <TreeCanvas v-else ref="canvas" :layout="layout" :idx="idx" :selected-id="selected" :focus-id="root"
      @select="selected = $event" @placeholder="onPlaceholder" @open="router.push(`/person/${$event}`)" />

    <div class="zoom" v-if="store.tree?.persons.length && !sel">
      <button @click="canvas.zoomAt(1.35)" aria-label="Приблизить">+</button>
      <button @click="canvas.zoomAt(1 / 1.35)" aria-label="Отдалить">−</button>
      <button @click="canvas.fitAll()" aria-label="Всё дерево" class="sm">⤢</button>
      <button @click="canvas.centerOn(root, 0.65)" aria-label="К центру" class="sm">⌖</button>
    </div>
    <div class="gens" v-if="store.tree?.persons.length && !sel">
      <span class="muted">Поколения</span>
      <button @click="gens(-1)" aria-label="Меньше поколений">−</button>
      <b>{{ gensLabel }}</b>
      <button @click="gens(1)" aria-label="Больше поколений">+</button>
    </div>

    <div class="selsheet" v-if="sel">
      <div class="row" @click="router.push(`/person/${sel.id}`)">
        <img v-if="sel.photo_id" :src="photoUrl(sel.photo_id)" class="avatar" alt="" />
        <div v-else class="avatar" :class="sel.sex">{{ (sel.given || sel.surname || '?')[0] }}</div>
        <div class="grow">
          <div class="ellipsis"><b>{{ fullName(sel) }}</b></div>
          <div class="muted small ellipsis">{{ [lifespan(sel), selKin].filter(Boolean).join(' · ') }}</div>
        </div>
        <button class="ghost" aria-label="Открыть">›</button>
      </div>
      <div class="chips" style="margin-top:10px">
        <button class="chip" @click="router.push(`/person/${sel.id}`)">Карточка</button>
        <button class="chip" v-if="sel.id !== root" @click="makeRoot(sel.id)">В центр</button>
        <template v-if="canEdit()">
          <button class="chip" @click="add('father')">+ Отец</button>
          <button class="chip" @click="add('mother')">+ Мать</button>
          <button class="chip" @click="add('spouse')">+ Супруг(а)</button>
          <button class="chip" @click="add('child')">+ Ребёнок</button>
          <button class="chip" @click="add('sibling')">+ Брат/сестра</button>
        </template>
      </div>
    </div>

    <template v-if="searching">
      <div class="sheet-backdrop" @click="searching = false" />
      <div class="sheet">
        <input v-model="query" placeholder="Имя или фамилия" autofocus />
        <div class="list" style="margin-top:10px" v-if="results.length">
          <a v-for="p in results" :key="p.id" href="#" @click.prevent="pick(p)">
            <div class="grow"><div>{{ fullName(p) }}</div><div class="muted small">{{ lifespan(p) }}</div></div>
          </a>
        </div>
        <p class="muted small" v-else-if="query">Никого не нашлось</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tree-page { position: fixed; inset: 0; bottom: calc(var(--nav-h) + var(--safe-b)); overflow: hidden; }
.top { position: absolute; z-index: 5; top: calc(10px + var(--safe-t)); left: 12px; right: 12px; display: flex; gap: 8px; }
.top .seg { flex: 1; background: color-mix(in srgb, var(--line) 85%, transparent); backdrop-filter: blur(6px); }
.round { width: 46px; padding: 0; border-radius: 12px; background: var(--card); border: 1px solid var(--line); }
.offline { position: absolute; z-index: 5; top: calc(64px + var(--safe-t)); left: 12px; right: 12px; }
.empty { padding-top: calc(80px + var(--safe-t)); }
.zoom { position: absolute; z-index: 5; right: 12px; bottom: 76px; display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
.zoom > button { width: 44px; height: 44px; min-height: 0; padding: 0; font-size: 24px; background: transparent; border-radius: 0; border-top: 1px solid var(--line); }
.zoom > button:first-child { border-top: 0; }
.zoom > button.sm { font-size: 19px; }
.gens { position: absolute; z-index: 5; left: 12px; bottom: 12px; display: flex; align-items: center; gap: 4px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 0 4px 0 12px; font-size: 14px; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
.gens button { width: 40px; min-height: 44px; padding: 0; background: transparent; font-size: 22px; }
.selsheet { position: absolute; z-index: 6; left: 8px; right: 8px; bottom: 8px; background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.15); max-width: 640px; margin: 0 auto; }
</style>
