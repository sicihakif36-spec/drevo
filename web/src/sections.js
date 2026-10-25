// Разделы приложения по смыслу — общие для плиток «Главной» и бокового меню на компьютере.
// Каждому — только то, что ему можно; пустые группы не показываются. Новый раздел добавлять сюда.
import { computed } from 'vue';
import { store, canEdit, canTalk, isOwner, isAdmin } from './store.js';
import { findings } from './checks.js';

export const PLURAL = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many}`;

export const sections = computed(() => {
  const n = store.idx ? store.idx.persons.size : 0;
  return [
    { title: 'Семья', tiles: [
      { to: '/tree', icon: 'tree', title: 'Дерево', hint: 'все родные на одном экране' },
      { to: '/people', icon: 'people', title: 'Люди', hint: n ? `в дереве ${PLURAL(n, 'человек', 'человека', 'человек')}` : 'список и поиск' },
      { to: '/places', icon: 'place', title: 'Места', hint: 'где родились, жили, похоронены' },
      { to: '/feed', icon: 'news', title: 'Что нового', hint: 'все правки и сообщения', dot: store.tree?.feed_new },
    ] },
    { title: 'Воспоминания', tiles: [
      canTalk() && { to: '/interviews', icon: 'mic', title: 'Интервью', hint: 'воспоминания старших голосом' },
      canEdit() ? { to: '/asks', icon: 'ask', title: 'Вопросы родным', hint: 'спросить, ответы — в дерево', count: store.tree?.asks_waiting }
        : canTalk() && store.tree?.asks_waiting && { to: '/asks', icon: 'ask', title: 'Вас спросили', hint: 'ответьте родным', count: store.tree.asks_waiting },
      canEdit() && { to: '/surveys', icon: 'form', title: 'Анкеты', hint: 'родные заполняют без входа' },
    ] },
    { title: 'Уточнить дерево', tiles: [
      canEdit() && { to: '/checks', icon: 'check', title: 'Проверка дерева', hint: findings.value.length ? `вопросов к данным: ${findings.value.length}` : 'ошибки в датах, двойники', count: findings.value.length },
      canEdit() && { to: '/research', icon: 'search', title: 'Исследование', hint: 'поиск предков в архивах' },
      canEdit() && { to: '/names', icon: 'pen', title: 'Написание имён', hint: 'татарское и русское' },
      canTalk() && { to: '/changes', icon: 'history', title: 'Последние правки', hint: 'кто что изменил, отменить' },
    ] },
    { title: 'Печать и копии', tiles: [
      { to: '/print', icon: 'print', title: 'Печать', hint: 'плакат, веер предков, роспись' },
      isOwner() && { to: '/archive', icon: 'archive', title: 'Скачать всё', hint: 'семейный архив на память' },
      { href: '/api/export.ged', icon: 'download', title: 'Файл GEDCOM', hint: 'дерево для другой программы' },
      canEdit() && { to: '/import', icon: 'upload', title: 'Загрузить из файла', hint: 'из другой программы' },
    ] },
    { title: 'Управление', tiles: [
      isOwner() && { to: '/family', icon: 'invite', title: 'Родственники', hint: 'приглашения, права, входы' },
      isAdmin() && { to: '/tenants', icon: 'server', title: 'Семьи на сервере', hint: 'дерево другой семье' },
    ] },
    { title: 'Помощь', tiles: [
      { to: '/help', icon: 'help', title: 'Как пользоваться', hint: 'для чего Древо и что где' },
    ] },
  ].map((g) => ({ ...g, tiles: g.tiles.filter(Boolean) })).filter((g) => g.tiles.length);
});
