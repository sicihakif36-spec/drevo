<script setup>
import { computed } from 'vue';
import { store, loadTree, canEdit, toast } from '../store.js';
import { api } from '../api.js';
import { namer, opLines, opWas, restoresSomeone } from '../history.js';

const props = defineProps({ ops: { type: Array, required: true } });
const emit = defineEmits(['reverted']);

const name = computed(() => namer(props.ops, store.idx));
const items = computed(() => props.ops.map((op) => ({ op, lines: opLines(op, name.value), was: opWas(op), restore: restoresSomeone(op) })));
const when = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function undo({ op, lines, restore }) {
  if (!confirm(`Отменить это действие?\n\n${lines.join('\n')}`)) return;
  try {
    await api('POST', `/api/changes/${op.id}/revert`);
    await loadTree();
    emit('reverted');
    toast(restore ? 'Возвращено' : 'Отменено. Вернуть можно в «Ещё → Последние правки».');
  } catch (e) {
    toast(e.message);
  }
}
</script>

<template>
  <div class="list">
    <div v-for="it in items" :key="it.op.op" class="op">
      <div class="grow">
        <div class="small"><b>{{ it.op.user_name || 'Кто-то' }}</b> <span class="muted">· {{ when(it.op.at) }}</span></div>
        <div v-for="(l, i) in it.lines" :key="i" class="small">{{ l }}</div>
        <div v-for="(w, i) in it.was" :key="'w' + i" class="muted small">{{ w }}</div>
      </div>
      <span v-if="it.op.reverted" class="muted small">отменено</span>
      <button v-else-if="canEdit()" @click="undo(it)">{{ it.restore ? 'Вернуть' : 'Отменить' }}</button>
    </div>
    <div v-if="!items.length" class="muted">Правок пока нет</div>
  </div>
</template>

<style scoped>
.op { gap: 8px; }
</style>
