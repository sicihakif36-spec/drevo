<script setup>
import { computed, ref, watch } from 'vue';
import { FIELDS, ROLES, suggest, filled } from '@shared/survey.js';
import { guessSex } from '@shared/names.js';
import { vGrow } from '../grow.js';

// Один человек в анкете: крупные поля, обязательно только имя. Отчество и фамилии подставляются по родству,
// пока человек их не поменял сам; пол угадывается по имени.
const props = defineProps({ person: Object, role: String, answers: Object, removable: Boolean });
const emit = defineEmits(['remove']);
const p = props.person;
const r = ROLES[props.role];
const sexTouched = ref(Boolean(r.sex) || p.sex !== 'U');

// Последняя подсказка: если поле всё ещё равно ей (или пустое), меняем вместе с родством.
const last = {};
watch(() => suggest(props.answers, props.role, p), (s) => {
  for (const [k, v] of Object.entries(s)) {
    if ((!p[k] || p[k] === last[k]) && v) p[k] = v;
    last[k] = v;
  }
}, { immediate: true, deep: true });

watch(() => [p.given, p.patronymic], () => {
  // Подставленное отчество пол не решает: оно само выбрано по полу.
  const own = p.patronymic === last.patronymic ? '' : p.patronymic;
  if (!sexTouched.value && (p.given.trim() || own.trim())) p.sex = guessSex(p.given, own);
});
function setSex(s) { p.sex = s; sexTouched.value = true; }

const her = computed(() => p.sex === 'F');
const fields = computed(() => FIELDS.filter((f) => !['sex', 'living'].includes(f.kind) && (!f.dead || p.living === false)));
const spouses = computed(() => (props.answers.people.spouse || []).filter(filled));
const heading = computed(() => (props.role === 'self' ? 'Вы' : r.label));
</script>

<template>
  <section class="person card">
    <div class="row head">
      <h2 class="grow">{{ heading }}<span v-if="filled(p) && role !== 'self'">: {{ p.given }}</span></h2>
      <button v-if="removable" type="button" class="ghost danger" @click="emit('remove')">Убрать</button>
    </div>
    <template v-for="f in fields" :key="f.key">
      <label class="field">
        <span>{{ f.label }}<template v-if="f.key === 'given'"> (обязательно)</template><template v-if="f.hint"> — {{ f.hint }}</template></span>
        <textarea v-if="f.kind === 'text'" v-model="p[f.key]" maxlength="2000" rows="3" />
        <textarea v-else-if="f.kind === 'place'" v-model="p[f.key]" v-grow class="line" rows="1" maxlength="300" :placeholder="f.placeholder"
          @keydown.enter.prevent />
        <input v-else v-model="p[f.key]" maxlength="300" :placeholder="f.placeholder" autocomplete="off"
          :autocapitalize="['given', 'patronymic', 'surname', 'birth_surname'].includes(f.key) ? 'words' : 'sentences'" />
      </label>
      <template v-if="f.key === 'birth_surname'">
        <div v-if="!r.sex" class="field">
          <span class="muted small">Пол</span>
          <div class="seg big">
            <button type="button" :class="{ on: p.sex === 'M' }" @click="setSex('M')">Мужчина</button>
            <button type="button" :class="{ on: p.sex === 'F' }" @click="setSex('F')">Женщина</button>
          </div>
        </div>
        <!-- Кто заполняет — жив, о нём не спрашиваем. -->
        <div v-if="role !== 'self'" class="field">
          <span class="muted small">{{ her ? 'Она' : 'Он' }}</span>
          <div class="seg big">
            <button type="button" :class="{ on: p.living === true }" @click="p.living = true">{{ her ? 'Жива' : 'Жив' }}</button>
            <button type="button" :class="{ on: p.living === false }" @click="p.living = false">{{ her ? 'Умерла' : 'Умер' }}</button>
          </div>
        </div>
      </template>
    </template>
    <div v-if="role === 'child' && spouses.length > 1" class="field">
      <span class="muted small">Второй родитель</span>
      <div class="seg big col">
        <button v-for="s in spouses" :key="s.id" type="button" :class="{ on: p.parent2 === s.id }" @click="p.parent2 = s.id">{{ [s.given, s.surname].filter(Boolean).join(' ') }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.person { margin-top: 12px; padding-top: 6px; }
.head h2 { margin: 10px 0 4px; color: var(--text); font-size: 20px; }
.person .field > span { font-size: 15px; }
.person input, .person textarea { font-size: 18px; }
.seg.big button { min-height: 50px; font-size: 17px; }
.seg.col { flex-direction: column; }
</style>
