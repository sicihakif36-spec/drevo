<script setup>
import { computed, ref, useId, watch } from 'vue';
import { OLD_STYLE, isOldStyle, withOldStyle, canBeOldStyle, dateText, exactDate } from '@shared/names.js';

// Поле даты с галочкой «по старому стилю» (до 14.02.1918): пометка «ст. ст.» хранится в конце текста даты,
// поэтому старые даты читаются как раньше. Под полем — как дата покажется в обоих стилях.
const props = defineProps({ modelValue: String, label: String, placeholder: String, maxlength: { type: [Number, String], default: 100 } });
const emit = defineEmits(['update:modelValue']);
const id = useId();

const old = ref(isOldStyle(props.modelValue));
const text = ref(withOldStyle(props.modelValue, false));
const value = () => (old.value && text.value.trim() ? `${text.value.trim()} ${OLD_STYLE}` : text.value);
watch(() => props.modelValue, (v) => {
  if ((v || '') === value()) return;
  old.value = isOldStyle(v);
  text.value = withOldStyle(v, false);
});
watch([text, old], () => emit('update:modelValue', value()));

const offer = computed(() => old.value || canBeOldStyle(text.value));
const shown = computed(() => (old.value && exactDate(value()) ? dateText(value()) : ''));
// Число в виде даты, но такого дня по старому стилю нет (например, позже 31.01.1918).
const wrong = computed(() => old.value && !shown.value && /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(text.value.trim()));
</script>

<template>
  <div class="field date">
    <label :for="id" class="label">{{ label }}</label>
    <input :id="id" v-model="text" :maxlength="maxlength" :placeholder="placeholder" inputmode="text" autocomplete="off" />
    <label v-if="offer" class="old"><input v-model="old" type="checkbox" /> по старому стилю</label>
    <div v-if="shown" class="muted small">По двум стилям: {{ shown }}</div>
    <div v-if="wrong" class="error">Такой даты по старому стилю нет: в России он действовал до 31 января 1918 года.</div>
  </div>
</template>

<style scoped>
/* Подпись — как у остальных полей (.field > span). */
.date > .label { display: block; font-size: 0.889rem; font-weight: 700; color: var(--text); margin-bottom: 0.25rem; }
.old { display: flex; align-items: center; gap: 0.444rem; margin-top: 0.333rem; min-height: 2.667rem; }
.old input { width: 1.333rem; height: 1.333rem; min-height: 0; margin: 0; flex: none; }
.date .error { margin: 4px 0 0; }
</style>
