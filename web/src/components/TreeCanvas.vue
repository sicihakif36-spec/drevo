<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { BOX } from '@shared/layout.js';
import { shortName, lifespan } from '@shared/names.js';
import { photoUrl } from '../api.js';

const props = defineProps({ layout: Object, idx: Object, selectedId: String, focusId: String });
const emit = defineEmits(['select', 'placeholder', 'open']);

const el = ref(null);
const size = reactive({ w: 360, h: 600 });
const view = reactive({ x: 0, y: 0, k: 0.65 });
const MIN = 0.06;
const MAX = 3;

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

function fitAll() {
  const b = props.layout.bounds;
  if (!b.w) return;
  const k = Math.max(MIN, Math.min(1.2, Math.min((size.w - 32) / b.w, (size.h - 140) / b.h)));
  view.k = k;
  view.x = (size.w - b.w * k) / 2 - b.x * k;
  view.y = (size.h - b.h * k) / 2 - b.y * k + 20;
}

function zoomAt(factor, cx = size.w / 2, cy = size.h / 2) {
  const k = Math.min(MAX, Math.max(MIN, view.k * factor));
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
const relLabel = { father: '+ отец', mother: '+ мать' };
const textW = (n) => BOX.w - (detail.value === 2 && person(n).photo_id ? BOX.h : 10) - 8;
function fit(str, w, fs) {
  const max = Math.floor(w / (fs * 0.56));
  return str && str.length > max ? str.slice(0, Math.max(1, max - 1)) + '…' : str;
}
</script>

<template>
  <div ref="el" class="canvas" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
    <svg :width="size.w" :height="size.h">
      <defs>
        <clipPath id="ph" clipPathUnits="objectBoundingBox"><rect width="1" height="1" rx=".18" /></clipPath>
      </defs>
      <g :transform="`translate(${view.x},${view.y}) scale(${view.k})`">
        <path v-for="(e, i) in layout.edges" :key="'e' + i" :d="pathOf(e)" class="edge" :class="{ dashed: e.dashed }" />
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
                <text y="26" class="t1" :class="{ big: detail === 1 }">{{ fit(shortName(person(n)).last || shortName(person(n)).first, textW(n), detail === 1 ? 22 : 16) }}</text>
                <text v-if="detail === 2 && shortName(person(n)).last" y="46" class="t2">{{ fit(shortName(person(n)).first, textW(n), 14) }}</text>
                <text v-if="detail === 2" y="65" class="t3">{{ lifespan(person(n)) }}</text>
                <text v-if="detail === 1" y="58" class="t1 big">{{ fit(person(n).given, textW(n), 22) }}</text>
              </g>
            </template>
          </template>
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.canvas { position: absolute; inset: 0; touch-action: none; user-select: none; -webkit-user-select: none; overflow: hidden; cursor: grab; }
svg { display: block; }
.edge { fill: none; stroke: var(--muted); stroke-width: 2; }
.edge.dashed { stroke-dasharray: 6 6; opacity: .6; }
.box { fill: var(--card); stroke: var(--line); stroke-width: 2; }
.box.M { fill: var(--male-soft); stroke: var(--male); }
.box.F { fill: var(--female-soft); stroke: var(--female); }
.box.dead { stroke-dasharray: none; opacity: .92; }
.box.root { stroke-width: 4; }
.box.sel { stroke: var(--accent); stroke-width: 5; }
.ph { fill: transparent; stroke: var(--muted); stroke-width: 2; stroke-dasharray: 8 6; }
.ph-t { fill: var(--muted); font-size: 17px; }
text { fill: var(--text); pointer-events: none; }
.t1 { font-size: 16px; font-weight: 700; }
.t1.big { font-size: 22px; }
.t2 { font-size: 14px; }
.t3 { font-size: 13px; fill: var(--muted); }
</style>
