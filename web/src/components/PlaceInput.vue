<script setup>
import { computed, ref, useId } from 'vue';
import { store } from '../store.js';
import { api } from '../api.js';
import { placeKey, suggestPlaces } from '@shared/places.js';

// Поле места с подсказкой: начинаешь писать — предлагаются места из справочника и уже встречавшиеся в дереве,
// чтобы одну деревню не записали пятью способами. Можно выбрать подсказку, а можно написать своё.
const props = defineProps({ modelValue: String, label: String, placeholder: String, maxlength: { type: [Number, String], default: 300 } });
const emit = defineEmits(['update:modelValue']);
const id = useId();
const open = ref(false);

const used = ref(usedCache);
const places = computed(() => store.tree?.places || []);
const value = computed(() => props.modelValue || '');
const list = computed(() => {
  if (!open.value || value.value.trim().length < 2) return [];
  const found = suggestPlaces(value.value, places.value, used.value);
  // Уже написано ровно так — подсказывать нечего.
  return found.length === 1 && found[0].text === value.value.trim() ? [] : found;
});
const known = computed(() => places.value.find((p) => placeKey(p.title) === placeKey(value.value)));

function focus() {
  open.value = true;
  // Места из дерева — раз в минуту, они нужны только для подсказки.
  if (Date.now() - usedAt > 60000) {
    usedAt = Date.now();
    api('GET', '/api/places/used').then((x) => { usedCache = x; used.value = x; }).catch(() => {});
  }
}
function pick(s) {
  emit('update:modelValue', s.text);
  open.value = false;
}
</script>

<script>
let usedCache = [];
let usedAt = 0;
</script>

<template>
  <div class="field place">
    <label :for="id">{{ label }}</label>
    <input :id="id" :value="modelValue" :maxlength="maxlength" :placeholder="placeholder" autocomplete="off" role="combobox"
      :aria-expanded="list.length > 0" :aria-controls="`${id}-list`"
      @input="emit('update:modelValue', $event.target.value); open = true" @focus="focus" @blur="open = false" @keydown.esc="open = false" />
    <div v-if="list.length" :id="`${id}-list`" class="hints" role="listbox">
      <button v-for="s in list" :key="s.text" type="button" role="option" @mousedown.prevent @click="pick(s)">
        <span class="t">{{ s.text }}</span>
        <span class="muted small">{{ s.place ? (s.place.now ? `из справочника · сейчас: ${s.place.now}` : 'из справочника') : 'уже есть в дереве' }}</span>
      </button>
    </div>
    <div v-else-if="known" class="muted small ok">✓ из справочника{{ known.now ? ` · сейчас: ${known.now}` : '' }}</div>
  </div>
</template>

<style scoped>
.place { position: relative; }
.place > label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 4px; }
.hints { margin-top: 4px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; box-shadow: 0 6px 20px rgba(0,0,0,.12); }
.hints button { display: block; width: 100%; text-align: left; background: transparent; border-radius: 0; padding: 10px 12px; min-height: 52px; border-top: 1px solid var(--line); }
.hints button:first-child { border-top: 0; }
.hints .t { display: block; font-size: 16px; overflow-wrap: anywhere; }
.hints .small { display: block; }
.ok { margin-top: 4px; }
</style>
