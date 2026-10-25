<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { store, canEdit, toast } from '../store.js';
import { api } from '../api.js';
import { TOPICS, IV_OWN, ivTitle, buildQuestions, namesFor } from '@shared/interview.js';
import { fullName, nameGenitive } from '@shared/names.js';
import { ask } from '../components/ask.js';
import InterviewRunner from '../components/InterviewRunner.vue';
import { shareInterview } from '../interviews.js';

// Интервью рядом: id 'new' — выбрать темы (?person=), иначе — пройти вопросы по одному.
// Владельцу и участникам ещё «Отправить ссылку» (ответит сам на своём телефоне) и «Сохранить в истории».
const props = defineProps({ id: String, person: String });
const router = useRouter();
const iv = ref(null);
const error = ref('');
const picked = ref(new Set(['childhood', 'parents']));
const own = ref([]);
const ownText = ref('');
const starting = ref(false);
const drafts = ref([]); // незаконченные интервью с этим человеком
const link = ref(null); // { url, to_name } — только что сделанная ссылка
const toName = ref('');
const linkOpen = ref(false);
const saving = ref(false);

const pid = computed(() => (props.id === 'new' ? props.person : iv.value?.person_id));
const p = computed(() => store.idx?.persons.get(pid.value));
// Как обращаться: «Клавдия Николаевна».
const called = computed(() => (p.value ? [p.value.given, p.value.patronymic].filter(Boolean).join(' ') || fullName(p.value) : iv.value?.about || ''));
const names = computed(() => (store.idx && pid.value ? namesFor(store.idx, pid.value) : {}));
const preview = (t) => buildQuestions([t.key], names.value);
const count = computed(() => [...picked.value].reduce((n, k) => n + (TOPICS.find((t) => t.key === k)?.questions.length || 0), 0) + own.value.length);

async function load() {
  error.value = '';
  link.value = null;
  if (props.id === 'new') {
    iv.value = null;
    drafts.value = props.person ? (await api('GET', `/api/interviews?person=${props.person}`).catch(() => [])).filter((x) => !x.saved) : [];
    return;
  }
  try {
    iv.value = await api('GET', `/api/interviews/${props.id}`);
  } catch (e) {
    error.value = e.message;
  }
}
watch(() => [props.id, props.person], load, { immediate: true });
const runner = ref(null);

function toggle(k) {
  const s = new Set(picked.value);
  if (s.has(k)) s.delete(k);
  else s.add(k);
  picked.value = s;
}
function addOwn() {
  const t = ownText.value.trim();
  if (!t) return;
  own.value = [...own.value, t];
  ownText.value = '';
}

async function start(viaLink = false) {
  addOwn();
  if (!count.value) {
    error.value = 'Выберите хотя бы одну тему или напишите свой вопрос.';
    return;
  }
  starting.value = true;
  error.value = '';
  try {
    const x = await api('POST', '/api/interviews', { person_id: props.person, topics: [...picked.value], own: own.value });
    await router.replace(`/interview/${x.id}`);
    if (viaLink) linkOpen.value = true;
  } catch (e) {
    error.value = e.message;
  } finally {
    starting.value = false;
  }
}

async function makeLink() {
  try {
    const r = await api('POST', `/api/interviews/${iv.value.id}/link`, { to_name: toName.value || called.value });
    link.value = { ...r, from: store.me?.name || '' };
    linkOpen.value = false;
    iv.value = await api('GET', `/api/interviews/${iv.value.id}`);
  } catch (e) { toast(e.message); }
}
async function revoke() {
  if (!await ask({ text: 'Отключить ссылку?', note: 'По ней больше нельзя будет отвечать. Уже записанные ответы останутся.', yes: 'Отключить', no: 'Не отключать', danger: true })) return;
  await api('POST', `/api/interviews/${iv.value.id}/revoke`).catch((e) => toast(e.message));
  link.value = null;
  iv.value = await api('GET', `/api/interviews/${iv.value.id}`);
}

async function save(answered) {
  if (!answered) {
    toast('Пока нет ни одного ответа');
    return;
  }
  const n = answered;
  if (!await ask({
    text: 'Сохранить в истории?',
    note: `Ответы станут историями в карточке ${p.value ? nameGenitive(p.value) : called.value} — ${n} ${n % 10 === 1 && n % 100 !== 11 ? 'история' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'истории' : 'историй'}. Пропущенные вопросы не сохраняются. Отменить можно в «Ещё → Последние правки».`,
    yes: 'Сохранить', no: 'Ещё не сохранять',
  })) return;
  saving.value = true;
  try {
    const r = await api('POST', `/api/interviews/${iv.value.id}/save`);
    toast(`Сохранено в истории: ${r.stories}${r.photos ? `, фото: ${r.photos}` : ''}`);
    router.replace({ path: `/person/${iv.value.person_id}`, hash: '#sec-stories' });
  } catch (e) {
    toast(e.message);
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!await ask({ text: 'Удалить это интервью?', note: iv.value.saved ? 'Истории, уже сохранённые в карточке, останутся.' : 'Записанные ответы пропадут из приложения.', yes: 'Удалить', no: 'Не удалять', danger: true })) return;
  await api('DELETE', `/api/interviews/${iv.value.id}`).catch((e) => toast(e.message));
  toast('Интервью удалено');
  router.back();
}
const until = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
</script>

<template>
  <div class="page iv">
    <div class="row top"><button class="ghost" @click="router.back()">‹ Назад</button></div>
    <p v-if="error && !iv && id !== 'new'" class="error">{{ error }}</p>

    <!-- Новое интервью: темы -->
    <template v-if="id === 'new'">
      <h1>Записать воспоминания</h1>
      <p v-if="called" class="lead">Интервью: <b>{{ called }}</b></p>
      <div class="card how">
        Сядьте рядом. На экране будет по одному вопросу — нажмите «Записать», и пусть {{ called || 'человек' }} рассказывает.
        Каждый ответ сохраняется сразу: можно прерваться и продолжить потом.
      </div>

      <div v-for="d in drafts" :key="d.id" class="banner draft">
        <div>Есть незаконченное интервью — {{ ivTitle(d.created_at).replace('Интервью ', '') }}: {{ d.answered }} из {{ d.total }} ответов.</div>
        <router-link class="btn primary block" :to="`/interview/${d.id}`">Продолжить интервью</router-link>
      </div>

      <h2>О чём спросить</h2>
      <div class="topics">
        <button v-for="t in TOPICS" :key="t.key" type="button" class="topic" :class="{ on: picked.has(t.key) }" :aria-pressed="picked.has(t.key)" @click="toggle(t.key)">
          <span class="tick" aria-hidden="true">{{ picked.has(t.key) ? '✓' : '' }}</span>
          <span class="grow">
            <span class="t">{{ t.title }}</span>
            <span class="muted small">{{ t.questions.length }} вопросов · «{{ preview(t)[0].text }}»</span>
          </span>
        </button>
      </div>

      <h2>Свой вопрос</h2>
      <div v-for="(t, n) in own" :key="n" class="card ownq">
        <span class="grow">{{ t }}</span>
        <button class="ghost danger small" @click="own = own.filter((_, k) => k !== n)">Убрать</button>
      </div>
      <label class="field"><span>Можно добавить и потом, по ходу интервью</span>
        <textarea v-model="ownText" :maxlength="IV_OWN" rows="2" placeholder="Например: Как звали вашу первую учительницу?" />
      </label>
      <button v-if="ownText.trim()" class="block" @click="addOwn">+ Добавить вопрос</button>

      <p v-if="error" class="error">{{ error }}</p>
      <button class="primary block huge" :disabled="starting" @click="start(false)">{{ starting ? 'Готовлю…' : `Начать интервью · ${count} вопросов` }}</button>
      <button v-if="canEdit()" class="block far" :disabled="starting" @click="start(true)">Отправить ссылку — пусть ответит на своём телефоне</button>
    </template>

    <!-- Идёт интервью -->
    <template v-else-if="iv">
      <h1 class="title">{{ called }}</h1>
      <div class="muted small sub">{{ ivTitle(iv.created_at) }}{{ iv.by_name ? ` · начал(а) ${iv.by_name}` : '' }}</div>

      <div v-if="iv.saved" class="card saved">
        <p><b>Интервью сохранено в истории.</b> Ответы — в карточке, в разделе «Истории».</p>
        <router-link class="btn primary block" :to="{ path: `/person/${iv.person_id}`, hash: '#sec-stories' }">Открыть истории</router-link>
        <p class="muted small">Отменить сохранение можно в «Ещё → Последние правки» — тогда интервью снова можно дописать.</p>
      </div>

      <template v-else>
        <div v-if="canEdit() && (iv.link || linkOpen || link)" class="card linkbox">
          <template v-if="link">
            <p><b>Ссылка готова.</b> Отправьте её — по ней {{ iv.to_name || called }} ответит на вопросы голосом на своём телефоне, можно в несколько заходов. Дерево по ссылке не открывается.</p>
            <div class="row">
              <button class="primary grow" @click="shareInterview(link, 'share')">Поделиться</button>
              <button class="grow" @click="shareInterview(link, 'copy')">Скопировать</button>
            </div>
            <p class="url small">{{ link.url }}</p>
          </template>
          <template v-else-if="linkOpen">
            <label class="field"><span>Для кого ссылка</span><input v-model="toName" :placeholder="called" maxlength="80" /></label>
            <button class="primary block" @click="makeLink">Сделать ссылку</button>
          </template>
          <template v-else>
            <p>
              Ссылка{{ iv.to_name ? ` (${iv.to_name})` : '' }}:
              {{ iv.revoked ? 'отключена' : new Date(iv.expires_at) < new Date() ? 'срок истёк' : `${iv.opened_at ? 'открывали' : 'ещё не открывали'}, действует до ${until(iv.expires_at)}` }}.
            </p>
            <div class="row wrap">
              <button class="grow" @click="makeLink">Новая ссылка</button>
              <button v-if="!iv.revoked" class="danger grow" @click="revoke">Отключить</button>
            </div>
          </template>
        </div>

        <InterviewRunner ref="runner" :key="iv.id" :base="`/api/interviews/${iv.id}`" :data="iv" :scope="iv.id">
          <template #done="{ answered, skipped, total }">
            <div class="card done">
              <h2>Вопросы закончились</h2>
              <p>Ответов: <b>{{ answered }}</b> из {{ total }}{{ skipped ? `, пропущено: ${skipped}` : '' }}.</p>
              <template v-if="canEdit()">
                <button class="primary block huge" :disabled="saving || !answered" @click="save(answered)">{{ saving ? 'Сохраняю…' : 'Готово — сохранить в истории' }}</button>
                <p class="muted small">Каждый ответ станет историей с записью голоса. Пропущенные вопросы историй не создают.</p>
              </template>
              <p v-else class="muted">Всё записано. Сохранить ответы в дерево сможет участник или владелец — они видят это интервью в «Ещё → Интервью».</p>
            </div>
          </template>
        </InterviewRunner>

        <div class="list foot">
          <a v-if="canEdit() && !iv.link && !linkOpen" href="#" @click.prevent="linkOpen = true">Отправить ссылку — пусть ответит на своём телефоне</a>
          <a v-if="canEdit() && runner?.answered" href="#" @click.prevent="save(runner.answered)">Сохранить в истории сейчас</a>
          <a href="#" class="danger-link" @click.prevent="remove">Удалить интервью</a>
        </div>
      </template>
    </template>
    <p v-else-if="!error" class="muted">Загрузка…</p>
  </div>
</template>

<style scoped>
.top { margin-bottom: 0.444rem; }
.lead { font-size: 1.111rem; margin: 0 0 0.667rem; }
.how { line-height: 1.5; margin-bottom: 0.667rem; }
.draft { display: grid; gap: 0.444rem; font-size: 1rem; }
.topics { display: grid; gap: 0.444rem; }
.topic { justify-content: flex-start; text-align: left; font-weight: 400; color: var(--text); border: 2px solid var(--line); background: var(--card); padding: 0.556rem 0.778rem; }
.topic.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-soft-text); }
.topic .t { display: block; font-weight: 700; font-size: 1.056rem; }
.topic .small { display: block; }
.tick { flex: none; width: 1.778rem; height: 1.778rem; border-radius: 0.444rem; border: 2px solid var(--field); display: grid; place-items: center; font-weight: 700; }
.topic.on .tick { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.ownq { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.444rem; padding-top: 0.444rem; padding-bottom: 0.444rem; }
.huge { min-height: 3.556rem; font-size: 1.111rem; margin-top: 1rem; }
.far { margin-top: 0.556rem; }
.title { margin-bottom: 0.111rem; overflow-wrap: anywhere; }
.sub { margin-bottom: 0.889rem; }
.saved p, .linkbox p, .done p { margin: 0 0 0.556rem; }
.saved, .linkbox { margin-bottom: 0.889rem; }
.url { overflow-wrap: anywhere; color: var(--muted); margin: 0.444rem 0 0 !important; }
.done { margin-top: 0.444rem; }
.done h2 { margin-top: 0; }
.foot { margin-top: 1.333rem; }
.danger-link { color: var(--danger) !important; }
</style>
