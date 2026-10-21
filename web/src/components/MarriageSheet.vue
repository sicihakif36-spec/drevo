<script setup>
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { loadTree, toast } from '../store.js';
import { api } from '../api.js';
import { fullName } from '@shared/names.js';
import DateInput from './DateInput.vue';
import PlaceInput from './PlaceInput.vue';

// Окно «Брак» снизу: вид связи, дата и место, чем закончился (развод — с датой). Сохраняются только изменённые поля.
const props = defineProps({ family: Object, spouse: Object });
const emit = defineEmits(['close']);
const router = useRouter();

const KINDS = [['marriage', 'Брак'], ['partners', 'Вместе без брака'], ['unknown', 'Неизвестно']];
const ENDS = [['', 'Не расторгнут'], ['divorce', 'Развод'], ['death', 'Смерть супруга']];
const f = props.family;
const form = reactive({ kind: f.kind, start_date: f.start_date, place: f.place || '', ended: f.ended, end_date: f.end_date });
const saving = ref(false);
const error = ref('');
const married = computed(() => form.kind !== 'partners');

async function save() {
  const data = { ...form, end_date: form.ended === 'divorce' ? form.end_date : '' };
  const changed = Object.fromEntries(Object.entries(data).filter(([k, v]) => v !== (f[k] ?? '')));
  if (!Object.keys(changed).length) return emit('close');
  saving.value = true;
  error.value = '';
  try {
    await api('PATCH', `/api/families/${f.id}`, changed);
    await loadTree();
    toast('Сохранено');
    emit('close');
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

function openSpouse() {
  emit('close');
  router.push(`/person/${props.spouse.id}`);
}
</script>

<template>
  <div class="sheet-backdrop" @click="emit('close')" />
  <form class="sheet msheet" role="dialog" aria-modal="true" @submit.prevent="save">
    <div class="muted small">{{ spouse.sex === 'F' ? 'Жена' : spouse.sex === 'M' ? 'Муж' : 'Муж или жена' }}</div>
    <h1>{{ fullName(spouse) }}</h1>

    <div class="field"><span class="lbl">Вид связи</span>
      <div class="seg"><button v-for="[k, l] in KINDS" :key="k" type="button" :class="{ on: form.kind === k }" @click="form.kind = k">{{ l }}</button></div>
    </div>
    <DateInput v-model="form.start_date" :label="married ? 'Дата брака' : 'С какого времени вместе'" placeholder="например: 12.05.1945, около 1945" />
    <PlaceInput v-model="form.place" :label="married ? 'Где венчались или расписались' : 'Где жили'" placeholder="например: Троицкая церковь с. Горки" />
    <div class="field"><span class="lbl">Чем закончился</span>
      <div class="seg"><button v-for="[k, l] in ENDS" :key="k" type="button" :class="{ on: form.ended === k }" @click="form.ended = k">{{ l }}</button></div>
    </div>
    <DateInput v-if="form.ended === 'divorce'" v-model="form.end_date" label="Дата развода" placeholder="например: 1962" />

    <p class="error" v-if="error">{{ error }}</p>
    <div class="row">
      <button type="button" class="grow" @click="emit('close')">Отмена</button>
      <button class="primary grow" :disabled="saving">{{ saving ? 'Сохраняю…' : 'Сохранить' }}</button>
    </div>
    <button type="button" class="ghost block open" @click="openSpouse">Открыть карточку: {{ spouse.given || fullName(spouse) }} ›</button>
  </form>
</template>

<style scoped>
.msheet h1 { font-size: 1.222rem; overflow-wrap: anywhere; }
.field { display: block; margin: 10px 0; }
.lbl { display: block; font-size: 0.889rem; font-weight: 700; color: var(--text); margin-bottom: 0.25rem; }
.seg button { min-height: 46px; font-size: 0.833rem; line-height: 1.2; }
.open { margin-top: 6px; color: var(--accent-text); }
</style>
