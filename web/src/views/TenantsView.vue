<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { toast } from '../store.js';
import { api } from '../api.js';
import { ask } from '../components/ask.js';
import { whenText } from '../when.js';
import { sizeText } from '../size.js';

// «Семьи на сервере» — владельцам главной семьи (server/src/routes/tenants.js): ссылка «Завести своё дерево»
// и список семей. Самих деревьев других семей здесь нет — только название, владельцы, сколько людей и места.
const DAYS = [[1, '1 день'], [3, '3 дня'], [7, '7 дней'], [14, '14 дней']];
const GB = 1024;
const QUOTAS = [1, 2, 5, 10, 20, 50, 100].map((g) => g * GB);
const label = ref('');
const days = ref(7);
const link = ref(null);
const links = ref([]);
const data = ref(null);
const full = computed(() => data.value && data.value.count >= data.value.max);

async function load() {
  [data.value, links.value] = await Promise.all([api('GET', '/api/tenants'), api('GET', '/api/tenant-links')]);
}
onMounted(load);

const linkCard = ref(null);
async function create() {
  try {
    link.value = { ...(await api('POST', '/api/tenant-links', { label: label.value, days: days.value })), label: label.value, days: days.value };
  } catch (e) {
    toast(e.message);
    return;
  }
  label.value = '';
  load();
  await nextTick();
  linkCard.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function share(l) {
  const text = `Заведите своё семейное дерево в приложении «Древо». Ссылка открывается один раз: ${l.url}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Семейное древо', text }); return; } catch { /* отмена */ }
  }
  await navigator.clipboard?.writeText(l.url);
  toast('Ссылка скопирована');
}
async function drop(l) {
  if (!await ask({ text: `Отключить ссылку${l.label ? ` «${l.label}»` : ''}?`, note: 'Завести дерево по ней будет нельзя. Если нужно, сделайте новую.', yes: 'Отключить ссылку', no: 'Не отключать', danger: true })) return;
  await api('DELETE', `/api/tenant-links/${l.id}`);
  load();
}

const quotaMb = (t) => Math.round(t.quota / 1024 / 1024);
const quotaChoices = (t) => [...new Set([...QUOTAS, quotaMb(t)])].sort((a, b) => a - b);
const quotaText = (mb) => (mb % GB ? `${mb} МБ` : `${mb / GB} ГБ`);
const share100 = (t) => Math.min(100, Math.round((t.used / t.quota) * 100));
async function setQuota(t, mb) {
  await api('PATCH', `/api/tenants/${t.id}`, { quota_mb: Number(mb) });
  toast(`Место для «${t.title}»: ${quotaText(Number(mb))}`);
  load();
}
async function close(t) {
  if (!await ask({
    text: `Закрыть вход в дерево «${t.title}»?`,
    note: 'Никто из этой семьи не сможет войти, ссылки на анкеты и вопросы перестанут работать. Дерево и файлы останутся — вход можно открыть снова.',
    yes: 'Закрыть вход', no: 'Не закрывать', danger: true,
  })) return;
  await api('PATCH', `/api/tenants/${t.id}`, { closed: true });
  load();
}
async function reopen(t) {
  await api('PATCH', `/api/tenants/${t.id}`, { closed: false });
  load();
}
const owners = (t) => (t.owners.includes(',') ? `владельцы: ${t.owners}` : `владелец: ${t.owners || '—'}`);
const day = (d) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(' г.', '');
</script>

<template>
  <div class="page">
    <h1>Семьи на сервере</h1>
    <p class="muted small">Каждая семья ведёт здесь своё дерево и зовёт туда своих родных. Вы видите только название,
      владельцев и сколько занято места — сами деревья видны только их семьям. Гостей других семей здесь не видно:
      что гость заходил, знает только владелец его семьи.</p>

    <div class="card">
      <b>Завести дерево другой семье</b>
      <p class="small">Кто откроет ссылку, станет владельцем нового пустого дерева.</p>
      <label class="field"><span>Для кого (для себя, например «Ольге, двоюродной сестре»)</span><input v-model="label" /></label>
      <div class="field"><span>Сколько действует ссылка</span>
        <div class="chips" role="radiogroup" aria-label="Срок ссылки">
          <button v-for="[d, t] in DAYS" :key="d" type="button" role="radio" class="chip" :class="{ on: days === d }" :aria-checked="days === d" @click="days = d">{{ t }}</button>
        </div>
      </div>
      <button class="primary block" :disabled="!data || full" @click="create">Сделать ссылку</button>
      <p v-if="data" class="muted small" style="margin-bottom:0">
        {{ full ? `Больше семей завести нельзя: их уже ${data.max}.` : `Семей, кроме вашей: ${data.count} из ${data.max}.` }}
        Новой семье — {{ sizeText(data.quota) }} места для фото и записей; потом можно прибавить.
      </p>
    </div>

    <div v-if="link" ref="linkCard" class="card" style="margin-top:0.667rem">
      <b>Ссылка{{ link.label ? ' — ' + link.label : '' }}</b>
      <p class="small" style="word-break:break-all">{{ link.url }}</p>
      <p class="muted small">Откроется один раз, в течение {{ DAYS.find((d) => d[0] === link.days)?.[1] }}. Когда по ней заведут дерево, вам придёт уведомление.</p>
      <button class="primary block" @click="share(link)">Отправить</button>
    </div>

    <template v-if="links.length">
      <h2>Неиспользованные ссылки</h2>
      <div class="list">
        <div v-for="l in links" :key="l.id">
          <div class="grow">{{ l.label || 'без подписи' }} <span class="muted small">· до {{ day(l.expires_at) }}</span></div>
          <button class="danger" @click="drop(l)">Отключить</button>
        </div>
      </div>
    </template>

    <h2>Семьи</h2>
    <p v-if="!data" class="muted">Загрузка…</p>
    <div v-else class="families">
      <div v-for="t in data.list" :key="t.id" class="card fam" :class="{ closed: t.closed_at }">
        <div><b>«{{ t.title }}»</b><span v-if="t.main" class="muted small"> · ваша, главная</span></div>
        <div class="small">{{ owners(t) }}</div>
        <div class="muted small">людей в дереве: {{ t.persons }} · пользуются: {{ t.users }} · заходили: {{ t.last_seen_at ? whenText(t.last_seen_at) : 'ещё нет' }}</div>
        <template v-if="!t.main">
          <div class="small">место: {{ sizeText(t.used) }}{{ t.quota ? ` из ${sizeText(t.quota)}` : '' }}</div>
          <div v-if="t.quota" class="bar" :class="{ over: t.used >= t.quota * 0.9 }"><i :style="{ width: share100(t) + '%' }" /></div>
          <div class="muted small">заведено {{ day(t.created_at) }}{{ t.created_by ? ` — ${t.created_by}` : '' }}{{ t.label ? `, по ссылке «${t.label}»` : '' }} · номер {{ t.id }}</div>
          <div v-if="t.closed_at" class="small bad">вход закрыт {{ whenText(t.closed_at) }}</div>
          <div class="acts">
            <label class="row quota"><span>Место</span>
              <select :value="quotaMb(t)" aria-label="Место для фото и записей" @change="setQuota(t, $event.target.value)">
                <option v-for="mb in quotaChoices(t)" :key="mb" :value="mb">{{ quotaText(mb) }}</option>
              </select>
            </label>
            <button v-if="t.closed_at" @click="reopen(t)">Открыть вход</button>
            <button v-else class="danger" @click="close(t)">Закрыть вход</button>
          </div>
        </template>
        <div v-else class="small">место: {{ sizeText(t.used) }}, без предела</div>
      </div>
    </div>
    <p class="muted small">Удалить семью совсем можно только на сервере, после того как вход в неё закрыт: <code>deploy/families.sh</code>.
      Владелец другой семьи потерял вход — новая ссылка для него: <code>deploy/password.sh "" номер</code>.</p>
  </div>
</template>

<style scoped>
.families { display: grid; gap: 0.667rem; }
.fam { display: grid; gap: 0.222rem; }
.fam.closed { opacity: 0.85; border-style: dashed; }
.bad { color: var(--danger); font-weight: 700; }
.bar { height: 0.444rem; border-radius: 999px; background: var(--line); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--accent); }
.bar.over i { background: var(--danger); }
.acts { display: grid; gap: 0.444rem; margin-top: 0.444rem; }
.acts > * { width: 100%; }
.quota { gap: 0.667rem; }
.quota select { flex: 1; }
code { font-size: 0.85em; white-space: nowrap; }
</style>
