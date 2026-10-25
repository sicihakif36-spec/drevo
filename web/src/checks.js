// Проверка дерева на телефоне: находки считаются по уже загруженному дереву (shared/checks.js), отметки «Всё верно»
// приходят вместе с деревом — только владельцу и участникам. Родственнику и гостю — ничего.
import { computed, toRaw } from 'vue';
import { store, canEdit, loadTree } from './store.js';
import { api } from './api.js';
import { checkTree, openFindings, activeMarks, LEVELS } from '@shared/checks.js';

// Считаем один раз на каждое новое дерево (оно приходит целиком после каждой правки).
let cache = { tree: null, list: [] };
const all = computed(() => {
  const tree = store.tree;
  if (!tree || !store.idx || !canEdit()) return [];
  if (cache.tree !== toRaw(tree)) cache = { tree: toRaw(tree), list: checkTree(toRaw(tree), { idx: toRaw(store.idx) }) };
  return cache.list;
});
// Ещё не проверенные находки, самые важные первыми.
export const findings = computed(() => openFindings(all.value, store.tree?.check_marks || []));
// Отмеченные как верные — те, что сейчас что-то скрывают.
export const marked = computed(() => activeMarks(all.value, store.tree?.check_marks || []));
export const findingsOf = (id) => findings.value.filter((x) => x.persons.includes(id));
export const countLevels = computed(() => Object.fromEntries(LEVELS.map((l) => [l, findings.value.filter((x) => x.level === l).length])));

export async function markOk(x) {
  await api('POST', '/api/checks/marks', { key: x.key });
  await loadTree();
}
export async function unmark(key) {
  await api('DELETE', `/api/checks/marks?key=${encodeURIComponent(key)}`);
  await loadTree();
}

// Куда ведёт «Исправить»: правка нужного человека или «Убрать связь» в его карточке.
export function fixRoute(x) {
  if (x.links) return { path: `/person/${x.fix}`, query: { links: '1' } };
  if (x.level === 'alone') return { path: `/person/${x.fix}` };
  return { path: `/person/${x.fix}`, query: { edit: '1' } };
}
export const mergeRoute = (x) => ({ path: '/merge', query: { a: x.persons[0], b: x.persons[1] } });
