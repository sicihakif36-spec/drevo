// Что показано на экране «Дерево»: вид, с кого начато, поколения, линия родни.
// Одно на дерево и печать: «Печать → Дерево» печатает ровно то, что сейчас на экране, а поменять можно и там, и там.
import { reactive, watch } from 'vue';

// Ветка выбранного человека — его предки и потомки (hourglass, по умолчанию), его родня по одной линии (kin),
// только предки, только потомки или всё дерево — все ветки сразу.
export const MODES = ['hourglass', 'kin', 'ancestors', 'descendants', 'all'];

const saved = (() => { try { return JSON.parse(localStorage.getItem('drevo.view') || '{}'); } catch { return {}; } })();
export const view = reactive({
  mode: MODES.includes(saved.mode) ? saved.mode : 'hourglass',
  up: saved.up ?? 4,
  down: saved.down ?? 3,
  // Родня: по какой линии (shared/kin.js) и сколько поколений вверх до общих предков (null — как принято у линии).
  line: saved.line || 'father',
  kinUp: Number.isFinite(saved.kinUp) ? saved.kinUp : null,
  root: saved.root || null, // с кого начато; null — с себя (или с начала дерева)
});
watch(view, () => { try { localStorage.setItem('drevo.view', JSON.stringify(view)); } catch {} });
