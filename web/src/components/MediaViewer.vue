<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { store, loadTree, canEdit, toast } from '../store.js';
import { api, photoUrl } from '../api.js';
import { fullName, lifespan, personHas } from '@shared/names.js';
import { ask } from './ask.js';

// Просмотр во весь экран: листание пальцем влево-вправо, увеличение щипком или нажатием, подпись и кто на фото.
const props = defineProps({ items: Array, index: Number, person: Object });
const emit = defineEmits(['go', 'close', 'changed', 'removed']);

const m = computed(() => props.items[props.index]);
const isImage = computed(() => m.value.mime.startsWith('image/'));
const where = computed(() => (m.value.kind === 'doc' ? 'В документе' : 'На фото'));
const people = computed(() => m.value.persons.map((id) => store.idx?.persons.get(id)).filter(Boolean));
const busy = ref(false);

// Увеличение: картинка в прокручиваемой рамке, размер — «вписанный» × zoom; двигать увеличенную — пальцем.
const stage = ref(null);
const fit = ref({ w: 0, h: 0 });
const zoom = ref(1);
const natural = { w: 0, h: 0 };

function measure() {
  const s = stage.value;
  if (!s || !natural.w) return;
  const k = Math.min(s.clientWidth / natural.w, s.clientHeight / natural.h);
  fit.value = { w: natural.w * k, h: natural.h * k };
}
function loaded(e) {
  natural.w = e.target.naturalWidth;
  natural.h = e.target.naturalHeight;
  measure();
}
// Увеличить, не сдвигая точку (x, y) рамки под пальцем.
async function setZoom(z, x = stage.value.clientWidth / 2, y = stage.value.clientHeight / 2) {
  const s = stage.value;
  const z0 = zoom.value;
  z = Math.min(4, Math.max(1, z));
  if (z === z0) return;
  const fx = (s.scrollLeft + x) / Math.max(s.clientWidth, fit.value.w * z0);
  const fy = (s.scrollTop + y) / Math.max(s.clientHeight, fit.value.h * z0);
  zoom.value = z;
  await nextTick();
  s.scrollLeft = fx * Math.max(s.clientWidth, fit.value.w * z) - x;
  s.scrollTop = fy * Math.max(s.clientHeight, fit.value.h * z) - y;
}
function tap(e) {
  if (!isImage.value || moved) return;
  const r = stage.value.getBoundingClientRect();
  setZoom(zoom.value > 1 ? 1 : 2.5, e.clientX - r.left, e.clientY - r.top);
}

let start = null; // начало касания: для листания или щипка
let moved = false;
const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
function touchStart(e) {
  moved = false;
  if (e.touches.length === 2 && isImage.value) {
    const r = stage.value.getBoundingClientRect();
    start = { pinch: dist(e.touches), zoom: zoom.value,
      x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top };
  } else if (e.touches.length === 1) start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}
function touchMove(e) {
  moved = true;
  if (!start?.pinch || e.touches.length !== 2) return;
  e.preventDefault();
  setZoom(start.zoom * (dist(e.touches) / start.pinch), start.x, start.y);
}
function touchEnd(e) {
  if (start && !start.pinch && zoom.value === 1 && e.changedTouches.length) {
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  }
  if (!e.touches.length) start = null;
}

function step(d) {
  const i = props.index + d;
  if (i >= 0 && i < props.items.length) emit('go', i);
}
function key(e) {
  if (editing.value || tagging.value) return;
  if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'Escape') emit('close');
}

watch(() => m.value.id, () => {
  zoom.value = 1;
  natural.w = 0;
  fit.value = { w: 0, h: 0 };
  editing.value = false;
});
onMounted(() => {
  document.body.style.overflow = 'hidden';
  window.addEventListener('keydown', key);
  window.addEventListener('resize', measure);
  // Щипок обрабатываем сами: обработчик должен уметь отменять прокрутку страницы.
  stage.value.addEventListener('touchmove', touchMove, { passive: false });
});
onUnmounted(() => {
  document.body.style.overflow = '';
  window.removeEventListener('keydown', key);
  window.removeEventListener('resize', measure);
});

async function act(fn, done) {
  busy.value = true;
  try {
    await fn();
    if (done) toast(done);
  } catch (e) {
    toast(e.message);
  } finally {
    busy.value = false;
  }
}

// Подпись и дата.
const editing = ref(false);
const form = ref({ caption: '', date: '' });
function startEdit() {
  form.value = { caption: m.value.caption, date: m.value.date };
  editing.value = true;
}
const saveEdit = () => act(async () => {
  Object.assign(m.value, await api('PATCH', `/api/media/${m.value.id}`, form.value));
  editing.value = false;
  emit('changed');
}, 'Сохранено');

const makeMain = () => act(async () => {
  await api('PUT', `/api/persons/${props.person.id}/photo`, { media_id: m.value.id });
  await loadTree();
}, 'Это фото теперь на карточке');

async function remove() {
  const what = m.value.kind === 'doc' ? 'этот документ' : 'это фото';
  if (!await ask({ text: `Удалить ${what}?`, note: 'Вернуть можно в «Главная → Последние правки».', yes: 'Удалить', no: 'Не удалять', danger: true })) return;
  const i = props.index;
  act(async () => {
    await api('DELETE', `/api/media/${m.value.id}`);
    await loadTree();
    emit('removed', i);
  }, 'Удалено. Отменить можно в «Главная → Последние правки».');
}

// Кто на фото: поиск по дереву, нажатие отмечает или снимает отметку.
const tagging = ref(false);
const search = ref('');
const found = computed(() => {
  const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
  const all = (store.tree?.persons || []).filter((p) => !words.length || personHas(p, search.value));
  const on = new Set(m.value.persons);
  return all.sort((a, b) => on.has(b.id) - on.has(a.id)).slice(0, 40).map((p) => ({ p, on: on.has(p.id) }));
});
const toggle = ({ p, on }) => act(async () => {
  await api(on ? 'DELETE' : 'PUT', `/api/media/${m.value.id}/persons/${p.id}`);
  m.value.persons = on ? m.value.persons.filter((id) => id !== p.id) : [...m.value.persons, p.id];
  if (on) await loadTree(); // могло перестать быть главным фото
});
function closeTags() {
  tagging.value = false;
  search.value = '';
  emit('changed');
}
</script>

<template>
  <div class="viewer" role="dialog" aria-modal="true">
    <div class="top">
      <button class="close" @click="emit('close')">✕ Закрыть</button>
      <span class="count">{{ index + 1 }} из {{ items.length }}</span>
    </div>

    <div ref="stage" class="stage" :class="{ zoomed: zoom > 1 }"
      @touchstart="touchStart" @touchend="touchEnd" @click="tap">
      <div v-if="isImage" class="canvas" :style="{ width: `${Math.max(fit.w * zoom, 1)}px`, height: `${Math.max(fit.h * zoom, 1)}px` }">
        <img :key="m.id" :src="photoUrl(m.id)" alt="" draggable="false" @load="loaded" />
      </div>
      <div v-else class="pdf">
        <span class="icon">PDF</span>
        <a class="btn primary" :href="photoUrl(m.id)" target="_blank" rel="noopener" @click.stop>Открыть документ</a>
      </div>
      <button v-if="index > 0" class="flip prev" aria-label="Предыдущее" @click.stop="step(-1)">
        <svg viewBox="0 0 24 24"><path d="M15 4 7 12l8 8" /></svg>
      </button>
      <button v-if="index < items.length - 1" class="flip next" aria-label="Следующее" @click.stop="step(1)">
        <svg viewBox="0 0 24 24"><path d="m9 4 8 8-8 8" /></svg>
      </button>
    </div>

    <div class="info">
      <form v-if="editing" @submit.prevent="saveEdit">
        <label class="field"><span>Подпись</span><textarea v-model="form.caption" maxlength="500" placeholder="Кто, где, по какому случаю" /></label>
        <label class="field"><span>Дата</span><input v-model="form.date" maxlength="100" placeholder="например: 1952, около 1950, лето 1961" /></label>
        <div class="row">
          <button type="button" class="grow" @click="editing = false">Отмена</button>
          <button class="primary grow" :disabled="busy">Сохранить</button>
        </div>
      </form>
      <template v-else>
        <div class="caption">{{ m.caption || (!isImage && m.name) || 'Без подписи' }}</div>
        <div v-if="m.date" class="date">{{ m.date }}</div>
        <div v-if="m.id === person.photo_id" class="date">Это фото на карточке</div>
        <div class="who">
          {{ where }}:
          <template v-for="(x, i) in people" :key="x.id"><router-link :to="`/person/${x.id}`">{{ fullName(x) }}</router-link><template v-if="i < people.length - 1">, </template></template>
        </div>
        <div v-if="canEdit()" class="actions">
          <button @click="tagging = true">Отметить людей</button>
          <button v-if="isImage && m.id !== person.photo_id" :disabled="busy" @click="makeMain">Поставить на карточку</button>
          <button @click="startEdit">Изменить подпись</button>
          <button class="del" :disabled="busy" @click="remove">Удалить</button>
        </div>
      </template>
    </div>

    <template v-if="tagging">
      <div class="sheet-backdrop top-layer" @click="closeTags" />
      <div class="sheet top-layer">
        <h1>Кто {{ m.kind === 'doc' ? 'в документе' : 'на фото' }}?</h1>
        <input v-model="search" type="search" placeholder="Найти по имени или фамилии" />
        <div class="list tags">
          <button v-for="t in found" :key="t.p.id" :class="{ on: t.on }" :disabled="busy" @click="toggle(t)">
            <span class="avatar" :class="t.p.sex">{{ (t.p.given || '?')[0] }}</span>
            <span class="grow"><span class="ellipsis name">{{ fullName(t.p) }}</span><span class="muted small">{{ lifespan(t.p) }}</span></span>
            <span class="mark">{{ t.on ? (t.p.sex === 'F' ? '✓ Отмечена' : '✓ Отмечен') : 'Отметить' }}</span>
          </button>
          <div v-if="!found.length" class="muted">Никого не нашлось</div>
        </div>
        <button class="primary block" @click="closeTags">Готово</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.viewer { position: fixed; inset: 0; z-index: 60; background: #111; color: #f2efe9; display: flex; flex-direction: column; }
.top { display: flex; align-items: center; justify-content: space-between; padding: calc(6px + var(--safe-t)) 8px 6px; }
.close { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.28); color: #fff; }
.count { font-size: 17px; padding-right: 8px; color: #cfc8bd; }
.stage { position: relative; flex: 1; min-height: 0; overflow: hidden; display: grid; touch-action: pan-x pan-y; }
.stage.zoomed { overflow: auto; }
.canvas { margin: auto; flex: none; }
.canvas img { width: 100%; height: 100%; display: block; user-select: none; -webkit-user-select: none; }
.pdf { margin: auto; display: flex; flex-direction: column; align-items: center; gap: 20px; }
.pdf .icon { width: 110px; height: 140px; border-radius: 12px; background: #b4442f; color: #fff; font-weight: 700; font-size: 28px; display: grid; place-items: center; }
.pdf .btn { font-size: 18px; min-height: 56px; }
.flip { position: absolute; top: 50%; transform: translateY(-50%); width: 48px; height: 64px; padding: 0; background: rgba(0,0,0,.35); border-color: transparent; }
.flip svg { width: 28px; height: 28px; fill: none; stroke: #fff; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.prev { left: 6px; }
.next { right: 6px; }
.stage.zoomed .flip { display: none; }
.info { flex: none; max-height: 45vh; overflow-y: auto; padding: 12px 16px calc(14px + var(--safe-b)); background: #1d1c1a; }
.caption { font-size: 19px; white-space: pre-wrap; overflow-wrap: anywhere; }
.date { color: #cfc8bd; font-size: 16px; margin-top: 2px; }
.who { margin-top: 8px; font-size: 16px; color: #cfc8bd; }
.who a { color: #b9d69a; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.actions button { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.28); color: #fff; font-size: 0.889rem; }
.actions .del { color: #ff9b86; }
.info label.field > span { color: #cfc8bd; }
.top-layer.sheet-backdrop { z-index: 70; }
.top-layer.sheet { z-index: 71; color: var(--text); }
.tags { margin: 10px 0; max-height: 50vh; overflow-y: auto; }
.tags button { width: 100%; justify-content: flex-start; text-align: left; border-radius: 0; background: transparent; }
.tags button.on { background: var(--accent-soft); color: var(--accent-soft-text); }
.tags .name, .tags .grow > span { display: block; }
.mark { flex: none; font-size: 0.889rem; color: var(--accent-text); font-weight: 700; }
</style>
