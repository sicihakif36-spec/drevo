import { reactive } from 'vue';

export const addState = reactive({ open: false, relation: null });

// relation: { to, type } — type: father | mother | spouse | child | sibling | null (спросить)
export function openAdd(relation) {
  addState.relation = relation;
  addState.open = true;
}
export function closeAdd() {
  addState.open = false;
}
