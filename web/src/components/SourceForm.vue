<script setup>
import { computed, reactive, ref } from 'vue';
import { api, thumbUrl } from '../api.js';
import { KINDS, FIELD_LABELS, FIELD_HINTS, citeText } from '@shared/sources.js';

// Поля источника по шаблону: какие показывать — решает вид источника. Скан — из альбома человека (personId).
// page — показать поле «Уточнение» (новая привязка к сведению). Наружу — submit({ fields, page }).
const props = defineProps({ source: Object, kind: String, personId: String, page: Boolean, busy: String, error: String });
const emit = defineEmits(['submit', 'cancel']);

const s = props.source || {};
const form = reactive({
  kind: s.kind || props.kind || 'other', title: s.title || '', archive: s.archive || '', fond: s.fond || '', opis: s.opis || '',
  delo: s.delo || '', sheet: s.sheet || '', verso: Boolean(s.verso), url: s.url || '', note: s.note || '', media_id: s.media_id || null,
});
const pageText = ref('');
const album = ref(null); // фото и документы человека, пока не открыли выбор — null
const tpl = computed(() => KINDS[form.kind]);
const cite = computed(() => citeText(form));
// Шифр дела — одним блоком, с готовой строкой ссылки под ним.
const archival = computed(() => ['fond', 'opis', 'delo', 'sheet'].filter((f) => tpl.value.fields.includes(f)));

async function pickScan() {
  album.value = await api('GET', `/api/persons/${props.personId}/media`).catch(() => []);
}

function submit() {
  const fields = { ...form };
  if (!tpl.value.fields.includes('sheet')) fields.verso = false;
  emit('submit', { fields, page: pageText.value });
}
</script>

<template>
  <form class="sform" @submit.prevent="submit">
    <label class="field"><span>Название</span>
      <input v-model="form.title" maxlength="300" :placeholder="tpl.title" />
    </label>
    <label v-if="tpl.fields.includes('url')" class="field"><span>{{ FIELD_LABELS.url }}</span>
      <input v-model="form.url" type="url" inputmode="url" maxlength="1000" :placeholder="FIELD_HINTS.url" />
    </label>
    <template v-if="tpl.fields.includes('archive')">
      <label class="field"><span>{{ FIELD_LABELS.archive }}</span>
        <input v-model="form.archive" maxlength="200" :placeholder="form.kind === 'zags' ? 'например: ЗАГС Калининского района' : FIELD_HINTS.archive" />
      </label>
      <div v-if="archival.length" class="cipher">
        <label v-for="f in archival" :key="f" class="field"><span>{{ FIELD_LABELS[f] }}</span>
          <input v-model="form[f]" maxlength="50" :placeholder="FIELD_HINTS[f]" />
        </label>
      </div>
      <label v-if="archival.includes('sheet')" class="check"><input v-model="form.verso" type="checkbox" /> Оборот листа («об.»)</label>
      <p v-if="cite" class="cite">{{ cite }}</p>
    </template>

    <div class="field">
      <span class="lbl">{{ FIELD_LABELS.media_id }}</span>
      <div v-if="form.media_id" class="row">
        <img :src="thumbUrl(form.media_id)" alt="" class="thumb" @error="$event.target.style.visibility = 'hidden'" />
        <span class="grow muted small">Скан выбран</span>
        <button type="button" class="danger" @click="form.media_id = null">Убрать</button>
      </div>
      <button v-else-if="!album" type="button" class="block" @click="pickScan">Выбрать скан из альбома</button>
      <template v-else>
        <div v-if="album.length" class="scans">
          <button v-for="m in album" :key="m.id" type="button" class="scan" :aria-label="m.caption || m.name || 'Скан'" @click="form.media_id = m.id">
            <img v-if="m.thumb || m.mime !== 'application/pdf'" :src="thumbUrl(m.id)" alt="" />
            <span v-else>PDF</span>
          </button>
        </div>
        <p v-else class="muted small">В альбоме пока нет фото и документов. Добавьте скан в «Фото и документы», потом выберите его здесь.</p>
      </template>
    </div>

    <label class="field"><span>{{ FIELD_LABELS.note }}</span>
      <textarea v-model="form.note" maxlength="5000" rows="3" :placeholder="form.kind === 'legend' ? 'Кто рассказал, когда, что именно' : 'Что ещё важно знать об этом источнике'" />
    </label>
    <label v-if="page" class="field"><span>Уточнение: номер записи, страница</span>
      <input v-model="pageText" maxlength="300" placeholder="например: запись № 57" />
    </label>

    <p v-if="error" class="error">{{ error }}</p>
    <div class="row">
      <button type="button" class="grow" @click="emit('cancel')">Отмена</button>
      <button class="primary grow" :disabled="Boolean(busy)">{{ busy || 'Сохранить' }}</button>
    </div>
  </form>
</template>

<style scoped>
.cipher { display: grid; grid-template-columns: 1fr 1fr; column-gap: 8px; }
.cipher .field { margin: 4px 0; }
.check { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 16px; }
.check input { width: 22px; height: 22px; min-height: 0; }
.cite { margin: 4px 0 8px; padding: 8px 12px; border-radius: 10px; background: var(--accent-soft); font-size: 15px; }
.lbl { display: block; font-size: 13px; color: var(--muted); margin-bottom: 4px; }
.field { margin: 10px 0; }
.thumb { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; background: var(--line); }
.scans { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.scan { padding: 0; aspect-ratio: 1; min-height: 0; overflow: hidden; border-radius: 8px; background: var(--line); font-weight: 600; color: var(--muted); }
.scan img { width: 100%; height: 100%; object-fit: cover; }
</style>
