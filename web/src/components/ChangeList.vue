<script setup>
import { computed, reactive } from 'vue';
import { store, loadTree, canEdit, toast } from '../store.js';
import { api } from '../api.js';
import { namer, opLines, opWas, restoresSomeone, moreText } from '../history.js';
import { ask } from './ask.js';

// Правки: одна строка на действие — «Елена: новое фото у Петра Ивановича», остальное под «Ещё N изменений».
const props = defineProps({ ops: { type: Array, required: true } });
const emit = defineEmits(['reverted']);
const open = reactive(new Set()); // раскрытые действия

const name = computed(() => namer(props.ops, store.idx));
const items = computed(() => props.ops.map((op) => ({ op, lines: opLines(op, name.value), was: opWas(op), restore: restoresSomeone(op) })));
const when = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const toggle = (id) => (open.has(id) ? open.delete(id) : open.add(id));

async function undo({ op, lines, restore }) {
  const who = op.user_name || 'Кто-то';
  const more = lines.length > 1 ? ` (и ${moreText(lines.length - 1).toLowerCase()})` : '';
  const ok = await ask({
    text: restore ? 'Вернуть удалённое?' : 'Отменить это действие?',
    note: `${who}: ${lines[0]}${more}`,
    yes: restore ? 'Вернуть' : 'Отменить действие',
    no: restore ? 'Не возвращать' : 'Не отменять',
  });
  if (!ok) return;
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
      <div class="muted small">{{ when(it.op.at) }}</div>
      <div class="line"><b>{{ it.op.user_name || 'Кто-то' }}:</b> {{ it.lines[0] }}</div>
      <template v-if="it.lines.length === 1 || open.has(it.op.op)">
        <div v-for="(l, i) in it.lines.slice(1)" :key="i" class="line more-line">{{ l }}</div>
        <div v-for="(w, i) in it.was" :key="'w' + i" class="muted small">{{ w }}</div>
      </template>
      <div class="row wrap actions">
        <button v-if="it.lines.length > 1" class="ghost more" :aria-expanded="open.has(it.op.op)" @click="toggle(it.op.op)">
          {{ open.has(it.op.op) ? 'Свернуть' : moreText(it.lines.length - 1) }}
        </button>
        <span class="grow" />
        <span v-if="it.op.reverted" class="muted">Отменено</span>
        <button v-else-if="canEdit()" @click="undo(it)">{{ it.restore ? 'Вернуть' : 'Отменить' }}</button>
      </div>
    </div>
    <div v-if="!items.length" class="muted">Правок пока нет</div>
  </div>
</template>

<style scoped>
.list > .op { display: block; }
.line { overflow-wrap: anywhere; }
.more-line { margin-top: 0.222rem; padding-left: 0.667rem; border-left: 3px solid var(--line); }
.actions { margin-top: 0.333rem; }
.more { color: var(--accent-text); padding-left: 0; padding-right: 0; text-decoration: underline; text-underline-offset: 3px; }
</style>
