<script setup>
import { computed, nextTick, ref, watch } from 'vue';
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
const searchInput = ref(null);
// autofocus не срабатывает у появившегося поля — ставим курсор сами, чтобы сразу открылась клавиатура.
watch(searching, (on) => { if (on) nextTick(() => searchInput.value?.focus()); });

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
  if (onTree) { selected.value = p.id; canvas.value?.centerOn(p.id, 0.95); } else makeRoot(p.id);
}
// «Ко мне»: дерево от себя, себя — в середину экрана.
const meId = computed(() => (store.me?.person_id && idx.value?.persons.has(store.me.person_id) ? store.me.person_id : null));
function toMe() {
  const id = meId.value || root.value;
  rootId.value = id;
  setTimeout(() => canvas.value?.centerOn(id, 0.95), 0);
}
const gensLabel = computed(() => (mode.value === 'ancestors' ? `${up.value} вверх` : mode.value === 'descendants' ? `${down.value} вниз` : `${up.value} вверх, ${down.value} вниз`));
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
      <button class="round" @click="searching = true" aria-label="Найти человека">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      </button>
      <div class="banner offline" v-if="store.offline">Нет связи. Показано сохранённое дерево.</div>
    </div>

    <div v-if="!store.tree" class="page muted">Загрузка дерева…</div>
    <div v-else-if="!store.tree.persons.length" class="page empty">
      <h1>{{ store.title }}</h1>
      <p>Дерево пока пустое. Начните с себя, потом добавьте родителей, бабушек и дедушек.</p>
      <button class="primary block" v-if="canEdit()" @click="openAdd(null)">Добавить себя</button>
    </div>
    <TreeCanvas v-else ref="canvas" :layout="layout" :idx="idx" :selected-id="selected" :focus-id="root"
      @select="selected = $event" @placeholder="onPlaceholder" @open="router.push(`/person/${$event}`)" />

    <div class="tools" v-if="store.tree?.persons.length && !sel">
      <div class="row tools-top">
        <div class="views">
          <button @click="canvas.fitAll()">Всё дерево</button>
          <button @click="toMe">{{ meId ? 'Ко мне' : 'К началу' }}</button>
        </div>
        <div class="zoom">
          <button @click="canvas.zoomAt(1.35)" aria-label="Крупнее">+</button>
          <button @click="canvas.zoomAt(1 / 1.35)" aria-label="Мельче">−</button>
        </div>
      </div>
      <div class="gens">
        <button @click="gens(-1)" aria-label="Меньше поколений">−</button>
        <span class="grow">Поколений: <b class="nowrap">{{ gensLabel }}</b></span>
        <button @click="gens(1)" aria-label="Больше поколений">+</button>
      </div>
    </div>

    <div class="selsheet" v-if="sel">
      <div class="row">
        <div class="row grow who" @click="router.push(`/person/${sel.id}`)">
          <img v-if="sel.photo_id" :src="photoUrl(sel.photo_id)" class="avatar" alt="" />
          <div v-else class="avatar" :class="sel.sex">{{ (sel.given || sel.surname || '?')[0] }}</div>
          <div class="grow">
            <div class="name"><b>{{ fullName(sel) }}</b></div>
            <div class="muted small">{{ [lifespan(sel), selKin].filter(Boolean).join(' · ') }}</div>
          </div>
        </div>
        <button class="ghost close" @click="selected = null" aria-label="Закрыть">✕</button>
      </div>
      <div class="grid2 actions">
        <button class="primary" :class="{ wide: !canEdit() }" @click="router.push(`/person/${sel.id}`)">Открыть карточку</button>
        <button v-if="canEdit()" @click="add(null)">Добавить родственника</button>
        <button v-if="sel.id !== root" class="wide" @click="makeRoot(sel.id)">Дерево от этого человека</button>
      </div>
    </div>

    <!-- Поиск — поверх нижней панели: из .tree-page (свой слой) шторка оказалась бы под ней. -->
    <Teleport to="body" v-if="searching">
      <div class="sheet-backdrop" @click="searching = false" />
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Поиск">
        <div class="row"><h2 class="grow" style="margin:0">Найти человека</h2><button class="ghost" @click="searching = false" aria-label="Закрыть">✕</button></div>
        <input ref="searchInput" v-model="query" type="search" placeholder="Имя или фамилия" enterkeyhint="search" style="margin-top:8px" />
        <div class="list" style="margin-top:10px" v-if="results.length">
          <a v-for="p in results" :key="p.id" href="#" @click.prevent="pick(p)">
            <div class="grow"><div>{{ fullName(p) }}</div><div class="muted small">{{ lifespan(p) }}</div></div>
          </a>
        </div>
        <p class="muted" v-else-if="query.trim()">Никого не нашлось. Попробуйте только фамилию.</p>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tree-page { position: fixed; inset: 0; bottom: calc(var(--nav-h) + var(--safe-b)); overflow: hidden; }
/* На узком экране или с крупным шрифтом лупа уходит на вторую строку, справа. */
.top { position: absolute; z-index: 5; top: calc(0.556rem + var(--safe-t)); left: 0.667rem; right: 0.667rem; display: flex; flex-wrap: wrap; gap: 0.444rem; pointer-events: none; }
.top > * { pointer-events: auto; }
.top .seg { flex: 1 1 12rem; background: color-mix(in srgb, var(--line) 88%, transparent); backdrop-filter: blur(6px); }
.round { flex: none; margin-left: auto; width: 3.111rem; min-height: 3.111rem; padding: 0; border-color: var(--field); border-width: 1.5px; color: var(--text); }
.offline { flex: 1 1 100%; margin: 0; }
.nowrap { white-space: nowrap; }
.empty { padding-top: calc(7.5rem + var(--safe-t)); }
.tools { position: absolute; z-index: 5; left: 0.667rem; right: 0.667rem; bottom: 0.667rem; display: flex; flex-direction: column; gap: 0.444rem; pointer-events: none; }
.tools > * { pointer-events: auto; }
.tools-top { align-items: flex-end; justify-content: space-between; pointer-events: none; }
.tools-top > * { pointer-events: auto; }
.tools button, .gens { box-shadow: 0 2px 10px rgba(0,0,0,.1); }
.views { display: flex; flex-direction: column; gap: 0.444rem; align-items: flex-start; }
.views button { min-height: 2.667rem; padding: 0.25rem 0.889rem; font-size: 0.889rem; border-width: 1.5px; border-color: var(--field); color: var(--text); }
.zoom { display: flex; flex-direction: column; border-radius: var(--radius-s); overflow: hidden; border: 1.5px solid var(--field); background: var(--card); box-shadow: 0 2px 10px rgba(0,0,0,.1); }
.zoom > button { width: 3rem; height: 3rem; min-height: 0; padding: 0; font-size: 1.556rem; font-weight: 400; border: 0; border-radius: 0; color: var(--text); box-shadow: none; }
.zoom > button + button { border-top: 1px solid var(--line); }
.gens { display: flex; align-items: center; gap: 0.25rem; background: var(--card); border: 1.5px solid var(--field); border-radius: var(--radius-s); padding: 0.111rem; font-size: 0.889rem; text-align: center; line-height: 1.3; }
.gens button { flex: none; width: 3rem; min-height: 2.667rem; padding: 0; font-size: 1.444rem; font-weight: 400; border: 0; background: transparent; color: var(--text); box-shadow: none; }
.selsheet { position: absolute; z-index: 6; left: 0.444rem; right: 0.444rem; bottom: 0.444rem; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 0.667rem; box-shadow: 0 4px 24px rgba(0,0,0,.18); max-width: 640px; margin: 0 auto; }
.who { cursor: pointer; align-items: center; }
.name { overflow-wrap: anywhere; line-height: 1.3; }
.close { flex: none; align-self: flex-start; width: 3rem; padding: 0; font-size: 1.222rem; color: var(--muted); }
.actions { margin-top: 0.667rem; }
.actions button { min-height: 3rem; padding: 0.333rem 0.5rem; font-size: 0.944rem; }
.actions .wide { grid-column: 1 / -1; }
</style>
