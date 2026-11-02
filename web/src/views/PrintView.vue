<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { store, canTalk } from '../store.js';
import { api, thumbUrl } from '../api.js';
import { layoutTree, BOX } from '@shared/layout.js';
import { homePerson } from '@shared/wholetree.js';
import { planPages, legibility, posters, PAPER, MM, THEMES, TREE_TEXT } from '@shared/printplan.js';
import { treeCard } from '@shared/treecard.js';
import { view, MODES } from '../treeview.js';
import { layoutFan, sectorPath, FAN } from '@shared/fan.js';
import { fullName, shortGenitive } from '@shared/names.js';
import { kinLines } from '@shared/kin.js';
import { buildRospis, parseRospisOptions } from '@shared/rospis.js';
import RospisText from '../components/RospisText.vue';

const saved = (() => { try { return JSON.parse(localStorage.getItem('drevo.print') || '{}'); } catch { return {}; } })();
// Что печатать (mode): дерево (tree) — ровно как на экране «Дерево» (вид, человек, поколения, линия — в treeview.js),
// веер предков (fan) или роспись (rospis); у веера и росписи свой человек в центре (root, пусто — тот же, что на дереве).
const o = reactive({
  root: '', mode: 'tree', paper: 'A4', orient: 'auto', fit: 'page', scale: 100,
  photos: true, hideLiving: false, theme: 'classic', title: '', gens: 5, shape: 180, colors: 'branch', empty: true,
  // Склейка: «Читаемо», плакат A3…A0 или своя крупность. Кто склеивал раньше, у того остаётся его крупность.
  size: saved.fit === 'tiles' ? 'scale' : 'read', ...saved,
});
if (!['tree', 'fan', 'rospis'].includes(o.mode)) o.mode = 'tree';
for (const k of ['up', 'down', 'line', 'kinUp']) delete o[k]; // раньше у печати был свой вид дерева
// Из карточки: «Веер предков» с этим человеком в центре.
const route = useRoute();
if (route.query.root) o.root = String(route.query.root);
if (['tree', 'fan', 'rospis'].includes(route.query.mode)) o.mode = String(route.query.mode);
watch(o, () => { try { localStorage.setItem('drevo.print', JSON.stringify(o)); } catch {} });
// Роспись: свои настройки; оформление, заголовок и «скрыть живых» — общие.
const savedR = (() => { try { return JSON.parse(localStorage.getItem('drevo.rospis') || '{}'); } catch { return {}; } })();
const ro = reactive({ gens: 0, male: false, events: true, notes: true, sources: false, title: '', ...savedR });
watch(ro, () => { try { localStorage.setItem('drevo.rospis', JSON.stringify(ro)); } catch {} });

const people = computed(() => [...(store.idx?.persons.values() || [])].sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru')));
// Кто в центре: выбранный, иначе сам вошедший или человек владельца, иначе — из самой большой части (как на сервере).
const home = computed(() => (store.idx ? homePerson(store.idx, store.me?.person_id, store.tree?.owner_person_id) : null));
// С кого начато дерево на экране «Дерево».
const treeRoot = computed(() => (store.idx?.persons.has(view.root) ? view.root : home.value));
const isFan = computed(() => o.mode === 'fan');
const isRospis = computed(() => o.mode === 'rospis');
const isTree = computed(() => !isFan.value && !isRospis.value);
const rootId = computed(() => (isTree.value ? treeRoot.value : store.idx?.persons.has(o.root) ? o.root : treeRoot.value));
// «Кто в центре»: у дерева — тот же, что на экране «Дерево» (поменяется и там), у веера и росписи — свой.
const rootSel = computed({
  get: () => (isTree.value ? (store.idx?.persons.has(view.root) ? view.root : '') : o.root),
  set: (v) => { if (isTree.value) view.root = v || null; else o.root = v; },
});
function treeMode(m) {
  o.mode = 'tree';
  if (MODES.includes(m)) view.mode = m;
}
// Та же раскладка, что на экране «Дерево» (без пустых мест «добавить родителя»).
const layout = computed(() => (store.idx && rootId.value && isTree.value
  ? layoutTree(store.idx, rootId.value, { mode: view.mode, up: view.mode === 'kin' ? view.kinUp : view.up, down: view.down, anchor: home.value, line: view.line }) : null));
// Родня: какие линии есть у выбранного, что вышло (null — родители не указаны) и заголовок по умолчанию.
const isKin = computed(() => isTree.value && view.mode === 'kin');
const lines = computed(() => (isKin.value && store.idx && rootId.value ? kinLines(store.idx, rootId.value) : []));
const kin = computed(() => (isKin.value ? layout.value?.kin : null));
const kinTitle = computed(() => (kin.value ? `Родня ${shortGenitive(store.idx.persons.get(rootId.value))} ${kin.value.text}` : ''));
function pickLine(l) {
  view.line = l.key;
  view.kinUp = null;
}
// Веер: та же раскладка, что в PDF (shared/fan.js). Гостю дерево уже пришло без дат и фото живых.
const fan = computed(() => (store.idx && rootId.value && isFan.value ? layoutFan(store.idx, rootId.value, { ...o, hideLiving: o.hideLiving || !canTalk() }) : null));
const scheme = computed(() => layout.value || fan.value);
const plan = computed(() => (fan.value ? fan.value.plan : layout.value?.nodes.length ? planPages(layout.value, o) : null));
const pages = computed(() => (plan.value ? plan.value.cols * plan.value.rows : 0));

// Склейка — на листах принтера (A4 или A3); плакат — только крупнее листа.
const SHEETS = ['A4', 'A3'];
const tiles = computed(() => o.fit === 'tiles');
function toTiles() {
  o.fit = 'tiles';
  if (!SHEETS.includes(o.paper)) o.paper = 'A4';
}
watch(() => [o.fit, o.paper], () => {
  if (tiles.value && PAPER[o.size] && !posters(o.paper).includes(o.size)) o.size = 'read';
});
// Как читается: самый мелкий текст на бумаге (годы жизни у дерева, дальние кольца у веера).
const smallPt = computed(() => (layout.value && plan.value ? TREE_TEXT * plan.value.s : fan.value ? fan.value.minPt : 0));
const legible = computed(() => (plan.value && smallPt.value ? legibility(smallPt.value) : null));
// Мелко — что посоветовать: лист крупнее (у дерева) или склейку «Читаемо» из листов A4.
const advice = computed(() => {
  if (!legible.value || ['ok', 'good'].includes(legible.value.level) || (tiles.value && o.size === 'read')) return null;
  if (!layout.value) return { read: null };
  const ok = (pl) => TREE_TEXT * pl.s >= 6.5;
  const sheet = tiles.value ? o.paper : 'A4';
  const read = planPages(layout.value, { ...o, fit: 'tiles', paper: sheet, size: 'read' });
  const paper = tiles.value ? null : Object.keys(PAPER).filter((p) => PAPER[p][0] > PAPER[o.paper][0]).find((p) => ok(planPages(layout.value, { ...o, paper: p })));
  return { paper, read: read.cols * read.rows, sheet };
});
function readable() {
  if (!tiles.value) toTiles();
  o.size = 'read';
}

// Листы в координатах дерева — для рамок на предпросмотре.
const sheets = computed(() => {
  const p = plan.value;
  if (!p) return [];
  const aw = (p.pw - 2 * p.margin) / p.s;
  const ah = (p.ph - 2 * p.margin - p.head) / p.s;
  const b = scheme.value.bounds;
  const x0 = b.x - p.pad;
  const y0 = b.y - p.pad;
  if (p.cols * p.rows === 1) return [{ x: x0 - (aw - p.cw) / 2, y: y0 - (ah - p.ch) / 2, w: aw, h: ah }];
  const out = [];
  for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) {
    out.push({ x: x0 + c * (aw - p.overlap / p.s), y: y0 + r * (ah - p.overlap / p.s), w: aw, h: ah, n: r * p.cols + c + 1 });
  }
  return out;
});
// Один лист — целиком, с полями и шапкой: заголовок и дата, как в PDF.
const title = computed(() => o.title || kinTitle.value || store.title || 'Семейное древо');
const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const paper = computed(() => {
  const p = plan.value;
  if (!p || pages.value !== 1 || !sheets.value.length) return null;
  const a = sheets.value[0];
  const x = a.x - p.margin / p.s;
  const y = a.y - (p.margin + p.head) / p.s;
  const w = p.pw / p.s;
  return { x, y, w, h: p.ph / p.s, ax: a.x, ty: y + p.margin / p.s, k: 1 / p.s, right: x + w - p.margin / p.s };
});
const box = computed(() => {
  const all = paper.value ? [paper.value] : sheets.value;
  if (!all.length) return { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.min(...all.map((s) => s.x)); const y = Math.min(...all.map((s) => s.y));
  const x2 = Math.max(...all.map((s) => s.x + s.w)); const y2 = Math.max(...all.map((s) => s.y + s.h));
  const m = (x2 - x) * 0.02;
  return { x: x - m, y: y - m, w: x2 - x + 2 * m, h: y2 - y + 2 * m };
});
const viewBox = computed(() => `${box.value.x} ${box.value.y} ${box.value.w} ${box.value.h}`);

// Дерево на предпросмотре — как на бумаге: цвета оформления, имена и годы (shared/treecard.js — то же, что в PDF), фото.
const theme = computed(() => THEMES[o.theme] || THEMES.classic);
const font = computed(() => (o.theme === 'classic' ? '"DejaVu Serif", "PT Serif", serif' : '"DejaVu Sans", "PT Sans", sans-serif'));
const edgesPath = computed(() => (layout.value ? layout.value.edges.filter((e) => !e.dashed)
  .map((e) => e.points.map((p, j) => (j ? 'L' : 'M') + p[0] + ',' + p[1]).join('')).join('') : ''));
const cards = computed(() => {
  if (!layout.value) return [];
  const opts = { photos: o.photos, hideLiving: o.hideLiving || !canTalk() };
  const many = layout.value.nodes.length > 1500; // очень большое дерево — без подписей, чтобы телефон не тормозил
  return layout.value.nodes.filter((n) => n.id && store.idx.persons.has(n.id)).map((n) => {
    const p = store.idx.persons.get(n.id);
    const [fill, stroke] = theme.value[p.sex] || theme.value.U;
    const c = many ? { photo: false, tx: 8, lines: [] } : treeCard(p, opts);
    return { n, fill, stroke, photo: c.photo ? thumbUrl(p.photo_id) : null, tx: c.tx, lines: c.lines };
  });
});

// «Посмотреть крупно»: предпросмотр на весь экран, крупнее и мельче кнопками.
const big = ref(false);
const zoom = ref(1);
function openBig() {
  zoom.value = 1;
  big.value = true;
}
const onKey = (e) => { if (e.key === 'Escape') big.value = false; };
watch(big, (on) => (on ? window.addEventListener('keydown', onKey) : window.removeEventListener('keydown', onKey)));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
const svgStyle = computed(() => (big.value ? { width: `${zoom.value * 100}%`, height: 'auto', aspectRatio: `${box.value.w} / ${box.value.h}` } : {}));

// Роспись на экране — та же сборка, что в PDF (shared/rospis.js); события и источники — с сервера, по правилам приватности.
const hideR = computed(() => o.hideLiving || !canTalk());
const rqs = computed(() => ({
  root: rootId.value || '', gens: String(ro.gens || ''), line: ro.male ? 'male' : 'all', events: ro.events ? '1' : '0', notes: ro.notes ? '1' : '0',
  sources: ro.sources ? '1' : '0', hideLiving: hideR.value ? '1' : '0', theme: o.theme, title: ro.title,
}));
const extras = ref(null);
const extrasFor = computed(() => (isRospis.value && (ro.events || ro.sources)
  ? new URLSearchParams({ events: rqs.value.events, sources: rqs.value.sources, hideLiving: rqs.value.hideLiving }).toString() : ''));
watch([extrasFor, () => store.tree], async ([qs]) => {
  if (!qs) return;
  try {
    const x = await api('GET', `/api/rospis/extras?${qs}`);
    if (extrasFor.value === qs) extras.value = { ...x, qs };
  } catch { /* без событий и источников */ }
}, { immediate: true });
const rospis = computed(() => {
  if (!isRospis.value || !store.idx || !rootId.value) return null;
  const x = extras.value?.qs === extrasFor.value ? extras.value : {};
  return buildRospis(store.idx, rootId.value, parseRospisOptions(rqs.value), x);
});
// Сколько колен всего — для выбора «сколько колен».
const allGens = ref(0);
watch(rospis, (r) => { if (r && !ro.gens) allGens.value = r.count.gens; }, { immediate: true });
const rUrl = (download) => `/api/rospis.pdf?${new URLSearchParams({ ...rqs.value, ...(download ? { download: '1' } : {}) })}`;

const url = (download) => {
  const qs = new URLSearchParams({
    root: rootId.value || '', mode: isTree.value ? view.mode : o.mode, up: kin.value ? kin.value.up : view.up, down: view.down, line: view.line, paper: o.paper, orient: o.orient, fit: o.fit,
    size: o.size, scale: o.scale, photos: o.photos ? '1' : '0', hideLiving: o.hideLiving ? '1' : '0', theme: o.theme, title: o.title,
    ...(isFan.value ? { gens: o.gens, shape: o.shape, colors: o.colors, empty: o.empty ? '1' : '0' } : {}),
  });
  if (download) qs.set('download', '1');
  return `/api/print.pdf?${qs}`;
};
const sizeMm = computed(() => {
  if (!plan.value || pages.value < 2) return '';
  const cm = (v) => Math.round((v * plan.value.s) / MM / 10);
  return `· ${isFan.value ? 'веер' : 'дерево'} около ${cm(plan.value.cw)} × ${cm(plan.value.ch)} см`;
});
const centerPhoto = computed(() => {
  const p = fan.value && store.idx.persons.get(fan.value.center.id);
  return fan.value?.center.photo && p?.photo_id ? thumbUrl(p.photo_id) : null;
});
const fanFont = (l) => ({ 'font-size': l.size, 'font-weight': l.bold ? 700 : 400, 'font-family': o.theme === 'classic' ? '"DejaVu Serif", serif' : '"DejaVu Sans", sans-serif' });
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);
</script>

<template>
  <div class="page">
    <h1>Печать</h1>
    <div v-if="!people.length" class="muted">Сначала добавьте людей в дерево.</div>
    <template v-else>
      <template v-if="rospis">
        <RospisText :r="rospis" />
        <div class="small" style="margin-top:6px">
          <b>{{ rospis.count.gens }} {{ plural(rospis.count.gens, 'колено', 'колена', 'колен') }}, {{ rospis.count.desc }} {{ plural(rospis.count.desc, 'потомок', 'потомка', 'потомков') }}</b>
          <span class="muted"> · в указателе {{ rospis.count.total }} чел.</span>
        </div>
        <div class="row" style="margin:12px 0">
          <a class="btn primary grow" :href="rUrl(false)" target="_blank">Открыть PDF</a>
          <a class="btn grow" :href="rUrl(true)">Скачать</a>
        </div>
      </template>
      <div v-if="plan" class="preview card">
        <Teleport to="body" :disabled="!big">
        <div :class="{ 'big-view': big }" role="dialog" :aria-modal="big" :aria-label="big ? 'Как будет на бумаге' : undefined">
        <div v-if="big" class="big-bar">
          <b class="grow">Как будет на бумаге</b>
          <button @click="zoom = Math.max(1, zoom / 1.5)" :disabled="zoom <= 1" aria-label="Мельче">−</button>
          <button @click="zoom = Math.min(12, zoom * 1.5)" aria-label="Крупнее">+</button>
          <button @click="big = false">Закрыть</button>
        </div>
        <div :class="{ 'big-scroll': big }">
        <svg :viewBox="viewBox" preserveAspectRatio="xMidYMid meet" :style="svgStyle" @click="big || openBig()">
          <defs><clipPath id="pv-ph" clipPathUnits="userSpaceOnUse"><rect x="6" y="6" :width="BOX.h - 12" :height="BOX.h - 12" rx="6" /></clipPath></defs>
          <template v-if="paper">
            <rect :x="paper.x" :y="paper.y" :width="paper.w" :height="paper.h" class="sheet-r" />
            <text :x="paper.ax" :y="paper.ty + 15 * paper.k" :font-size="16 * paper.k" font-weight="700" :fill="theme.title" :font-family="font">{{ title }}</text>
            <text :x="paper.right" :y="paper.ty + 10 * paper.k" :font-size="8 * paper.k" fill="#777777" text-anchor="end" :font-family="font">Составлено {{ today }}</text>
          </template>
          <rect v-for="(s, i) in paper ? [] : sheets" :key="'s' + i" :x="s.x" :y="s.y" :width="s.w" :height="s.h" class="sheet-r" />
          <g v-if="layout" :font-family="font">
            <path :d="edgesPath" fill="none" :stroke="theme.line" stroke-width="1.6" />
            <g v-for="c in cards" :key="c.n.id" :transform="`translate(${c.n.x},${c.n.y})`">
              <rect :width="BOX.w" :height="BOX.h" rx="9" :fill="c.fill" :stroke="c.stroke" :stroke-width="c.n.root ? 3 : 1.4" />
              <image v-if="c.photo" :href="c.photo" x="6" y="6" :width="BOX.h - 12" :height="BOX.h - 12" preserveAspectRatio="xMidYMid slice" clip-path="url(#pv-ph)" />
              <text v-for="(l, j) in c.lines" :key="j" :x="c.tx" :y="l.y + l.size * 0.93" :font-size="l.size" :font-weight="l.bold ? 700 : 400" :fill="l.color">{{ l.text }}</text>
            </g>
          </g>
          <g v-else class="fan">
            <path v-for="s in fan.sectors" :key="'f' + s.k" :d="sectorPath(s)" :fill="s.fill" :stroke="fan.line" :stroke-width="(s.id ? 0.9 : 0.4) / plan.s" />
            <path :d="fan.shape === 180 ? `M${-fan.center.r1},0A${fan.center.r1},${fan.center.r1} 0 0 1 ${fan.center.r1},0Z` : `M${-fan.center.r1},0A${fan.center.r1},${fan.center.r1} 0 1 1 ${fan.center.r1},0A${fan.center.r1},${fan.center.r1} 0 1 1 ${-fan.center.r1},0Z`"
              :fill="fan.center.fill" :stroke="fan.line" :stroke-width="1.4 / plan.s" />
            <image v-if="centerPhoto" :href="centerPhoto" :x="fan.center.photo.x" :y="fan.center.photo.y" :width="fan.center.photo.w" :height="fan.center.photo.h" preserveAspectRatio="xMidYMid slice" />
            <text v-for="(l, i) in [...fan.sectors.flatMap((s) => s.lines), ...fan.center.lines]" :key="'l' + i" :x="l.x" :y="l.y" :transform="`rotate(${l.rot} ${l.x} ${l.y})`" :style="fanFont(l)">{{ l.text }}</text>
          </g>
          <text v-for="(s, i) in sheets.length > 1 ? sheets : []" :key="'t' + i" :x="s.x + s.w / 2" :y="s.y + s.h / 2" class="num" :font-size="Math.min(s.w, s.h) / 3">{{ s.n }}</text>
        </svg>
        </div>
        </div>
        </Teleport>
        <button class="ghost more" @click="openBig">Посмотреть крупно</button>
        <div class="small" style="margin-top:6px">
          <b>{{ pages }} {{ pages === 1 ? 'лист' : pages < 5 ? 'листа' : 'листов' }} {{ o.paper }}</b>,
          {{ plan.orient === 'landscape' ? 'альбомная' : 'книжная' }} · {{ layout ? layout.nodes.length : fan.people }} чел. <span class="muted">{{ sizeMm }}</span>
        </div>
        <div v-if="legible" class="small" style="margin-top:2px">
          Текст: <span :class="['leg', legible.level]">{{ legible.text }}</span>
          <span class="muted"> ({{ layout ? 'имена' : 'самое мелкое' }} {{ Math.round(layout ? smallPt * 1.25 : smallPt) }} пт)</span>
        </div>
        <div v-if="advice" class="banner" style="margin:6px 0 0">
          <template v-if="advice.read">Чтобы читалось:
            <template v-if="advice.paper">лист {{ advice.paper }} или </template>склеить из {{ advice.read }} {{ plural(advice.read, 'листа', 'листов', 'листов') }} {{ advice.sheet }}.
          </template>
          <template v-else>Чтобы читалось, склейте плакат из листов — размер подберётся сам.</template>
          <div class="row" style="margin-top:6px">
            <button v-if="advice.paper" class="grow" @click="o.paper = advice.paper">Лист {{ advice.paper }}</button>
            <button class="grow" @click="readable">Склеить — читаемо</button>
          </div>
        </div>
        <p v-if="fan?.crowded" class="banner" style="margin:6px 0 0">
          {{ fan.crowded }} {{ plural(fan.crowded, 'имя не помещается', 'имени не помещаются', 'имён не помещаются') }} даже мелким шрифтом —
          возьмите лист крупнее или «Склеить из листов».
        </p>
      </div>

      <div v-if="plan" class="row" style="margin:12px 0">
        <a class="btn primary grow" :href="url(false)" target="_blank">Открыть PDF</a>
        <a class="btn grow" :href="url(true)">Скачать</a>
      </div>

      <label class="field"><span>{{ isRospis ? 'Родоначальник' : 'Кто в центре' }}</span>
        <select v-model="rootSel"><option value="">{{ !isTree && treeRoot ? `Как на дереве: ${fullName(store.idx.persons.get(treeRoot))}` : store.me?.person_id ? 'Я' : home ? `${fullName(store.idx.persons.get(home))} (начало дерева)` : 'Начало дерева' }}</option><option v-for="p in people" :key="p.id" :value="p.id">{{ fullName(p) }}</option></select>
      </label>
      <div class="field"><div class="seg">
        <button :class="{ on: isTree }" @click="treeMode()">Дерево</button>
        <button :class="{ on: isFan }" @click="o.mode = 'fan'">Веер предков</button>
        <button :class="{ on: isRospis }" @click="o.mode = 'rospis'">Роспись</button>
      </div></div>
      <template v-if="isRospis">
        <p class="muted small" style="margin-top:0">Все потомки по коленам, у каждого свой номер; браки, дети со ссылками на номера, в конце — указатель имён. Читается как книга.</p>
        <div class="field"><span class="small muted">Сколько колен</span>
          <div class="chips">
            <button class="chip" :class="{ on: !ro.gens }" @click="ro.gens = 0">Все</button>
            <button v-for="g in Math.max(0, Math.min(Math.max(allGens, ro.gens + 1), 15) - 2)" :key="g" class="chip" :class="{ on: ro.gens === g + 1 }" @click="ro.gens = g + 1">{{ g + 1 }}</button>
          </div>
        </div>
        <label class="row field check"><input type="checkbox" v-model="ro.male" /> Только по мужской линии (фамильная роспись)</label>
        <h2>Что писать о каждом</h2>
        <label class="row field check"><input type="checkbox" v-model="ro.events" /> События жизни</label>
        <label class="row field check"><input type="checkbox" v-model="ro.notes" /> Заметки</label>
        <label class="row field check"><input type="checkbox" v-model="ro.sources" /> Источники</label>
        <p class="muted small">Даты и места рождения и смерти, род занятий, браки и дети пишутся всегда.</p>
      </template>
      <template v-if="isTree">
        <div class="field"><div class="seg two">
          <button :class="{ on: view.mode === 'all' }" @click="treeMode('all')">Всё дерево</button>
          <button :class="{ on: view.mode === 'hourglass' }" @click="treeMode('hourglass')">Ветка</button>
          <button :class="{ on: view.mode === 'ancestors' }" @click="treeMode('ancestors')">Предки</button>
          <button :class="{ on: view.mode === 'descendants' }" @click="treeMode('descendants')">Потомки</button>
          <button :class="{ on: isKin }" class="span" @click="treeMode('kin')">Родня</button>
        </div></div>
        <p class="muted small" style="margin-top:0">Печатается то же, что сейчас на экране «Дерево». Поменяете здесь — поменяется и там.
          <router-link to="/tree">Открыть дерево</router-link></p>
      </template>
      <template v-if="isKin">
        <p class="muted small" style="margin-top:0">Кровные родственники по одной линии или с обеих сторон: сверху — общие предки, под ними все их дети, внуки и правнуки с мужьями и жёнами.</p>
        <div class="field" v-if="lines.length"><span class="small muted">По какой линии</span>
          <div class="chips"><button v-for="l in lines" :key="l.key" class="chip" :class="{ on: kin?.key === l.key }" @click="pickLine(l)">{{ l.text[0].toUpperCase() + l.text.slice(1) }}</button></div>
        </div>
        <p v-else class="banner">У этого человека в дереве не указаны родители — родню не от кого показать. Выберите другого.</p>
        <div class="field" v-if="kin && kin.max > kin.min"><span class="small muted">Поколений вверх</span>
          <div class="chips"><button v-for="g in Math.min(kin.max, 12) - kin.min + 1" :key="g" class="chip" :class="{ on: kin.up === g + kin.min - 1 }" @click="view.kinUp = g + kin.min - 1">{{ g + kin.min - 1 }}</button></div>
        </div>
      </template>
      <template v-if="isFan">
        <div class="field"><span class="small muted">Поколений</span>
          <div class="chips"><button v-for="g in FAN.gens[1] - FAN.gens[0] + 1" :key="g" class="chip" :class="{ on: o.gens === g + FAN.gens[0] - 1 }" @click="o.gens = g + FAN.gens[0] - 1">{{ g + FAN.gens[0] - 1 }}</button></div>
        </div>
        <div class="field"><div class="seg">
          <button :class="{ on: o.shape === 180 }" @click="o.shape = 180">Полукруг</button>
          <button :class="{ on: o.shape === 270 }" @click="o.shape = 270">Три четверти</button>
          <button :class="{ on: o.shape === 360 }" @click="o.shape = 360">Круг</button>
        </div></div>
        <div class="field"><span class="small muted">Цвет</span><div class="seg">
          <button :class="{ on: o.colors === 'branch' }" @click="o.colors = 'branch'">Линии отца и матери</button>
          <button :class="{ on: o.colors === 'gens' }" @click="o.colors = 'gens'">По поколениям</button>
        </div></div>
        <label class="row field check"><input type="checkbox" v-model="o.empty" /> Показывать пустые места — вписать неизвестных от руки</label>
      </template>
      <div class="grid2" v-else-if="isTree && view.mode !== 'all' && !isKin">
        <label class="field" v-if="view.mode !== 'descendants'"><span>Поколений вверх</span><input type="number" min="1" max="12" v-model.number="view.up" /></label>
        <label class="field" v-if="view.mode !== 'ancestors'"><span>Поколений вниз</span><input type="number" min="1" max="12" v-model.number="view.down" /></label>
      </div>

      <p class="muted small" v-if="isTree && view.mode === 'all'" style="margin-top:0">Все, кто связан с выбранным человеком родством и браками, — каждый один раз. Большое дерево удобнее «Склеить из листов».</p>
      <template v-if="!isRospis">
      <h2>Как напечатать</h2>
      <div class="field"><div class="seg">
        <button :class="{ on: !tiles }" @click="o.fit = 'page'">На одном листе</button>
        <button :class="{ on: tiles }" @click="toTiles">Склеить из листов</button>
      </div></div>
      <template v-if="!tiles">
        <div class="field"><span class="small muted">Размер листа</span>
          <div class="chips"><button v-for="p in Object.keys(PAPER)" :key="p" class="chip" :class="{ on: o.paper === p }" @click="o.paper = p">{{ p }}</button></div>
        </div>
        <p class="muted small" style="margin-top:0">{{ o.paper }} — {{ PAPER[o.paper][0] / 10 }} × {{ PAPER[o.paper][1] / 10 }} см.
          {{ SHEETS.includes(o.paper) ? 'Напечатать на домашнем или офисном принтере.' : 'Такой лист печатают в копицентре или типографии: скачайте PDF и отнесите им.' }}</p>
      </template>
      <template v-else>
        <div class="field"><span class="small muted">Лист принтера</span>
          <div class="chips"><button v-for="p in SHEETS" :key="p" class="chip" :class="{ on: o.paper === p }" @click="o.paper = p">{{ p }}</button></div>
        </div>
        <div class="field"><span class="small muted">Размер плаката</span>
          <div class="chips">
            <button class="chip" :class="{ on: o.size === 'read' }" @click="o.size = 'read'">Читаемо</button>
            <button v-for="p in posters(o.paper)" :key="p" class="chip" :class="{ on: o.size === p }" @click="o.size = p">{{ p }}</button>
            <button class="chip" :class="{ on: o.size === 'scale' }" @click="o.size = 'scale'">Своя крупность</button>
          </div>
        </div>
        <p class="muted small" style="margin-top:0" v-if="o.size === 'read'">Буквы крупные, как в книге; листов — сколько понадобится.</p>
        <p class="muted small" style="margin-top:0" v-else-if="PAPER[o.size]">{{ isFan ? 'Веер' : 'Дерево' }} растянется на плакат {{ o.size }} ({{ PAPER[o.size][0] / 10 }} × {{ PAPER[o.size][1] / 10 }} см), склеенный из листов {{ o.paper }}.</p>
        <label class="field" v-else><span>Крупность: {{ o.scale }}%<template v-if="!isFan"> (карточка около {{ Math.round(42 * o.scale / 100) }} мм)</template></span>
          <input type="range" min="40" max="250" step="10" v-model.number="o.scale" />
        </label>
        <p class="muted small">Печатайте в натуральную величину: в окне печати — масштаб 100 % («Фактический размер»), не «Уместить на странице».
          Пунктир показывает, где накладывать соседний лист (1 см); в углу каждого листа — его место на плакате.</p>
      </template>
      <div class="field"><span v-if="tiles" class="small muted">Как класть лист</span><div class="seg">
        <button :class="{ on: o.orient === 'auto' }" @click="o.orient = 'auto'">Сама</button>
        <button :class="{ on: o.orient === 'portrait' }" @click="o.orient = 'portrait'">Книжная</button>
        <button :class="{ on: o.orient === 'landscape' }" @click="o.orient = 'landscape'">Альбомная</button>
      </div></div>
      </template>

      <h2>Оформление</h2>
      <div class="chips">
        <button class="chip" :class="{ on: o.theme === 'classic' }" @click="o.theme = 'classic'">Классика</button>
        <button class="chip" :class="{ on: o.theme === 'modern' }" @click="o.theme = 'modern'">Современное</button>
        <button class="chip" :class="{ on: o.theme === 'bw' }" @click="o.theme = 'bw'">Чёрно-белое</button>
      </div>
      <label v-if="isRospis" class="field"><span>Заголовок</span><input v-model="ro.title" placeholder="Поколенная роспись" /></label>
      <label v-else class="field"><span>Заголовок</span><input v-model="o.title" :placeholder="kinTitle || store.title" /></label>
      <label v-if="!isRospis" class="row field check"><input type="checkbox" v-model="o.photos" /> {{ isFan ? 'Фото в середине' : 'Фотографии' }}</label>
      <label v-if="canTalk()" class="row field"><input type="checkbox" v-model="o.hideLiving" /> Скрыть даты и фото живых — для печати не для семьи</label>
      <p v-else class="muted small">Даты и фото живых родственников на печати не показываются.</p>
    </template>
  </div>
</template>

<style scoped>
.preview svg { width: 100%; height: 260px; display: block; background: var(--bg); border-radius: 8px; cursor: zoom-in; }
@media (min-width: 64em) { .preview svg { height: 420px; } }
.sheet-r { fill: #fff; stroke: #999; stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.more { margin-top: 4px; padding-left: 0; padding-right: 0; color: var(--accent-text); min-height: 2.444rem; }
.big-view { position: fixed; inset: 0; z-index: 70; background: var(--bg); display: flex; flex-direction: column; }
.big-bar { display: flex; align-items: center; gap: 0.444rem; padding: calc(0.556rem + var(--safe-t)) 0.667rem 0.556rem; border-bottom: 1px solid var(--line); background: var(--card); }
.big-bar button { min-height: 2.667rem; padding: 0.25rem 0.889rem; }
.big-bar button[aria-label] { width: 3rem; padding: 0; font-size: 1.444rem; font-weight: 400; }
.big-scroll { flex: 1; overflow: auto; padding: 0.667rem; }
.big-view svg { display: block; margin: 0 auto; background: var(--bg); cursor: default; }
.fan text { text-anchor: middle; dominant-baseline: central; fill: #1d1d1d; }
.num { fill: rgba(0,0,0,.18); text-anchor: middle; dominant-baseline: middle; font-weight: 700; }
.seg.two { display: grid; grid-template-columns: 1fr 1fr; }
.seg.two .span { grid-column: 1 / -1; }
.check { align-items: flex-start; min-height: 2.667rem; }
.check input { flex: none; margin: 0.111rem 0 0; }
.leg.bad { color: var(--danger); font-weight: 600; }
.leg.warn { color: var(--oral); font-weight: 600; }
.leg.good, .leg.ok { color: var(--accent-text); }
</style>
