<script setup>
import { computed, reactive, watch } from 'vue';
import { store, canTalk } from '../store.js';
import { layoutTree, BOX } from '@shared/layout.js';
import { planPages, PAPER, MM } from '@shared/printplan.js';
import { fullName } from '@shared/names.js';

const saved = (() => { try { return JSON.parse(localStorage.getItem('drevo.print') || '{}'); } catch { return {}; } })();
const o = reactive({
  root: '', mode: 'hourglass', up: 4, down: 3, paper: 'A4', orient: 'auto', fit: 'page', scale: 100,
  photos: true, hideLiving: false, theme: 'classic', title: '', ...saved,
});
watch(o, () => { try { localStorage.setItem('drevo.print', JSON.stringify(o)); } catch {} });

const people = computed(() => [...(store.idx?.persons.values() || [])].sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru')));
const rootId = computed(() => (store.idx?.persons.has(o.root) ? o.root : store.me?.person_id && store.idx?.persons.has(store.me.person_id) ? store.me.person_id : people.value[0]?.id));
const layout = computed(() => (store.idx && rootId.value ? layoutTree(store.idx, rootId.value, { mode: o.mode, up: o.up, down: o.down }) : null));
const plan = computed(() => (layout.value?.nodes.length ? planPages(layout.value, o) : null));
const pages = computed(() => (plan.value ? plan.value.cols * plan.value.rows : 0));

// Листы в координатах дерева — для рамок на предпросмотре.
const sheets = computed(() => {
  const p = plan.value;
  if (!p) return [];
  const aw = (p.pw - 2 * p.margin) / p.s;
  const ah = (p.ph - 2 * p.margin - p.head) / p.s;
  const b = layout.value.bounds;
  const x0 = b.x - p.pad;
  const y0 = b.y - p.pad;
  if (p.cols * p.rows === 1) return [{ x: x0 - (aw - p.cw) / 2, y: y0 - (ah - p.ch) / 2, w: aw, h: ah }];
  const out = [];
  for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) {
    out.push({ x: x0 + c * (aw - p.overlap / p.s), y: y0 + r * (ah - p.overlap / p.s), w: aw, h: ah, n: r * p.cols + c + 1 });
  }
  return out;
});
const viewBox = computed(() => {
  const all = sheets.value;
  if (!all.length) return '0 0 1 1';
  const x = Math.min(...all.map((s) => s.x)); const y = Math.min(...all.map((s) => s.y));
  const x2 = Math.max(...all.map((s) => s.x + s.w)); const y2 = Math.max(...all.map((s) => s.y + s.h));
  const m = (x2 - x) * 0.02;
  return `${x - m} ${y - m} ${x2 - x + 2 * m} ${y2 - y + 2 * m}`;
});

const url = (download) => {
  const qs = new URLSearchParams({
    root: rootId.value || '', mode: o.mode, up: o.up, down: o.down, paper: o.paper, orient: o.orient, fit: o.fit,
    scale: o.scale, photos: o.photos ? '1' : '0', hideLiving: o.hideLiving ? '1' : '0', theme: o.theme, title: o.title,
  });
  if (download) qs.set('download', '1');
  return `/api/print.pdf?${qs}`;
};
const sizeMm = computed(() => {
  if (!plan.value || pages.value < 2) return '';
  const cm = (v) => Math.round((v * plan.value.s) / MM / 10);
  return `· дерево около ${cm(plan.value.cw)} × ${cm(plan.value.ch)} см`;
});
</script>

<template>
  <div class="page">
    <h1>Печать</h1>
    <div v-if="!plan" class="muted">Сначала добавьте людей в дерево.</div>
    <template v-else>
      <div class="preview card">
        <svg :viewBox="viewBox" preserveAspectRatio="xMidYMid meet">
          <rect v-for="(s, i) in sheets" :key="'s' + i" :x="s.x" :y="s.y" :width="s.w" :height="s.h" class="sheet-r" />
          <path v-for="(e, i) in layout.edges" :key="'e' + i" :d="e.points.map((p, j) => (j ? 'L' : 'M') + p[0] + ',' + p[1]).join('')" class="ln" />
          <rect v-for="(n, i) in layout.nodes" :key="'n' + i" :x="n.x" :y="n.y" :width="BOX.w" :height="BOX.h" rx="10" :class="['nd', store.idx.persons.get(n.id)?.sex]" />
          <text v-for="(s, i) in sheets.length > 1 ? sheets : []" :key="'t' + i" :x="s.x + s.w / 2" :y="s.y + s.h / 2" class="num">{{ s.n }}</text>
        </svg>
        <div class="small" style="margin-top:6px">
          <b>{{ pages }} {{ pages === 1 ? 'лист' : pages < 5 ? 'листа' : 'листов' }} {{ o.paper }}</b>,
          {{ plan.orient === 'landscape' ? 'альбомная' : 'книжная' }} · {{ layout.nodes.length }} чел. <span class="muted">{{ sizeMm }}</span>
        </div>
      </div>

      <div class="row" style="margin:12px 0">
        <a class="btn primary grow" :href="url(false)" target="_blank">Открыть PDF</a>
        <a class="btn grow" :href="url(true)">Скачать</a>
      </div>

      <label class="field"><span>Кто в центре</span>
        <select v-model="o.root"><option value="">{{ store.me?.person_id ? 'Я' : 'Первый в списке' }}</option><option v-for="p in people" :key="p.id" :value="p.id">{{ fullName(p) }}</option></select>
      </label>
      <div class="field"><div class="seg">
        <button :class="{ on: o.mode === 'ancestors' }" @click="o.mode = 'ancestors'">Предки</button>
        <button :class="{ on: o.mode === 'hourglass' }" @click="o.mode = 'hourglass'">Предки и потомки</button>
        <button :class="{ on: o.mode === 'descendants' }" @click="o.mode = 'descendants'">Потомки</button>
      </div></div>
      <div class="grid2">
        <label class="field" v-if="o.mode !== 'descendants'"><span>Поколений вверх</span><input type="number" min="1" max="12" v-model.number="o.up" /></label>
        <label class="field" v-if="o.mode !== 'ancestors'"><span>Поколений вниз</span><input type="number" min="1" max="12" v-model.number="o.down" /></label>
      </div>

      <h2>Бумага</h2>
      <div class="chips"><button v-for="p in Object.keys(PAPER)" :key="p" class="chip" :class="{ on: o.paper === p }" @click="o.paper = p">{{ p }}</button></div>
      <div class="field"><div class="seg">
        <button :class="{ on: o.orient === 'auto' }" @click="o.orient = 'auto'">Сама</button>
        <button :class="{ on: o.orient === 'portrait' }" @click="o.orient = 'portrait'">Книжная</button>
        <button :class="{ on: o.orient === 'landscape' }" @click="o.orient = 'landscape'">Альбомная</button>
      </div></div>
      <div class="field"><div class="seg">
        <button :class="{ on: o.fit === 'page' }" @click="o.fit = 'page'">Уместить на лист</button>
        <button :class="{ on: o.fit === 'tiles' }" @click="o.fit = 'tiles'">Склеить из листов</button>
      </div></div>
      <label class="field" v-if="o.fit === 'tiles'"><span>Крупность: {{ o.scale }}% (карточка около {{ Math.round(42 * o.scale / 100) }} мм)</span>
        <input type="range" min="40" max="250" step="10" v-model.number="o.scale" />
      </label>
      <p class="muted small" v-if="o.fit === 'tiles'">Пунктир на листах показывает, где накладывать соседний лист при склейке (1 см).</p>

      <h2>Оформление</h2>
      <div class="chips">
        <button class="chip" :class="{ on: o.theme === 'classic' }" @click="o.theme = 'classic'">Классика</button>
        <button class="chip" :class="{ on: o.theme === 'modern' }" @click="o.theme = 'modern'">Современное</button>
        <button class="chip" :class="{ on: o.theme === 'bw' }" @click="o.theme = 'bw'">Чёрно-белое</button>
      </div>
      <label class="field"><span>Заголовок</span><input v-model="o.title" :placeholder="store.title" /></label>
      <label class="row field"><input type="checkbox" v-model="o.photos" style="width:auto;min-height:0" /> Фотографии</label>
      <label v-if="canTalk()" class="row field"><input type="checkbox" v-model="o.hideLiving" style="width:auto;min-height:0" /> Скрыть даты и фото живых (для печати не для семьи)</label>
      <p v-else class="muted small">Даты и фото живых родственников на печати не показываются.</p>
    </template>
  </div>
</template>

<style scoped>
.preview svg { width: 100%; height: 260px; display: block; background: var(--bg); border-radius: 8px; }
.sheet-r { fill: #fff; stroke: #999; stroke-width: 3; vector-effect: non-scaling-stroke; }
.ln { fill: none; stroke: #8a7f70; stroke-width: 3; }
.nd { fill: #eee; stroke: #888; stroke-width: 2; }
.nd.M { fill: #e3ecf8; stroke: #5b7db1; }
.nd.F { fill: #f8e3eb; stroke: #b15b7d; }
.num { font-size: 120px; fill: rgba(0,0,0,.18); text-anchor: middle; dominant-baseline: middle; font-weight: 700; }
</style>
