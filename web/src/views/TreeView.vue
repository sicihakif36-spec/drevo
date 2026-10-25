<script setup>
import { computed, nextTick, onDeactivated, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { store, canEdit, loadTree, toast } from '../store.js';
import { layoutTree, fatherMother } from '@shared/layout.js';
import { homePerson, treeParts, centralPerson } from '@shared/wholetree.js';
import { kinLines } from '@shared/kin.js';
import { fullName, lifespan, kinship, personHas, altName, dateText, parentsOf, spousesOf, shortGenitive } from '@shared/names.js';
import { plural } from '@shared/rospis.js';
import { wide } from '../wide.js';
import TreeCanvas from '../components/TreeCanvas.vue';
import { openAdd } from '../components/addState.js';
import { ask } from '../components/ask.js';
import { api, photoUrl } from '../api.js';

defineOptions({ name: 'TreeView' });
const router = useRouter();

const saved = (() => { try { return JSON.parse(localStorage.getItem('drevo.view') || '{}'); } catch { return {}; } })();
// Вид: ветка выбранного человека — его предки и потомки (hourglass, по умолчанию), его родня по одной линии (kin),
// только предки, только потомки или всё дерево — все ветки сразу.
const MODES = ['hourglass', 'kin', 'ancestors', 'descendants', 'all'];
const mode = ref(MODES.includes(saved.mode) ? saved.mode : 'hourglass');
const up = ref(saved.up ?? 4);
const down = ref(saved.down ?? 3);
// Родня: по какой линии (shared/kin.js) и сколько поколений вверх до общих предков (null — как принято у линии).
const line = ref(saved.line || 'father');
const kinUp = ref(Number.isFinite(saved.kinUp) ? saved.kinUp : null);
const rootId = ref(saved.root || null);
const selected = ref(null);
const searching = ref(false);
const query = ref('');
const canvas = ref(null);
const searchInput = ref(null);
// autofocus не срабатывает у появившегося поля — ставим курсор сами, чтобы сразу открылась клавиатура.
watch(searching, (on) => { if (on) nextTick(() => searchInput.value?.focus()); });
// Дерево живёт в keep-alive, а поиск вынесен в body: уходя с дерева (например, кнопкой «Назад»), закрываем его.
onDeactivated(() => { searching.value = false; });

const idx = computed(() => store.idx);
// С кого начинать: сам вошедший, иначе человек владельца, иначе — из самой большой части дерева.
const home = computed(() => (idx.value ? homePerson(idx.value, store.me?.person_id, store.tree?.owner_person_id) : null));
const root = computed(() => {
  if (!idx.value) return null;
  if (rootId.value && idx.value.persons.has(rootId.value)) return rootId.value;
  return home.value;
});
// Во «всём дереве» раскладка начинается от своего (home): выбор другого человека той же части её не перестраивает.
const layout = computed(() => (idx.value && root.value
  ? layoutTree(idx.value, root.value, {
    mode: mode.value, up: mode.value === 'kin' ? kinUp.value : up.value, down: down.value, placeholders: canEdit(), anchor: home.value, line: line.value,
  })
  : { nodes: [], edges: [], bounds: { w: 0 } }));
// Кто не связан с показанной частью: переход к самой большой из остальных.
const others = computed(() => (mode.value === 'all' ? layout.value.others || 0 : 0));
function toOthers() {
  const { list, partOf } = treeParts(idx.value);
  const ids = list.find((_, i) => i !== partOf.get(root.value));
  if (ids) makeRoot(centralPerson(idx.value, ids));
}

watch([mode, up, down, rootId, line, kinUp], () => {
  try { localStorage.setItem('drevo.view', JSON.stringify({ mode: mode.value, up: up.value, down: down.value, root: rootId.value, line: line.value, kinUp: kinUp.value })); } catch {}
});
watch(selected, (id) => (store.selectedId = id));

const sel = computed(() => (selected.value ? idx.value?.persons.get(selected.value) : null));
const selKin = computed(() => sel.value && kinship(idx.value, store.me?.person_id, sel.value.id));
// На компьютере выбранный — панелью справа: главные даты и ближайшие родные (гостю сервер даты живых не отдаёт).
const selFacts = computed(() => {
  const p = sel.value;
  if (!p) return [];
  const F = p.sex === 'F';
  const birth = [dateText(p.birth_date), p.birth_place].filter(Boolean).join(', ');
  const death = [dateText(p.death_date), p.death_place].filter(Boolean).join(', ');
  return [birth && { label: F ? 'Родилась' : 'Родился', text: birth }, death && { label: F ? 'Умерла' : 'Умер', text: death }].filter(Boolean);
});
const selFamily = computed(() => {
  const p = sel.value;
  if (!p) return [];
  const get = (id) => idx.value.persons.get(id);
  const rows = [];
  const parents = parentsOf(idx.value, p.id).map(get).filter(Boolean);
  if (parents.length) rows.push({ label: 'Родители', people: parents });
  for (const s of spousesOf(idx.value, p.id)) {
    const fam = idx.value.families.get(s.familyId);
    const spouse = s.spouseId && get(s.spouseId);
    if (spouse) rows.push({ label: fam?.kind === 'partners' ? 'Вместе с' : spouse.sex === 'F' ? 'Жена' : 'Муж', people: [spouse] });
    const kids = (fam?.children || []).map(get).filter(Boolean);
    if (kids.length) rows.push({ label: 'Дети', people: kids });
  }
  return rows;
});

// Сколько места сверху и снизу дерева занимают кнопки: «Показать целиком» не прячет под ними крайние ряды.
const page = ref(null);
const topBar = ref(null);
const toolsBar = ref(null);
function insets() {
  const box = page.value?.getBoundingClientRect();
  if (!box) return undefined;
  const top = topBar.value ? topBar.value.getBoundingClientRect().bottom - box.top : 0;
  const bottom = toolsBar.value ? box.bottom - toolsBar.value.getBoundingClientRect().top : 0;
  return { top: top + 12, bottom: bottom + 12 };
}

function makeRoot(id) {
  rootId.value = id;
  selected.value = id;
  setTimeout(() => canvas.value?.centerOn(id), 0);
}
watch(() => store.treeRoot, (id) => { if (id) { makeRoot(id); store.treeRoot = null; } }, { immediate: true });
// Из всего дерева — к ветке выбранного: его предки и потомки.
function branchOf(id) {
  if (mode.value === 'all') mode.value = 'hourglass';
  makeRoot(id);
}
function add(type) { openAdd({ to: selected.value, type }); }
function onPlaceholder(ph) { selected.value = ph.of; openAdd({ to: ph.of, type: ph.relation }); }

const results = computed(() => {
  const s = query.value.trim();
  if (!s || !idx.value) return [];
  return [...idx.value.persons.values()].filter((p) => personHas(p, s)).slice(0, 12);
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
  const id = meId.value || home.value;
  rootId.value = id;
  setTimeout(() => canvas.value?.centerOn(id, 0.95), 0);
}

// Родня: что показано (null — у человека не указаны родители), какие линии есть, выбор линии.
const kin = computed(() => (mode.value === 'kin' ? layout.value.kin : null));
const lines = computed(() => (mode.value === 'kin' && idx.value && root.value ? kinLines(idx.value, root.value) : []));
const rootP = computed(() => (root.value ? idx.value?.persons.get(root.value) : null));
const whose = computed(() => (root.value === meId.value ? 'Ваша родня' : `Родня ${shortGenitive(rootP.value)}`));
const kinCount = computed(() => {
  const n = kin.value ? kin.value.blood.size - 1 : 0;
  return `${n} ${plural(n, 'человек', 'человека', 'человек')}`;
});
const choosing = ref(false);
onDeactivated(() => { choosing.value = false; });
const lineGroups = computed(() => {
  if (!choosing.value || !rootP.value) return [];
  const [father, mother] = fatherMother(idx.value, root.value);
  return [
    { title: 'Со стороны отца', lines: lines.value.filter((l) => l.path[0] === 'M'), missing: !father && 'Отец в дереве не указан.' },
    { title: 'Со стороны матери', lines: lines.value.filter((l) => l.path[0] === 'F'), missing: !mother && 'Мать в дереве не указана.' },
  ];
});
function pickLine(l) {
  line.value = l.key;
  kinUp.value = null;
  choosing.value = false;
}
// Другая линия или число поколений: вся родня на экране, если её можно прочесть, иначе — человек в середине.
watch([mode, line, kinUp], () => {
  if (mode.value === 'kin') setTimeout(() => canvas.value?.fitAll(insets(), 0.45) || canvas.value?.centerOn(root.value), 0);
});

// «Найдите себя»: у вошедшего нет себя в дереве — родство не считается. Плашку можно убрать.
const findHidden = ref((() => { try { return localStorage.getItem('drevo.findme') === 'hide'; } catch { return false; } })());
const showFind = computed(() => Boolean(store.me && idx.value?.persons.size) && !meId.value && !findHidden.value);
function hideFind() {
  findHidden.value = true;
  try { localStorage.setItem('drevo.findme', 'hide'); } catch {}
}
const finding = ref(false);
const findQuery = ref('');
const findInput = ref(null);
watch(finding, (on) => { if (on) nextTick(() => findInput.value?.focus()); });
onDeactivated(() => { finding.value = false; });
const findResults = computed(() => {
  const s = findQuery.value.trim();
  if (!s || !idx.value) return [];
  return [...idx.value.persons.values()].filter((p) => personHas(p, s)).slice(0, 8);
});
async function itsMe(id, confirm = false) {
  if (confirm && !await ask({ text: `Вы — ${fullName(idx.value.persons.get(id))}?`, note: 'Родство будет считаться от вас. Изменить можно в карточке.', yes: 'Да, это я', no: 'Нет' })) return;
  try {
    await api('PATCH', '/api/me', { person_id: id });
  } catch (e) {
    toast(e.message);
    return;
  }
  finding.value = false;
  findQuery.value = '';
  await loadTree();
  toast('Теперь родство считается от вас');
  rootId.value = id;
  selected.value = null;
  setTimeout(() => canvas.value?.centerOn(id, 0.95), 0);
}

const gensLabel = computed(() => (mode.value === 'kin' ? `${kin.value?.up} вверх` : mode.value === 'ancestors' ? `${up.value} вверх` : mode.value === 'descendants' ? `${down.value} вниз` : `${up.value} вверх, ${down.value} вниз`));
function gens(delta) {
  if (mode.value === 'kin') {
    if (kin.value) kinUp.value = Math.min(kin.value.max, Math.max(kin.value.min, kin.value.up + delta));
    return;
  }
  if (mode.value !== 'descendants') up.value = Math.min(12, Math.max(1, up.value + delta));
  if (mode.value !== 'ancestors') down.value = Math.min(12, Math.max(1, down.value + delta));
}
</script>

<template>
  <div ref="page" class="tree-page" :class="{ 'has-sel': sel }">
    <div ref="topBar" class="top">
      <div class="seg">
        <button :class="{ on: mode === 'hourglass' }" @click="mode = 'hourglass'">Ветка</button>
        <button :class="{ on: mode === 'kin' }" @click="mode = 'kin'">Родня</button>
        <button :class="{ on: mode === 'ancestors' }" @click="mode = 'ancestors'">Предки</button>
        <button :class="{ on: mode === 'descendants' }" @click="mode = 'descendants'">Потомки</button>
        <button :class="{ on: mode === 'all' }" @click="mode = 'all'">Всё дерево</button>
      </div>
      <button class="round" @click="searching = true" aria-label="Найти человека">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <span v-if="wide" aria-hidden="true">Найти на дереве</span>
      </button>
      <div class="banner offline" v-if="store.offline">Нет связи. Показано сохранённое дерево.</div>
      <div class="note" v-if="showFind && !sel">
        <span class="grow">Найдите себя — родство будет считаться от вас</span>
        <button class="primary" @click="finding = true">Найти себя</button>
        <button class="ghost x" @click="hideFind" aria-label="Убрать подсказку">✕</button>
      </div>
      <div class="note" v-if="mode === 'kin' && rootP && (!sel || wide)">
        <template v-if="kin">
          <span class="grow"><b>{{ whose }} {{ kin.text }}</b>: {{ kinCount }}</span>
          <button @click="choosing = true">Другая линия</button>
        </template>
        <template v-else>
          <span class="grow">{{ root === meId ? 'Ваши родители' : `Родители ${shortGenitive(rootP)}` }} в дереве не указаны — родню не от кого показать</span>
          <button v-if="canEdit()" @click="openAdd({ to: root, type: null })">Добавить родителей</button>
        </template>
      </div>
      <div class="note" v-if="others && !sel">
        <span class="grow">Ещё {{ others }} {{ others % 10 === 1 && others % 100 !== 11 ? 'человек не связан' : 'человек не связаны' }} с этой веткой</span>
        <button @click="toOthers">Показать</button>
      </div>
    </div>

    <div v-if="!store.tree" class="page muted">Загрузка дерева…</div>
    <div v-else-if="!store.tree.persons.length" class="page empty">
      <h1>{{ store.title }}</h1>
      <p>Дерево пока пустое. Начните с себя, потом добавьте родителей, бабушек и дедушек.</p>
      <button class="primary block" v-if="canEdit()" @click="openAdd(null)">Добавить себя</button>
      <p><router-link to="/help">Как пользоваться Древом</router-link></p>
    </div>
    <TreeCanvas v-else ref="canvas" :layout="layout" :idx="idx" :selected-id="selected" :focus-id="root"
      @select="selected = $event" @placeholder="onPlaceholder" @open="router.push(`/person/${$event}`)" />

    <div ref="toolsBar" class="tools" v-if="store.tree?.persons.length && (!sel || wide)">
      <div class="row tools-top">
        <div class="views">
          <button @click="canvas.fitAll(insets())">Показать целиком</button>
          <button @click="toMe">{{ meId ? 'Ко мне' : 'К началу' }}</button>
        </div>
        <div class="zoom">
          <button @click="canvas.zoomAt(1.35)" aria-label="Крупнее">+</button>
          <button @click="canvas.zoomAt(1 / 1.35)" aria-label="Мельче">−</button>
        </div>
      </div>
      <div class="gens" v-if="mode === 'kin' ? kin && kin.max > kin.min : mode !== 'all'">
        <button @click="gens(-1)" :disabled="mode === 'kin' && kin.up <= kin.min" aria-label="Меньше поколений">−</button>
        <span class="grow">Поколений: <b class="nowrap">{{ gensLabel }}</b></span>
        <button @click="gens(1)" :disabled="mode === 'kin' && kin.up >= kin.max" aria-label="Больше поколений">+</button>
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
      <dl v-if="wide && (selFacts.length || selFamily.length)" class="facts">
        <div v-for="f in selFacts" :key="f.label"><dt>{{ f.label }}</dt><dd>{{ f.text }}</dd></div>
        <div v-for="(f, i) in selFamily" :key="'f' + i"><dt>{{ f.label }}</dt>
          <dd><router-link v-for="x in f.people" :key="x.id" :to="`/person/${x.id}`">{{ fullName(x) }}</router-link></dd></div>
      </dl>
      <div class="grid2 actions">
        <button class="primary" :class="{ wide: !canEdit() }" @click="router.push(`/person/${sel.id}`)">Открыть карточку</button>
        <button v-if="canEdit()" @click="add(null)">Добавить родственника</button>
        <button v-if="mode === 'kin' ? sel.id !== root : sel.id !== root || mode === 'all'" class="wide" @click="mode === 'kin' ? makeRoot(sel.id) : branchOf(sel.id)">
          {{ mode === 'kin' ? 'Родня этого человека' : 'Ветка этого человека' }}</button>
        <button v-if="!meId && store.me" class="wide" @click="itsMe(sel.id, true)">Это я</button>
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
            <div class="grow"><div>{{ fullName(p) }}</div><div class="muted small">{{ [altName(p), lifespan(p)].filter(Boolean).join(' · ') }}</div></div>
          </a>
        </div>
        <p class="muted" v-else-if="query.trim()">Никого не нашлось. Попробуйте только фамилию.</p>
      </div>
    </Teleport>

    <Teleport to="body" v-if="choosing">
      <div class="sheet-backdrop" @click="choosing = false" />
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Чья родня">
        <div class="row"><h2 class="grow" style="margin:0">{{ whose }}</h2><button class="ghost" @click="choosing = false" aria-label="Закрыть">✕</button></div>
        <p class="muted small" style="margin:4px 0 0">Кровные родственники по одной линии. Сверху — общие предки, под ними все их дети, внуки и правнуки с мужьями и жёнами. Больше поколений вверх — больше родни.</p>
        <template v-for="g in lineGroups" :key="g.title">
          <h3 class="side">{{ g.title }}</h3>
          <div class="list" v-if="g.lines.length">
            <button v-for="l in g.lines" :key="l.key" :aria-pressed="kin?.key === l.key" @click="pickLine(l)">
              <div class="grow"><div :class="{ b: kin?.key === l.key }">{{ l.title }}</div><div class="muted small">{{ fullName(idx.persons.get(l.via)) }}, {{ l.who }}</div></div>
              <span v-if="kin?.key === l.key" class="tick" aria-hidden="true">✓</span>
            </button>
          </div>
          <p class="muted small" v-if="g.missing">{{ g.missing }}</p>
          <p class="muted small" v-else-if="g.lines.length === 1">Родня по деду и по бабушке появится, когда в дереве будут их родители.</p>
        </template>
      </div>
    </Teleport>

    <Teleport to="body" v-if="finding">
      <div class="sheet-backdrop" @click="finding = false" />
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Найти себя">
        <div class="row"><h2 class="grow" style="margin:0">Найдите себя</h2><button class="ghost" @click="finding = false" aria-label="Закрыть">✕</button></div>
        <p class="muted small" style="margin:4px 0 0">Тогда родство будет считаться от вас, а дерево — открываться с вас.</p>
        <input ref="findInput" v-model="findQuery" type="search" placeholder="Ваше имя или фамилия" enterkeyhint="search" style="margin-top:8px" />
        <div class="list" style="margin-top:10px" v-if="findResults.length">
          <div v-for="p in findResults" :key="p.id" class="me-row">
            <div class="grow"><div>{{ fullName(p) }}</div><div class="muted small">{{ [altName(p), lifespan(p)].filter(Boolean).join(' · ') }}</div></div>
            <button class="primary" @click="itsMe(p.id)">Это я</button>
          </div>
        </div>
        <p class="muted" v-else-if="findQuery.trim()">Никого не нашлось. Попробуйте только фамилию.</p>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tree-page { position: fixed; inset: 0; left: var(--side); bottom: calc(var(--nav-h) + var(--safe-b)); overflow: hidden; }
/* На узком экране или с крупным шрифтом лупа уходит на вторую строку, справа. */
.top { position: absolute; z-index: 5; top: calc(0.556rem + var(--safe-t)); left: 0.667rem; right: 0.667rem; display: flex; flex-wrap: wrap; gap: 0.444rem; pointer-events: none; }
.top > * { pointer-events: auto; }
.top .seg { flex: 1 1 12rem; background: color-mix(in srgb, var(--line) 88%, transparent); backdrop-filter: blur(6px); }
.round { flex: none; margin-left: auto; width: 3.111rem; min-height: 3.111rem; padding: 0; border-color: var(--field); border-width: 1.5px; color: var(--text); }
.offline { flex: 1 1 100%; margin: 0; }
.note { flex: 1 1 100%; display: flex; align-items: center; gap: 0.444rem; background: var(--card); border: 1.5px solid var(--field); border-radius: var(--radius-s); padding: 0.333rem 0.333rem 0.333rem 0.667rem; font-size: 0.889rem; line-height: 1.3; box-shadow: 0 2px 10px rgba(0,0,0,.1); }
.note .grow { flex: 1 1 auto; min-width: 0; }
.note button { flex: none; min-height: 2.667rem; padding: 0.25rem 0.667rem; font-size: 0.889rem; }
.note .x { width: 2.222rem; padding: 0; color: var(--muted); }
.me-row { display: flex; align-items: center; gap: 0.5rem; }
.me-row button { flex: none; }
.side { margin: 1rem 0 0.444rem; font-size: 1rem; }
.b { font-weight: 700; }
.tick { flex: none; color: var(--accent-text); font-weight: 700; }
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
.facts { margin: 0; display: grid; gap: 0.667rem; }
.facts dt { font-size: 0.889rem; font-weight: 700; }
.facts dd { margin: 0; overflow-wrap: anywhere; }
.facts a { display: block; color: var(--accent-text); }
/* Компьютер: панель управления строкой внизу, поиск с подписью, выбранный человек — панелью справа. */
@media (min-width: 64em) {
  .top { top: 1.111rem; left: 1.333rem; right: 1.333rem; }
  .top .seg { flex: 0 1 auto; }
  .round { width: auto; padding: 0 1rem; gap: 0.444rem; font-size: 0.889rem; }
  .round svg { width: 1.222rem; height: 1.222rem; }
  .tools { flex-direction: row; flex-wrap: wrap; align-items: flex-end; left: 1.333rem; right: 1.333rem; bottom: 1.111rem; }
  .tools-top { display: contents; }
  .views { flex-direction: row; }
  .gens { order: 1; }
  .zoom { order: 2; margin-left: auto; flex-direction: row-reverse; }
  .zoom > button + button { border-top: 0; border-right: 1px solid var(--line); }
  .has-sel .top, .has-sel .tools { right: calc(22rem + 1.333rem); }
  .selsheet {
    top: 0; right: 0; bottom: 0; left: auto; width: 22rem; max-width: none; margin: 0; overflow-y: auto;
    display: flex; flex-direction: column; gap: 1.111rem; padding: 1.333rem;
    border: 0; border-left: 1px solid var(--line); border-radius: 0; box-shadow: -6px 0 24px rgba(0,0,0,.08);
  }
  .selsheet > .row { align-items: flex-start; }
  .selsheet .who { flex-direction: column; align-items: flex-start; gap: 0.667rem; }
  .selsheet .avatar { width: 5.333rem; height: 5.333rem; border-radius: 1.111rem; font-size: 1.778rem; }
  .selsheet .name { font-size: 1.333rem; line-height: 1.25; }
  .actions { grid-template-columns: 1fr; margin-top: auto; }
  .actions button { min-height: 3rem; font-size: 1rem; }
}
</style>
