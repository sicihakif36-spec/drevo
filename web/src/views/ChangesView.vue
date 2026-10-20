<script setup>
import { onMounted, ref } from 'vue';
import { store, loadTree, canEdit, toast } from '../store.js';
import { api } from '../api.js';
import { fullName } from '@shared/names.js';

const items = ref([]);
const load = async () => { items.value = await api('GET', '/api/changes'); };
onMounted(load);
const ACTION = { create: 'добавил(а)', update: 'изменил(а) карточку', delete: 'удалил(а)', restore: 'восстановил(а)', photo: 'сменил(а) фото', add_child: 'добавил(а) ребёнка в семью', set_partner: 'указал(а) супруга или родителя', unset_partner: 'убрал(а) связь', remove_child: 'убрал(а) ребёнка из семьи' };
const nameOf = (c) => {
  const p = store.idx?.persons.get(c.entity_id);
  if (p) return fullName(p);
  if (c.entity === 'person') return fullName(c.before?.person || c.after || {});
  return '';
};
const when = (t) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
async function undo(c) {
  await api('POST', `/api/changes/${c.id}/revert`);
  await loadTree();
  await load();
  toast('Восстановлено');
}
</script>

<template>
  <div class="page">
    <h1>Последние правки</h1>
    <div class="list">
      <div v-for="c in items.filter((x) => x.entity === 'person')" :key="c.id">
        <div class="grow">
          <div class="small"><b>{{ c.user_name || 'Кто-то' }}</b> {{ ACTION[c.action] || c.action }}</div>
          <router-link v-if="store.idx?.persons.has(c.entity_id)" :to="`/person/${c.entity_id}`" class="small">{{ nameOf(c) }}</router-link>
          <span v-else class="small">{{ nameOf(c) }}</span>
          <div class="muted small">{{ when(c.at) }}</div>
        </div>
        <button v-if="canEdit() && c.action === 'delete' && !c.reverted_by && !store.idx?.persons.has(c.entity_id)" @click="undo(c)">Вернуть</button>
      </div>
      <div v-if="!items.length" class="muted">Пока ничего</div>
    </div>
  </div>
</template>
