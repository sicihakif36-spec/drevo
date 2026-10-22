<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { loadTree, canEdit, toast, onLive } from '../store.js';
import { api, upload, shrinkImage, photoUrl, thumbUrl } from '../api.js';
import MediaViewer from './MediaViewer.vue';
import { tell } from './ask.js';

// Фото и документы человека. Просмотр открывается поверх карточки, адрес ?media=<id>: кнопка «Назад» на телефоне его закрывает.
const props = defineProps({ person: Object });
const emit = defineEmits(['count']); // сколько фото и документов — для закладки в карточке
const route = useRoute();
const router = useRouter();
const items = ref([]);
const loaded = ref(false);
const error = ref('');
const picker = ref(false);
const photoInput = ref(null);
const docInput = ref(null);
const progress = ref(null); // { done, total, part } — сколько файлов ушло и доля текущего
const MAX = 20 * 1024 * 1024; // как на сервере

const photos = computed(() => items.value.filter((m) => m.kind === 'photo'));
const docs = computed(() => items.value.filter((m) => m.kind === 'doc'));
// В просмотре листаются сначала фото, потом документы — как на экране.
const ordered = computed(() => [...photos.value, ...docs.value]);
const index = computed(() => ordered.value.findIndex((m) => m.id === route.query.media));
const percent = computed(() => progress.value && Math.round(((progress.value.done + progress.value.part) / progress.value.total) * 100));

async function reload() {
  try {
    items.value = await api('GET', `/api/persons/${props.person.id}/media`);
    loaded.value = true;
  } catch (e) {
    error.value = e.message;
  }
  // Открытого файла больше нет в альбоме (удалили, сняли отметку) — закрыть просмотр.
  if (route.query.media && index.value < 0) close();
}

async function load() {
  loaded.value = false;
  error.value = '';
  items.value = [];
  if (!props.person.hidden) await reload();
}
watch(() => props.person.id, load, { immediate: true });
watch([loaded, () => items.value.length], ([l, n]) => emit('count', l ? n : null), { immediate: true });
onUnmounted(onLive((events) => { if (loaded.value && events.some((e) => e.kind === 'tree')) return reload(); }));

let pushed = false; // просмотр открыт отсюда: закрывать шагом назад, чтобы «Назад» не открывал его снова
function show(m) {
  pushed = true;
  router.push({ query: { ...route.query, media: m.id } });
}
defineExpose({ add: () => { picker.value = true; }, show: (id) => show({ id }) });
function go(i) {
  return router.replace({ query: { ...route.query, media: ordered.value[i].id } });
}
function close() {
  const { media, ...rest } = route.query;
  if (!media) return;
  if (pushed) router.back();
  else router.replace({ query: rest });
  pushed = false;
}
async function removed(i) {
  const next = ordered.value[i + 1] || ordered.value[i - 1];
  if (next) await go(ordered.value.indexOf(next));
  await reload();
}

const docsText = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'документ' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'документа' : 'документов'}`;

// Файлы уходят по одному, но в журнал попадают одним действием (batch): так их можно отменить разом.
async function addFiles(e, kind) {
  const list = [...(e.target.files || [])];
  e.target.value = '';
  picker.value = false;
  if (!list.length) return;
  progress.value = { done: 0, total: list.length, part: 0 };
  let batch = '';
  const failed = [];
  for (const file of list) {
    try {
      const pdf = file.type === 'application/pdf';
      const img = pdf ? null : await shrinkImage(file, [[kind === 'doc' ? 2400 : 1280, 0.86], [400, 0.8]]);
      if (!img && file.size > MAX) throw new Error('файл больше 20 МБ');
      const fd = new FormData();
      fd.append('kind', kind);
      if (batch) fd.append('batch', batch);
      fd.append('file', img ? img[0] : file, img ? file.name.replace(/\.[^.]*$/, '') + '.jpg' : file.name);
      if (img) fd.append('thumb', img[1], 'thumb.jpg');
      const m = await upload(`/api/persons/${props.person.id}/media`, fd, (x) => { progress.value.part = x; });
      batch = m.batch;
      items.value.push(m);
    } catch (err) {
      failed.push(`${file.name}: ${err.message}`);
    }
    progress.value.done++;
    progress.value.part = 0;
  }
  progress.value = null;
  await Promise.all([loadTree(), reload()]); // первое фото становится главным
  const ok = list.length - failed.length;
  if (!failed.length) toast(`Добавлено: ${kind === 'doc' ? docsText(ok) : `${ok} фото`}`);
  else tell(`Не удалось загрузить ${failed.length} из ${list.length}`, failed.join('\n'));
}
</script>

<template>
  <h2>Фото и документы</h2>
  <div v-if="person.hidden" class="card muted small">Фото и документы живых родственников видны только участникам дерева.</div>
  <div v-else class="card album">
    <div v-if="error" class="error">{{ error }}</div>
    <div v-else-if="!loaded" class="muted">Загрузка…</div>

    <div v-if="photos.length" class="grid">
      <button v-for="m in photos" :key="m.id" class="cell" :aria-label="m.caption || 'Фото'" @click="show(m)">
        <img :src="m.thumb ? thumbUrl(m.id) : photoUrl(m.id)" alt="" loading="lazy" />
        <span v-if="m.id === person.photo_id" class="main">На карточке</span>
      </button>
    </div>

    <div v-if="docs.length" class="docs">
      <button v-for="m in docs" :key="m.id" class="doc" @click="show(m)">
        <img v-if="m.thumb" :src="thumbUrl(m.id)" alt="" loading="lazy" />
        <span v-else class="icon">PDF</span>
        <span class="grow">
          <span class="title">{{ m.caption || (m.mime === 'application/pdf' && m.name) || 'Документ без подписи' }}</span>
          <span v-if="m.date" class="muted small">{{ m.date }}</span>
        </span>
      </button>
    </div>

    <p v-if="loaded && !items.length" class="muted empty">
      {{ canEdit() ? 'Пока пусто. Добавьте снимки и сканы документов: свидетельства, письма, метрики.' : 'Пока нет фото и документов.' }}
    </p>

    <div v-if="progress" class="progress" role="status">
      <div>Загружаю {{ Math.min(progress.done + 1, progress.total) }} из {{ progress.total }}…</div>
      <div class="bar"><div :style="{ width: `${percent}%` }" /></div>
    </div>
    <button v-else-if="canEdit()" class="primary block" @click="picker = true">+ Добавить</button>
  </div>

  <input ref="photoInput" type="file" accept="image/*" multiple hidden @change="addFiles($event, 'photo')" />
  <input ref="docInput" type="file" accept="image/*,application/pdf" multiple hidden @change="addFiles($event, 'doc')" />

  <template v-if="picker">
    <div class="sheet-backdrop" @click="picker = false" />
    <div class="sheet">
      <h1>Что добавить?</h1>
      <button class="primary block big" @click="photoInput.click()">Фотографии</button>
      <p class="muted small">Можно выбрать сразу несколько снимков или снять камерой.</p>
      <button class="primary block big" @click="docInput.click()">Документы</button>
      <p class="muted small">Свидетельства, письма, метрики: снимок или PDF. Снимки документов сохраняются крупнее, чтобы читался текст.</p>
      <button class="block" @click="picker = false">Отмена</button>
    </div>
  </template>

  <MediaViewer v-if="index >= 0" :items="ordered" :index="index" :person="person"
    @go="go" @close="close" @changed="reload" @removed="removed" />
</template>

<style scoped>
.album { padding: 12px; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 12px; }
.cell { position: relative; padding: 0; min-height: 0; aspect-ratio: 1; border-radius: 0.556rem; overflow: hidden; background: var(--line); border: 0; }
.cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.main { position: absolute; left: 0.222rem; bottom: 0.222rem; right: 0.222rem; width: fit-content; max-width: calc(100% - 0.444rem); background: rgba(0,0,0,.7); color: #fff; font-size: 0.778rem; padding: 0.111rem 0.333rem; border-radius: 0.333rem; }
.docs { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.doc { justify-content: flex-start; text-align: left; gap: 0.667rem; padding: 0.444rem; background: var(--bg); border: 1.5px solid var(--line); color: var(--text); font-weight: 400; }
.doc img, .doc .icon { width: 52px; height: 52px; flex: none; border-radius: 8px; object-fit: cover; }
.doc .icon { display: grid; place-items: center; background: var(--danger); color: #fff; font-weight: 700; font-size: 14px; }
.doc .title { display: block; font-weight: 700; overflow-wrap: anywhere; }
.doc .grow > span { display: block; }
.empty { margin: 0 0 12px; }
.progress { font-size: 17px; }
.bar { height: 10px; border-radius: 5px; background: var(--line); margin-top: 8px; overflow: hidden; }
.bar > div { height: 100%; background: var(--accent); transition: width .2s; }
.big { font-size: 18px; min-height: 56px; margin-top: 8px; }
.sheet .block:last-child { margin-top: 8px; }
</style>
