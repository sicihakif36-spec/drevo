<script setup>
import { computed, ref } from 'vue';
import { store, toast } from '../store.js';
import { fullName } from '@shared/names.js';
import { markOk, fixRoute, mergeRoute } from '../checks.js';
import { ask } from './ask.js';

// Одна находка проверки дерева: фраза, люди (переход в карточку) и что с ней сделать.
// plain — без списка людей (в карточке человека они и так понятны).
const props = defineProps({ finding: { type: Object, required: true }, plain: Boolean });
const busy = ref(false);
const people = computed(() => props.finding.persons.map((id) => store.idx?.persons.get(id)).filter(Boolean));
const dup = computed(() => props.finding.level === 'dup');

async function ok() {
  const x = props.finding;
  const yes = await ask({
    text: dup.value ? 'Это разные люди?' : 'Здесь всё верно?',
    note: dup.value
      ? 'Пара пропадёт из проверки у всех. Если данные этих людей изменятся, приложение спросит снова.'
      : 'Находка пропадёт из проверки у всех. Если данные этих людей изменятся, приложение спросит снова.',
    yes: dup.value ? 'Да, разные' : 'Да, всё верно',
    no: 'Отмена',
  });
  if (!yes) return;
  busy.value = true;
  try {
    await markOk(x);
    toast('Отмечено. Вернуть можно в «Проверке дерева».');
  } catch (e) {
    toast(e.message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="finding" :class="plain ? 'plain' : `lv-${finding.level}`">
    <div class="text">{{ finding.text }}</div>
    <div v-if="!plain && people.length" class="who">
      <router-link v-for="p in people" :key="p.id" :to="`/person/${p.id}`" class="person">{{ fullName(p) }}</router-link>
    </div>
    <div class="acts">
      <router-link v-if="dup" class="btn primary" :to="mergeRoute(finding)">Объединить</router-link>
      <router-link v-else class="btn primary" :to="fixRoute(finding)">Исправить</router-link>
      <button :disabled="busy" @click="ok">{{ dup ? 'Это разные люди' : 'Всё верно' }}</button>
    </div>
  </div>
</template>

<style scoped>
.finding { display: block !important; }
.text { overflow-wrap: anywhere; }
.who { display: flex; flex-wrap: wrap; gap: 0.25rem 0.889rem; margin-top: 0.333rem; }
.person { font-size: 0.889rem; font-weight: 700; color: var(--accent-text); overflow-wrap: anywhere; }
.acts { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.556rem; }
.acts > * { flex: 1 1 7rem; text-align: center; box-sizing: border-box; }
/* В карточке человека — неброско: кнопки ниже и мельче. */
.plain .acts > * { min-height: 2.667rem; font-size: 0.889rem; padding: 0.333rem 0.667rem; }
.lv-error { box-shadow: inset 4px 0 var(--danger); }
.lv-warn { box-shadow: inset 4px 0 var(--oral); }
</style>
