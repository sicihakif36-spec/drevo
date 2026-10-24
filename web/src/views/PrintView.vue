<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { store, canTalk } from '../store.js';
import { api, thumbUrl } from '../api.js';
import { layoutTree, BOX } from '@shared/layout.js';
import { homePerson } from '@shared/wholetree.js';
import { planPages, PAPER, MM } from '@shared/printplan.js';
import { layoutFan, sectorPath, FAN } from '@shared/fan.js';
import { fullName } from '@shared/names.js';
import { buildRospis, parseRospisOptions } from '@shared/rospis.js';
import RospisText from '../components/RospisText.vue';

const saved = (() => { try { return JSON.parse(localStorage.getItem('drevo.print') || '{}'); } catch { return {}; } })();
const o = reactive({
  root: '', mode: 'hourglass', up: 4, down: 3, paper: 'A4', orient: 'auto', fit: 'page', scale: 100,
  photos: true, hideLiving: false, theme: 'classic', title: '', gens: 5, shape: 180, colors: 'branch', empty: true, ...saved,
});
// Из карточки: «Веер предков» с этим человеком в центре.
const route = useRoute();
if (route.query.root) o.root = String(route.query.root);
if (['fan', 'rospis'].includes(route.query.mode)) o.mode = String(route.query.mode);
watch(o, () => { try { localStorage.setItem('drevo.print', JSON.stringify(o)); } catch {} });
// Роспись: свои настройки; оформление, заголовок и «скрыть живых» — общие.
const savedR = (() => { try { return JSON.parse(localStorage.getItem('drevo.rospis') || '{}'); } catch { return {}; } })();
const ro = reactive({ gens: 0, male: false, events: true, notes: true, sources: false, title: '', ...savedR });
watch(ro, () => { try { localStorage.setItem('drevo.rospis', JSON.stringify(ro)); } catch {} });

const people = computed(() => [...(store.idx?.persons.values() || [])].sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru')));
// Кто в центре: выбранный, иначе сам вошедший или человек владельца, иначе — из самой большой части (как на сервере).
const home = computed(() => (store.idx ? homePerson(store.idx, store.me?.person_id, store.tree?.owner_person_id) : null));
const rootId = computed(() => (store.idx?.persons.has(o.root) ? o.root : home.value));
const isFan = computed(() => o.mode === 'fan');
const isRospis = computed(() => o.mode === 'rospis');
const layout = computed(() => (store.idx && rootId.value && !isFan.value && !isRospis.value ? layoutTree(store.idx, rootId.value, { mode: o.mode, up: o.up, down: o.down, anchor: home.value }) : null));
// Веер: та же раскладка, что в PDF (shared/fan.js). Гостю дерево уже пришло без дат и фото живых.
const fan = computed(() => (store.idx && rootId.value && isFan.value ? layoutFan(store.idx, rootId.value, { ...o, hideLiving: o.hideLiving || !canTalk() }) : null));
const scheme = computed(() => layout.value || fan.value);
const plan = computed(() => (fan.value ? fan.value.plan : layout.value?.nodes.length ? planPages(layout.value, o) : null));
const pages = computed(() => (plan.value ? plan.value.cols * plan.value.rows : 0));

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
const viewBox = computed(() => {
  const all = sheets.value;
  if (!all.length) return '0 0 1 1';
  const x = Math.min(...all.map((s) => s.x)); const y = Math.min(...all.map((s) => s.y));
  const x2 = Math.max(...all.map((s) => s.x + s.w)); const y2 = Math.max(...all.map((s) => s.y + s.h));
  const m = (x2 - x) * 0.02;
  return `${x - m} ${y - m} ${x2 - x + 2 * m} ${y2 - y + 2 * m}`;
});

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
    root: rootId.value || '', mode: o.mode, up: o.up, down: o.down, paper: o.paper, orient: o.orient, fit: o.fit,
    scale: o.scale, photos: o.photos ? '1' : '0', hideLiving: o.hideLiving ? '1' : '0', theme: o.theme, title: o.title,
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
        <svg :viewBox="viewBox" preserveAspectRatio="xMidYMid meet">
          <rect v-for="(s, i) in sheets" :key="'s' + i" :x="s.x" :y="s.y" :width="s.w" :height="s.h" class="sheet-r" />
          <template v-if="layout">
            <path v-for="(e, i) in layout.edges" :key="'e' + i" :d="e.points.map((p, j) => (j ? 'L' : 'M') + p[0] + ',' + p[1]).join('')" class="ln" />
            <rect v-for="(n, i) in layout.nodes" :key="'n' + i" :x="n.x" :y="n.y" :width="BOX.w" :height="BOX.h" rx="10" :class="['nd', store.idx.persons.get(n.id)?.sex]" />
          </template>
          <g v-else class="fan">
            <path v-for="s in fan.sectors" :key="'f' + s.k" :d="sectorPath(s)" :fill="s.fill" :stroke="fan.line" :stroke-width="(s.id ? 0.9 : 0.4) / plan.s" />
            <path :d="fan.shape === 180 ? `M${-fan.center.r1},0A${fan.center.r1},${fan.center.r1} 0 0 1 ${fan.center.r1},0Z` : `M${-fan.center.r1},0A${fan.center.r1},${fan.center.r1} 0 1 1 ${fan.center.r1},0A${fan.center.r1},${fan.center.r1} 0 1 1 ${-fan.center.r1},0Z`"
              :fill="fan.center.fill" :stroke="fan.line" :stroke-width="1.4 / plan.s" />
            <image v-if="centerPhoto" :href="centerPhoto" :x="fan.center.photo.x" :y="fan.center.photo.y" :width="fan.center.photo.w" :height="fan.center.photo.h" preserveAspectRatio="xMidYMid slice" />
            <text v-for="(l, i) in [...fan.sectors.flatMap((s) => s.lines), ...fan.center.lines]" :key="'l' + i" :x="l.x" :y="l.y" :transform="`rotate(${l.rot} ${l.x} ${l.y})`" :style="fanFont(l)">{{ l.text }}</text>
          </g>
          <text v-for="(s, i) in sheets.length > 1 ? sheets : []" :key="'t' + i" :x="s.x + s.w / 2" :y="s.y + s.h / 2" class="num">{{ s.n }}</text>
        </svg>
        <div class="small" style="margin-top:6px">
          <b>{{ pages }} {{ pages === 1 ? 'лист' : pages < 5 ? 'листа' : 'листов' }} {{ o.paper }}</b>,
          {{ plan.orient === 'landscape' ? 'альбомная' : 'книжная' }} · {{ layout ? layout.nodes.length : fan.people }} чел. <span class="muted">{{ sizeMm }}</span>
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
        <select v-model="o.root"><option value="">{{ store.me?.person_id ? 'Я' : home ? `${fullName(store.idx.persons.get(home))} (начало дерева)` : 'Начало дерева' }}</option><option v-for="p in people" :key="p.id" :value="p.id">{{ fullName(p) }}</option></select>
      </label>
      <div class="field"><div class="seg">
        <button :class="{ on: !isFan && !isRospis }" @click="o.mode = isFan || isRospis ? 'hourglass' : o.mode">Дерево</button>
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
      <div class="field" v-if="!isFan && !isRospis"><div class="seg two">
        <button :class="{ on: o.mode === 'all' }" @click="o.mode = 'all'">Всё дерево</button>
        <button :class="{ on: o.mode === 'hourglass' }" @click="o.mode = 'hourglass'">Ветка</button>
        <button :class="{ on: o.mode === 'ancestors' }" @click="o.mode = 'ancestors'">Предки</button>
        <button :class="{ on: o.mode === 'descendants' }" @click="o.mode = 'descendants'">Потомки</button>
      </div></div>
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
      <div class="grid2" v-else-if="!isRospis && o.mode !== 'all'">
        <label class="field" v-if="o.mode !== 'descendants'"><span>Поколений вверх</span><input type="number" min="1" max="12" v-model.number="o.up" /></label>
        <label class="field" v-if="o.mode !== 'ancestors'"><span>Поколений вниз</span><input type="number" min="1" max="12" v-model.number="o.down" /></label>
      </div>

      <p class="muted small" v-if="o.mode === 'all'" style="margin-top:0">Все, кто связан с выбранным человеком родством и браками, — каждый один раз. Большое дерево удобнее «Склеить из листов».</p>
      <template v-if="!isRospis">
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
      <label class="field" v-if="o.fit === 'tiles'"><span>Крупность: {{ o.scale }}%<template v-if="!isFan"> (карточка около {{ Math.round(42 * o.scale / 100) }} мм)</template></span>
        <input type="range" min="40" max="250" step="10" v-model.number="o.scale" />
      </label>
      <p class="muted small" v-if="o.fit === 'tiles'">Пунктир на листах показывает, где накладывать соседний лист при склейке (1 см).</p>
      </template>

      <h2>Оформление</h2>
      <div class="chips">
        <button class="chip" :class="{ on: o.theme === 'classic' }" @click="o.theme = 'classic'">Классика</button>
        <button class="chip" :class="{ on: o.theme === 'modern' }" @click="o.theme = 'modern'">Современное</button>
        <button class="chip" :class="{ on: o.theme === 'bw' }" @click="o.theme = 'bw'">Чёрно-белое</button>
      </div>
      <label v-if="isRospis" class="field"><span>Заголовок</span><input v-model="ro.title" placeholder="Поколенная роспись" /></label>
      <label v-else class="field"><span>Заголовок</span><input v-model="o.title" :placeholder="store.title" /></label>
      <label v-if="!isRospis" class="row field check"><input type="checkbox" v-model="o.photos" /> {{ isFan ? 'Фото в середине' : 'Фотографии' }}</label>
      <label v-if="canTalk()" class="row field"><input type="checkbox" v-model="o.hideLiving" /> Скрыть даты и фото живых — для печати не для семьи</label>
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
.fan text { text-anchor: middle; dominant-baseline: central; fill: #1d1d1d; }
.num { font-size: 120px; fill: rgba(0,0,0,.18); text-anchor: middle; dominant-baseline: middle; font-weight: 700; }
.seg.two { display: grid; grid-template-columns: 1fr 1fr; }
.check { align-items: flex-start; min-height: 2.667rem; }
.check input { flex: none; margin: 0.111rem 0 0; }
</style>
