<script setup>
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { store, canEdit, loadTree, toast } from '../store.js';
import { api } from '../api.js';
import { fullName, lifespan, altName, isTatarName, suggestRussian } from '@shared/names.js';

// «Главная → Написание имён»: кто записан по-татарски (татарские буквы или отчество «… улы» / «… кызы»), а второго написания нет.
// Рядом — подсказка, как по-русски; сохранить по одному или всех отмеченных одним действием (отменяется одной кнопкой).
const router = useRouter();
const PAGE = 50;
const limit = ref(PAGE);
const busy = ref(false);
const picked = reactive({}); // id -> отмечен ли; без отметки — как по умолчанию (подсказка полная)

const people = computed(() => [...(store.idx?.persons.values() || [])]
  .filter((p) => isTatarName(p) && !altName(p))
  .sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru'))
  .map((p) => {
    const s = suggestRussian(p);
    // Отчество не подсказалось — не отмечаем сами: пусть впишут в карточке.
    const full = !p.patronymic || Boolean(s.alt_patronymic);
    return { p, s, full, text: [s.alt_surname, s.alt_given, s.alt_patronymic].filter(Boolean).join(' ') };
  }));
const shown = computed(() => people.value.slice(0, limit.value));
const isOn = (x) => picked[x.p.id] ?? x.full;
const chosen = computed(() => people.value.filter(isOn));

async function save(list) {
  if (!list.length) return;
  busy.value = true;
  try {
    const r = await api('POST', '/api/persons/alt-names', { items: list.map((x) => ({ id: x.p.id, ...x.s })) });
    await loadTree();
    toast(list.length === 1 ? 'Сохранено. Отменить можно в «Главная → Последние правки».'
      : `Сохранено: ${r.saved}. Отменить все сразу можно в «Главная → Последние правки».`);
  } catch (e) { toast(e.message); } finally { busy.value = false; }
}
const edit = (x) => router.push({ path: `/person/${x.p.id}`, query: { edit: 1 } });
</script>

<template>
  <div class="page" v-if="!canEdit()"><p class="muted">Написание имён — для владельца и участников.</p></div>
  <div class="page" v-else>
    <div class="row" style="margin-bottom:0.444rem">
      <button class="ghost" @click="router.back()" aria-label="Назад">‹ Назад</button>
    </div>
    <h1>Написание имён</h1>
    <p class="muted intro">Здесь те, кто записан по-татарски, а как в документах (по-русски) — не указано.
      Рядом — подсказка. Проверьте её и сохраните: человека будут находить по обоим написаниям, а в печати будут видны оба.</p>

    <div v-if="!store.tree" class="muted">Загрузка…</div>
    <div v-else-if="!people.length" class="card ok">У всех, кто записан по-татарски, уже есть второе написание.</div>
    <template v-else>
      <div class="list">
        <div v-for="x in shown" :key="x.p.id" class="item">
          <label class="pick">
            <input type="checkbox" :checked="isOn(x)" @change="picked[x.p.id] = $event.target.checked" />
            <span class="grow">
              <span class="name">{{ fullName(x.p) }}</span>
              <span v-if="lifespan(x.p)" class="muted small"> · {{ lifespan(x.p) }}</span>
              <span class="ru">По-русски: <b>{{ x.text }}</b></span>
              <span v-if="!x.full" class="small warn">Отчество «{{ x.p.patronymic }}» подсказать не получилось — впишите в карточке.</span>
            </span>
          </label>
          <div class="acts">
            <button class="ghost" @click="edit(x)">Изменить</button>
            <button :disabled="busy" @click="save([x])">Сохранить</button>
          </div>
        </div>
      </div>
      <button v-if="people.length > shown.length" class="ghost block more" @click="limit += PAGE">
        Показать ещё {{ Math.min(PAGE, people.length - shown.length) }} из {{ people.length - shown.length }}
      </button>
      <div class="bar">
        <button class="primary block" :disabled="busy || !chosen.length" @click="save(chosen)">
          {{ busy ? 'Сохраняю…' : `Сохранить все отмеченные (${chosen.length})` }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.intro { margin-top: 0; }
.ok { font-weight: 700; }
.list > .item { display: block; }
.pick { display: flex; gap: 0.667rem; align-items: flex-start; cursor: pointer; }
.pick input { width: 1.556rem; height: 1.556rem; margin-top: 0.167rem; flex: none; }
.name { font-weight: 700; overflow-wrap: anywhere; }
.ru { display: block; margin-top: 0.222rem; overflow-wrap: anywhere; }
.warn { display: block; color: var(--warn-text); margin-top: 0.222rem; }
.acts { display: flex; gap: 0.5rem; margin-top: 0.444rem; padding-left: 2.222rem; }
.acts > button { flex: 1 1 auto; min-height: 2.667rem; font-size: 0.889rem; }
.more { margin-top: 0.333rem; color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; }
.bar { position: sticky; bottom: calc(var(--nav-h) + 0.5rem + var(--safe-b)); margin-top: 0.889rem; }
</style>
