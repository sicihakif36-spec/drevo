<script setup>
import { computed, reactive, ref } from 'vue';
import { api, thumbUrl, uploadMedia } from '../api.js';
import { KINDS, FIELD_LABELS, FIELD_HINTS, docCite, citeText, recordText, partName, plainText, sourceTitle } from '@shared/sources.js';

// Источник по шаблону — две части. Документ (doc): название и шифр дела, пишется один раз. Страница (part): лист, номер записи,
// ссылка, скан и заметка — то, что касается этого человека. Новый источник — обе части; правка — одна из них.
// source — страница вместе с полями документа или документ; документ страницы при правке страницы — только заголовком.
// Скан — из альбома человека (personId) или загрузить сразу: подписью станет название документа.
// Наружу — submit({ doc, page }).
const props = defineProps({
  source: Object, kind: String, personId: String, doc: Boolean, part: Boolean, busy: String, error: String,
});
const emit = defineEmits(['submit', 'cancel']);

const s = props.source || {};
const form = reactive({
  kind: s.kind || props.kind || 'other', title: s.title || '', archive: s.archive || '', fond: s.fond || '', opis: s.opis || '',
  delo: s.delo || '', doc_note: (props.part ? s.doc_note : s.note) || '',
  sheet: s.sheet || '', verso: Boolean(s.verso), record: s.record || '', url: s.url || '', note: (props.part ? s.note : '') || '',
  media_id: s.media_id || null,
});
const album = ref(null); // фото и документы человека, пока не открыли выбор — null
const fileInput = ref(null);
const loading = ref('');
const scanError = ref('');
const tpl = computed(() => KINDS[form.kind]);
const cipher = computed(() => tpl.value.fields.filter((f) => f !== 'archive'));
const pageFields = computed(() => tpl.value.page);
const docLine = computed(() => docCite(form));
// Готовая строка ссылки: «ГАТО, ф. 160, оп. 1, д. 12, л. 34 об., запись № 57».
const preview = computed(() => [citeText(form), recordText(form.record)].filter(Boolean).join(', '));
const docTitle = computed(() => sourceTitle(form));
// Сначала сканы с подписью — названием этого документа.
const scans = computed(() => {
  const mine = (m) => plainText(m.caption) === plainText(docTitle.value);
  return [...(album.value || []).filter(mine), ...(album.value || []).filter((m) => !mine(m))];
});

async function pickScan() {
  album.value = await api('GET', `/api/persons/${props.personId}/media`).catch(() => []);
}

async function addScan(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  loading.value = 'Загружаю скан…';
  scanError.value = '';
  try {
    const m = await uploadMedia(props.personId, file, { caption: docTitle.value === 'Источник' ? '' : docTitle.value });
    form.media_id = m.id;
    if (album.value) album.value.push(m);
  } catch (err) {
    scanError.value = `Не удалось загрузить: ${err.message}`;
  } finally {
    loading.value = '';
  }
}

function submit() {
  const doc = { kind: form.kind, title: form.title, archive: form.archive, fond: form.fond, opis: form.opis, delo: form.delo, note: form.doc_note };
  const page = { sheet: form.sheet, verso: form.verso, record: form.record, url: form.url, note: form.note, media_id: form.media_id };
  if (!pageFields.value.includes('sheet')) page.verso = false;
  emit('submit', { doc, page });
}
</script>

<template>
  <form class="sform" @submit.prevent="submit">
    <template v-if="doc">
      <h2 v-if="part" class="part">Документ</h2>
      <label class="field"><span>Название</span>
        <input v-model="form.title" maxlength="300" :placeholder="tpl.title" />
      </label>
      <template v-if="tpl.fields.includes('archive')">
        <label class="field"><span>{{ FIELD_LABELS.archive }}</span>
          <input v-model="form.archive" maxlength="200" :placeholder="form.kind === 'zags' ? 'например: ЗАГС Калининского района' : FIELD_HINTS.archive" />
        </label>
        <div v-if="cipher.length" class="cipher">
          <label v-for="f in cipher" :key="f" class="field"><span>{{ FIELD_LABELS[f] }}</span>
            <input v-model="form[f]" maxlength="50" :placeholder="FIELD_HINTS[f]" />
          </label>
        </div>
        <p v-if="!part && docLine" class="cite">{{ docLine }}</p>
      </template>
      <label v-if="!part" class="field"><span>{{ FIELD_LABELS.note }}</span>
        <textarea v-model="form.doc_note" maxlength="5000" rows="3" placeholder="Что важно знать обо всём документе" />
      </label>
    </template>
    <div v-else-if="part" class="docline">
      <div class="ttl">{{ docTitle }}</div>
      <div v-if="docLine" class="muted small">{{ docLine }}</div>
    </div>

    <template v-if="part">
      <h2 v-if="doc" class="part">{{ partName(form.kind) }} — что касается этого человека</h2>
      <label v-if="pageFields.includes('url')" class="field"><span>{{ FIELD_LABELS.url }}</span>
        <input v-model="form.url" type="url" inputmode="url" maxlength="1000" :placeholder="FIELD_HINTS.url" />
      </label>
      <div v-if="pageFields.includes('sheet')" class="cipher">
        <label class="field"><span>{{ FIELD_LABELS.sheet }}</span>
          <input v-model="form.sheet" maxlength="50" :placeholder="FIELD_HINTS.sheet" />
        </label>
        <label class="field"><span>{{ FIELD_LABELS.record }}</span>
          <input v-model="form.record" maxlength="50" :placeholder="FIELD_HINTS.record" />
        </label>
      </div>
      <label v-if="pageFields.includes('sheet')" class="check"><input v-model="form.verso" type="checkbox" /> Оборот листа («об.»)</label>
      <p v-if="preview" class="cite">{{ preview }}</p>

      <div class="field">
        <span class="lbl">{{ FIELD_LABELS.media_id }}</span>
        <div v-if="form.media_id" class="row">
          <img :src="thumbUrl(form.media_id)" alt="" class="thumb" @error="$event.target.style.visibility = 'hidden'" />
          <span class="grow muted small">Скан выбран</span>
          <button type="button" class="danger" @click="form.media_id = null">Убрать</button>
        </div>
        <template v-else>
          <div class="row">
            <button type="button" class="grow" :disabled="Boolean(loading)" @click="fileInput.click()">{{ loading || 'Загрузить скан' }}</button>
            <button v-if="!album" type="button" class="grow" @click="pickScan">Из альбома</button>
          </div>
          <p v-if="scanError" class="error">{{ scanError }}</p>
          <template v-if="album">
            <div v-if="scans.length" class="scans">
              <button v-for="m in scans" :key="m.id" type="button" class="scan" :aria-label="m.caption || m.name || 'Скан'" @click="form.media_id = m.id">
                <img v-if="m.thumb || m.mime !== 'application/pdf'" :src="thumbUrl(m.id)" alt="" />
                <span v-else>PDF</span>
                <span v-if="m.caption" class="cap">{{ m.caption }}</span>
              </button>
            </div>
            <p v-else class="muted small">В альбоме этого человека пока нет фото и документов — загрузите скан кнопкой выше.</p>
          </template>
        </template>
        <input ref="fileInput" type="file" accept="image/*,application/pdf" hidden @change="addScan" />
      </div>

      <label class="field"><span>{{ FIELD_LABELS.note }}</span>
        <textarea v-model="form.note" maxlength="5000" rows="3" :placeholder="form.kind === 'legend' ? 'Кто рассказал, когда, что именно' : 'Что написано в записи: родители, восприемники, священник'" />
      </label>
    </template>

    <p v-if="error" class="error">{{ error }}</p>
    <div class="row">
      <button type="button" class="grow" @click="emit('cancel')">Отмена</button>
      <button class="primary grow" :disabled="Boolean(busy) || Boolean(loading)">{{ busy || 'Сохранить' }}</button>
    </div>
  </form>
</template>

<style scoped>
.part { margin: 16px 0 4px; font-size: 1rem; }
.cipher { display: grid; grid-template-columns: 1fr 1fr; column-gap: 8px; }
.cipher .field { margin: 4px 0; }
.check { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 0.889rem; }
.check input { width: 22px; height: 22px; min-height: 0; }
.cite { margin: 4px 0 8px; padding: 8px 12px; border-radius: 10px; background: var(--accent-soft); font-size: 0.833rem; }
.docline { margin: 4px 0 12px; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); }
.docline .ttl { font-weight: 600; overflow-wrap: anywhere; }
.lbl { display: block; font-size: 0.889rem; font-weight: 700; color: var(--text); margin-bottom: 0.25rem; }
.field { margin: 10px 0; }
.thumb { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; background: var(--line); }
.scans { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 8px; }
.scan { position: relative; padding: 0; aspect-ratio: 1; min-height: 0; overflow: hidden; border-radius: 8px; background: var(--line); font-weight: 600; color: var(--muted); }
.scan img { width: 100%; height: 100%; object-fit: cover; }
.cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 2px 4px; background: rgba(0,0,0,.65); color: #fff; font-size: 0.667rem; font-weight: 400;
  line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-align: left; }
</style>
