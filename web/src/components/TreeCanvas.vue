<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { BOX } from '@shared/layout.js';
import { shortName, lifespan } from '@shared/names.js';
import { photoUrl } from '../api.js';

const props = defineProps({ layout: Object, idx: Object, selectedId: String, focusId: String });
const emit = defineEmits(['select', 'placeholder', 'open']);

const el = ref(null);
const size = reactive({ w: 360, h: 600 });
const view = reactive({ x: 0, y: 0, k: 0.95 });
const MAX = 3;
// Мельче всего — чтобы и большое «всё дерево» влезало целиком.
const fitK = () => {
  const b = props.layout.bounds;
  return b.w ? Math.min((size.w - 32) / b.w, (size.h - 140) / b.h) : 1;
};
const minK = () => Math.min(0.06, fitK());

const detail = computed(() => (view.k < 0.22 ? 0 : view.k < 0.45 ? 1 : 2));

// Рисуем только то, что видно на экране, чтобы большое дерево не тормозило.
const visible = computed(() => {
  const pad = 200;
  const x0 = (-view.x - pad) / view.k;
  const y0 = (-view.y - pad) / view.k;
  const x1 = (size.w - view.x + pad) / view.k;
  const y1 = (size.h - view.y + pad) / view.k;
  return props.layout.nodes.filter((n) => n.x + BOX.w > x0 && n.x < x1 && n.y + BOX.h > y0 && n.y < y1);
});
// Линии — одним путём (сплошные и пунктир отдельно) и тоже только видимые: тысячи линий не тормозят.
const edgeBoxes = computed(() => props.layout.edges.map((e) => {
  const xs = e.points.map((p) => p[0]);
  const ys = e.points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}));
const edgePaths = computed(() => {
  const pad = 200;
  const x0 = (-view.x - pad) / view.k;
  const y0 = (-view.y - pad) / view.k;
  const x1 = (size.w - view.x + pad) / view.k;
  const y1 = (size.h - view.y + pad) / view.k;
  let solid = '';
  let dashed = '';
  props.layout.edges.forEach((e, i) => {
    const b = edgeBoxes.value[i];
    if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) return;
    if (e.dashed) dashed += pathOf(e);
    else solid += pathOf(e);
  });
  return { solid, dashed };
});

// Очень мелко и людей много — рамки тремя путями (мужчины, женщины, остальные): быстро даже на 4000 человек.
const bulk = computed(() => detail.value === 0 && visible.value.length > 300);
const bulkPaths = computed(() => {
  if (!bulk.value) return null;
  const out = { M: '', F: '', U: '' };
  for (const n of visible.value) {
    const p = n.id && props.idx.persons.get(n.id);
    if (!p) continue;
    out[p.sex === 'M' || p.sex === 'F' ? p.sex : 'U'] += `M${n.x},${n.y}h${BOX.w}v${BOX.h}h${-BOX.w}z`;
  }
  return out;
});
const marked = computed(() => (bulk.value ? props.layout.nodes.filter((n) => n.id && (n.root || n.id === props.selectedId)) : []));

function pathOf(e) {
  return e.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');
}

function centerOn(id, k = view.k) {
  const n = props.layout.nodes.find((x) => x.id === id) || props.layout.nodes[0];
  if (!n) return;
  view.k = k;
  view.x = size.w / 2 - (n.x + BOX.w / 2) * k;
  view.y = size.h * 0.45 - (n.y + BOX.h / 2) * k;
}

// Уместить всё дерево. top и bottom — сколько сверху и снизу закрыто кнопками;
// minK — мельче не делать: тогда ничего не меняется и возвращается false.
function fitAll({ top = 90, bottom = 50 } = {}, minK = 0) {
  const b = props.layout.bounds;
  if (!b.w) return false;
  const h = Math.max(size.h - top - bottom, size.h / 3);
  const k = Math.min(1.2, (size.w - 32) / b.w, h / b.h);
  if (k < minK) return false;
  view.k = k;
  view.x = (size.w - b.w * k) / 2 - b.x * k;
  view.y = top + (h - b.h * k) / 2 - b.y * k;
  return true;
}

function zoomAt(factor, cx = size.w / 2, cy = size.h / 2) {
  const k = Math.min(MAX, Math.max(minK(), view.k * factor));
  const f = k / view.k;
  view.x = cx - (cx - view.x) * f;
  view.y = cy - (cy - view.y) * f;
  view.k = k;
}

defineExpose({ centerOn, fitAll, zoomAt });

// ---------- жесты ----------
const pointers = new Map();
let moved = false;
let lastPinch = null;
let lastTap = 0;
let downAt = null;

function local(e) {
  const r = el.value.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onDown(e) {
  el.value.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, local(e));
  if (pointers.size === 1) { moved = false; downAt = local(e); }
  lastPinch = null;
}

function onMove(e) {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  const cur = local(e);
  pointers.set(e.pointerId, cur);
  if (pointers.size === 1) {
    if (downAt && Math.hypot(cur.x - downAt.x, cur.y - downAt.y) > 8) moved = true;
    if (moved) { view.x += cur.x - prev.x; view.y += cur.y - prev.y; }
  } else if (pointers.size === 2) {
    moved = true;
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (lastPinch) {
      zoomAt(d / lastPinch.d, m.x, m.y);
      view.x += m.x - lastPinch.m.x;
      view.y += m.y - lastPinch.m.y;
    }
    lastPinch = { d, m };
  }
}

function onUp(e) {
  pointers.delete(e.pointerId);
  lastPinch = null;
  if (pointers.size || moved) return;
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node]');
  const now = Date.now();
  if (target) {
    const n = props.layout.nodes[Number(target.dataset.node)];
    if (n.placeholder) emit('placeholder', n.placeholder);
    else if (now - lastTap < 320 && props.selectedId === n.id) emit('open', n.id);
    else emit('select', n.id);
  } else if (now - lastTap < 320) {
    const p = local(e);
    zoomAt(1.8, p.x, p.y);
  } else {
    emit('select', null);
  }
  lastTap = now;
}

function onWheel(e) {
  e.preventDefault();
  const p = local(e);
  if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)), p.x, p.y);
  else view.x -= e.deltaX;
}

let ro;
onMounted(() => {
  ro = new ResizeObserver(([entry]) => {
    const first = size.w === 360 && size.h === 600;
    size.w = entry.contentRect.width;
    size.h = entry.contentRect.height;
    if (first) centerOn(props.focusId);
  });
  ro.observe(el.value);
  el.value.addEventListener('wheel', onWheel, { passive: false });
});
onBeforeUnmount(() => ro?.disconnect());

watch(() => props.focusId, (id) => centerOn(id));

const nodeIndex = computed(() => new Map(props.layout.nodes.map((n, i) => [n, i])));
const person = (n) => props.idx.persons.get(n.id);
const relLabel = { father: 'Добавить отца', mother: 'Добавить мать' };
const textW = (n) => BOX.w - (detail.value === 2 && person(n).photo_id ? BOX.h : 10) - 8;

// Обрезка по настоящей ширине текста; когда шрифт догрузится — пересчитать.
const fontsReady = ref(0);
document.fonts?.ready.then(() => fontsReady.value++);
const measure = document.createElement('canvas').getContext('2d');
const FONT = getComputedStyle(document.body).fontFamily || 'sans-serif';
function fit(str, w, fs, bold) {
  if (!str) return str;
  fontsReady.value; // зависимость: перерисовать после загрузки шрифта
  measure.font = `${bold ? 700 : 400} ${fs}px ${FONT}`;
  if (measure.measureText(str).width <= w) return str;
  let n = str.length - 1;
  while (n > 1 && measure.measureText(str.slice(0, n) + '…').width > w) n--;
  return str.slice(0, n) + '…';
}
</script>

<template>
  <div ref="el" class="canvas" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
    <svg :width="size.w" :height="size.h">
      <defs>
        <clipPath id="ph" clipPathUnits="objectBoundingBox"><rect width="1" height="1" rx=".18" /></clipPath>
      </defs>
      <g :transform="`translate(${view.x},${view.y}) scale(${view.k})`" :class="{ far: detail === 0 }">
        <path v-if="edgePaths.solid" :d="edgePaths.solid" class="edge" />
        <path v-if="edgePaths.dashed" :d="edgePaths.dashed" class="edge dashed" />
        <template v-if="bulk">
          <path v-for="(d, sex) in bulkPaths" :key="'b' + sex" :d="d" class="box" :class="sex" />
          <rect v-for="n in marked" :key="'m' + n.id" :x="n.x" :y="n.y" :width="BOX.w" :height="BOX.h" rx="12" class="box" :class="[person(n).sex, { root: n.root, sel: n.id === selectedId }]" />
        </template>
        <template v-else>
        <g v-for="n in visible" :key="n.id || n.placeholder.of + n.placeholder.relation" :data-node="nodeIndex.get(n)" :transform="`translate(${n.x},${n.y})`">
          <template v-if="n.placeholder">
            <rect :width="BOX.w" :height="BOX.h" rx="12" class="ph" />
            <text :x="BOX.w / 2" :y="BOX.h / 2 + 6" text-anchor="middle" class="ph-t">{{ relLabel[n.placeholder.relation] }}</text>
          </template>
          <template v-else-if="person(n)">
            <rect :width="BOX.w" :height="BOX.h" rx="12" class="box" :class="[person(n).sex, { root: n.root, sel: n.id === selectedId, dead: !person(n).living }]" />
            <template v-if="detail > 0">
              <image v-if="detail === 2 && person(n).photo_id" :href="photoUrl(person(n).photo_id)" x="6" y="6" :width="BOX.h - 12" :height="BOX.h - 12" preserveAspectRatio="xMidYMid slice" clip-path="url(#ph)" />
              <g :transform="`translate(${detail === 2 && person(n).photo_id ? BOX.h : 10}, 0)`">
                <text :y="detail === 1 ? 30 : 25" class="t1" :class="{ big: detail === 1 }">{{ fit(shortName(person(n)).last || shortName(person(n)).first, textW(n), detail === 1 ? 24 : 18, true) }}</text>
                <text v-if="detail === 2 && shortName(person(n)).last" y="46" class="t2">{{ fit(shortName(person(n)).first, textW(n), 16) }}</text>
                <text v-if="detail === 2" y="66" class="t3">{{ fit(lifespan(person(n)), textW(n), 15) }}</text>
                <text v-if="detail === 1" y="62" class="t1 big">{{ fit(person(n).given, textW(n), 24, true) }}</text>
              </g>
            </template>
          </template>
        </g>
        </template>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.canvas { position: absolute; inset: 0; touch-action: none; user-select: none; -webkit-user-select: none; overflow: hidden; cursor: grab; }
svg { display: block; }
.edge { fill: none; stroke: var(--edge); stroke-width: 2.5; }
.edge.dashed { stroke-dasharray: 7 6; }
/* Совсем мелко (всё большое дерево целиком): линии и рамки тонкие, но видны. */
.far .edge, .far .box { vector-effect: non-scaling-stroke; stroke-width: 1.2; }
.box { fill: var(--card); stroke: var(--field); stroke-width: 2.5; }
.box.M { fill: var(--male-soft); stroke: var(--male); }
.box.F { fill: var(--female-soft); stroke: var(--female); }
.box.root { stroke-width: 4; }
.box.sel { stroke: var(--accent); stroke-width: 6; }
.ph { fill: transparent; stroke: var(--field); stroke-width: 2.5; stroke-dasharray: 8 6; }
.ph-t { fill: var(--muted); font-size: 18px; font-weight: 700; }
text { fill: var(--text); pointer-events: none; }
.t1 { font-size: 18px; font-weight: 700; }
.t1.big { font-size: 24px; }
.t2 { font-size: 16px; }
.t3 { font-size: 15px; }
</style>
