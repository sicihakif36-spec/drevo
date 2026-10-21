<script setup>
import { computed, reactive, ref } from 'vue';
import { loadTree, toast } from '../store.js';
import { api } from '../api.js';
import { PLACE_KINDS, placeTitle } from '@shared/places.js';

// Окно места справочника снизу: новое или правка. from — текст места из карточек: у новых мест он заменится полным названием.
const props = defineProps({ place: Object, from: { type: String, default: '' } });
const emit = defineEmits(['close', 'saved']);

const KIND_LABEL = { ...PLACE_KINDS, other: 'другое' };
const p = props.place;
const form = reactive({
  kind: p?.kind || 'village', name: p?.name ?? props.from, volost: p?.volost || '', uezd: p?.uezd || '', gubernia: p?.gubernia || '',
  country: p?.country || '', now: p?.now || '', note: p?.note || '',
});
const saving = ref(false);
const error = ref('');
const title = computed(() => placeTitle(form));

async function save() {
  error.value = '';
  if (!form.name.trim()) {
    error.value = 'Напишите название: Горки, Старица…';
    return;
  }
  if (p && title.value !== p.title && !confirm(`Новое название запишется и у всех людей, у кого записано «${p.title}». Сохранить?`)) return;
  saving.value = true;
  try {
    const saved = p ? await api('PATCH', `/api/places/${p.id}`, form) : await api('POST', '/api/places', { ...form, from: props.from });
    await loadTree();
    toast('Место сохранено');
    emit('saved', saved);
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="sheet-backdrop" @click="emit('close')" />
  <form class="sheet psheet" role="dialog" aria-modal="true" @submit.prevent="save">
    <h1>{{ p ? 'Изменить место' : 'Новое место' }}</h1>
    <p v-if="from && !p" class="muted small">В карточках записано: «{{ from }}». Это место запишется полным названием.</p>
    <div class="field"><span>Что это</span>
      <div class="chips wrap">
        <button v-for="(l, k) in KIND_LABEL" :key="k" type="button" class="chip" :class="{ on: form.kind === k }" @click="form.kind = k">{{ l }}</button>
      </div>
    </div>
    <label class="field"><span>Название</span><input v-model="form.name" maxlength="200" placeholder="например: Горки" /></label>
    <label class="field"><span>Волость</span><input v-model="form.volost" maxlength="200" placeholder="например: Ивановская" /></label>
    <label class="field"><span>Уезд</span><input v-model="form.uezd" maxlength="200" placeholder="например: Старицкий" /></label>
    <label class="field"><span>Губерния</span><input v-model="form.gubernia" maxlength="200" placeholder="например: Тверская" /></label>
    <label class="field"><span>Страна, если не Россия</span><input v-model="form.country" maxlength="200" placeholder="например: Польша" /></label>
    <label class="field"><span>Как это сейчас</span><input v-model="form.now" maxlength="300" placeholder="например: Старицкий район, Тверская область" /></label>
    <label class="field"><span>Заметка</span><textarea v-model="form.note" maxlength="2000" rows="2" placeholder="Церковь, кладбище, где искать документы" /></label>
    <div v-if="form.name.trim()" class="card small preview"><span class="muted">Будет записано:</span> {{ title }}</div>
    <p class="error" v-if="error">{{ error }}</p>
    <div class="row">
      <button type="button" class="grow" @click="emit('close')">Отмена</button>
      <button class="primary grow" :disabled="saving">{{ saving ? 'Сохраняю…' : 'Сохранить' }}</button>
    </div>
  </form>
</template>

<style scoped>
.psheet h1 { font-size: 22px; }
.chips.wrap { flex-wrap: wrap; overflow: visible; }
.preview { margin: 12px 0; }
</style>
