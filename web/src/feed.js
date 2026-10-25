// Лента — общее для «Главной» (HomeView: что требует участия, ближайшие даты, коротко «Что нового»)
// и полной ленты «Что нового» (FeedView). Данные — GET /api/feed; открытая лента считается просмотренной.
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { store, canEdit, canTalk, onLive, toast } from './store.js';
import { api } from './api.js';
import { namer, opLines } from './history.js';
import { fullName, missingFields, upcomingDates, yearsText } from '@shared/names.js';
import { ask } from './components/ask.js';

const DAY = 24 * 3600 * 1000;
const dayMonth = (day, month) => new Date(Date.UTC(2000, month - 1, day)).toLocaleString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
// Что заполнить: по одной строке на пробел, если он есть хоть у кого-то.
const HINTS = [
  ['дата рождения', 'nodates', 'Нет даты рождения'],
  ['фото', 'nophoto', 'Нет фото'],
  ['родители', 'noparents', 'Не указаны родители'],
];

export function useFeed() {
  const items = ref([]);
  const asked = ref([]); // «Вас спросили»: вопросы мне без ответа
  const archive = ref(null); // владельцу: «Пора сохранить семейный архив» — { last } или null
  const left = ref([]); // свои интервью, брошенные больше суток назад
  const loaded = ref(false);
  const error = ref('');

  async function load() {
    try {
      const feed = await api('GET', '/api/feed');
      items.value = feed.items;
      asked.value = feed.asked || [];
      archive.value = feed.archive || null;
      loaded.value = true;
      error.value = '';
      await api('POST', '/api/feed/seen', { at: feed.now });
      if (store.tree) store.tree.feed_new = 0;
    } catch (e) {
      error.value = e.message;
    }
  }
  async function loadLeft() {
    if (!canTalk()) return;
    const list = await api('GET', '/api/interviews').catch(() => []);
    left.value = list.filter((x) => !x.saved && x.created_by === store.me?.id && Date.now() - new Date(x.updated_at) > DAY);
  }
  onMounted(() => { load(); loadLeft(); });
  // Лента на экране — новое сразу видно и считается просмотренным.
  onUnmounted(onLive(load));

  async function later() {
    await api('POST', '/api/archive/later').then(() => { archive.value = null; toast('Напомним через неделю'); }, (e) => toast(e.message));
  }
  const leftName = (x) => {
    const p = store.idx?.persons.get(x.person_id);
    return p ? [p.given, p.patronymic].filter(Boolean).join(' ') || fullName(p) : x.about;
  };
  async function dropLeft(x) {
    if (!await ask({ text: 'Удалить незаконченное интервью?', note: `${leftName(x)}: ${x.answered} из ${x.total} ответов. Записанные ответы пропадут.`, yes: 'Удалить', no: 'Не удалять', danger: true })) return;
    await api('DELETE', `/api/interviews/${x.id}`).then(() => toast('Интервью удалено'), (e) => toast(e.message));
    await loadLeft();
  }

  const persons = computed(() => (store.idx ? [...store.idx.persons.values()] : []));
  const dates = computed(() => upcomingDates(persons.value).map((d) => ({
    ...d,
    when: d.inDays === 0 ? 'Сегодня' : d.inDays === 1 ? 'Завтра' : dayMonth(d.day, d.month),
    text: d.kind === 'birthday' ? yearsText(d.years)
      : `${yearsText(d.years)} со дня ${d.kind === 'birth' ? 'рождения' : 'смерти'}`,
  })));
  const hints = computed(() => {
    if (!canEdit()) return [];
    const miss = persons.value.map((p) => missingFields(p, store.idx));
    return HINTS.map(([field, f, label]) => ({ f, label, n: miss.filter((m) => m.includes(field)).length })).filter((h) => h.n);
  });
  const name = computed(() => namer(items.value.filter((i) => i.kind === 'op'), store.idx));
  const feed = computed(() => items.value.map((i) => (i.kind === 'op' ? { ...i, lines: opLines(i, name.value) } : i.kind === 'comment' ? { ...i, who: name.value.gen(i.person_id) } : i)));

  return { feed, asked, archive, left, loaded, error, dates, hints, later, leftName, dropLeft };
}
