<script setup>
import { computed, onMounted, ref } from 'vue';
import { store, toast } from '../store.js';
import { api } from '../api.js';
import { buildPrompt } from '@shared/research.js';
import { isPrivate, parentsOf, siblingsOf, spousesOf, childrenOf } from '@shared/names.js';
import { placeKey } from '@shared/places.js';

// «Подготовить запрос»: текст для ИИ-помощника со всем, что известно о человеке и родных (shared/research.js).
// Даты и места живых моложе 100 лет — только по отметке. Человек сам копирует текст в чат помощника.
const props = defineProps({ person: Object, question: Object });
const emit = defineEmits(['close', 'upload']);
const FAITH = 'drevo.research.faith'; // удобство: вероисповедание и национальность обычно одни на всю семью
const faith = ref('');
const living = ref(false);
const events = ref([]);
const box = ref(null);
const copied = ref(false);
try { faith.value = localStorage.getItem(FAITH) || ''; } catch { /* без памяти браузера */ }

onMounted(async () => {
  events.value = await api('GET', `/api/persons/${props.person.id}/life-events`).catch(() => []);
});

const idx = computed(() => store.idx);
// Есть ли в запросе живые, чьи даты по умолчанию не показываются.
const privateKin = computed(() => {
  const i = idx.value;
  const id = props.person.id;
  const ids = [id, ...parentsOf(i, id), ...siblingsOf(i, id), ...spousesOf(i, id).map((s) => s.spouseId), ...childrenOf(i, id)];
  return ids.filter(Boolean).map((x) => i.persons.get(x)).filter((p) => p && isPrivate(p)).length;
});
const now = (text) => store.tree?.places?.find((x) => placeKey(x.title) === placeKey(text))?.now || '';
const text = computed(() => buildPrompt({
  person: props.person, idx: idx.value, events: events.value, goal: props.question?.title, faith: faith.value, living: living.value, now,
}));

function remember() {
  try { localStorage.setItem(FAITH, faith.value.trim()); } catch { /* без памяти браузера */ }
}

// Буфер обмена есть не везде (старый браузер, не https) — тогда выделяем текст, чтобы человек скопировал его сам.
async function copy() {
  remember();
  try {
    await navigator.clipboard.writeText(text.value);
    copied.value = true;
    toast('Скопировано. Вставьте текст в чат помощника.');
    return;
  } catch { /* дальше — выделение */ }
  const el = box.value;
  el.focus();
  el.select();
  el.setSelectionRange(0, text.value.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  if (ok) {
    copied.value = true;
    toast('Скопировано. Вставьте текст в чат помощника.');
  } else toast('Текст выделен — нажмите «Копировать» в меню телефона');
}

const canShare = typeof navigator !== 'undefined' && Boolean(navigator.share);
async function share() {
  remember();
  try {
    await navigator.share({ title: 'Запрос помощнику-генеалогу', text: text.value });
  } catch (e) {
    if (e?.name !== 'AbortError') toast('Не получилось поделиться. Нажмите «Скопировать».');
  }
}
</script>

<template>
  <div class="sheet-backdrop" @click="emit('close')" />
  <div class="sheet prompt" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
    <h2 id="prompt-title" style="margin-top:0">Запрос помощнику</h2>
    <p class="small" style="margin-top:0">Скопируйте этот текст и вставьте в чат ИИ-помощника. В нём всё, что известно в дереве,
      и вопрос: <b>«{{ question.title }}»</b>.</p>

    <label class="field">
      <span>Вероисповедание и национальность</span>
      <input v-model="faith" placeholder="например: мусульмане, татары" @change="remember" />
    </label>
    <p v-if="!faith.trim()" class="muted small tip">Если не впишете, помощник спросит сам.</p>

    <label v-if="privateKin" class="check">
      <input v-model="living" type="checkbox" />
      <span>Добавить даты и места живых
        <span class="muted small">Сейчас о живых ({{ privateKin }}) — только имя и кем приходятся. Отметьте, если помощнику нужны их годы.</span></span>
    </label>

    <textarea ref="box" class="text" :value="text" readonly aria-label="Текст запроса" />

    <div class="grid2 buttons" :class="{ one: !canShare }">
      <button class="primary" @click="copy">{{ copied ? 'Скопировано ✓' : 'Скопировать' }}</button>
      <button v-if="canShare" @click="share">Поделиться</button>
    </div>
    <p class="small">Когда помощник пришлёт ответ с файлом, нажмите <b>«Загрузить результат»</b> и вставьте ответ целиком.</p>
    <button class="block" @click="emit('upload')">Загрузить результат</button>
    <button class="ghost block" style="margin-top:0.444rem" @click="emit('close')">Закрыть</button>
  </div>
</template>

<style scoped>
.prompt { max-height: 96vh; }
.tip { margin: -0.444rem 0 0.444rem; }
.check { display: flex; gap: 0.667rem; align-items: flex-start; margin: 0.667rem 0; }
.check input { flex: none; margin-top: 0.167rem; }
.check .muted { display: block; }
.text { width: 100%; box-sizing: border-box; min-height: 50vh; font-size: 1rem; line-height: 1.45; white-space: pre-wrap; background: var(--card); }
.buttons { margin: 0.667rem 0 0.444rem; }
.buttons.one { grid-template-columns: 1fr; }
</style>
