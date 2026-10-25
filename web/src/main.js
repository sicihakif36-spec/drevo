import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from './App.vue';
import './fonts.css';
import './style.css';
import HomeView from './views/HomeView.vue';
import TreeView from './views/TreeView.vue';
import PersonView from './views/PersonView.vue';
import PeopleView from './views/PeopleView.vue';
import ProfileView from './views/ProfileView.vue';
import PrintView from './views/PrintView.vue';
import CardPrintView from './views/CardPrintView.vue';
import FamilyView from './views/FamilyView.vue';
import InviteView from './views/InviteView.vue';
import ChangesView from './views/ChangesView.vue';
import FeedView from './views/FeedView.vue';
import NotifyView from './views/NotifyView.vue';
import PlaceView from './views/PlaceView.vue';
import PlacesView from './views/PlacesView.vue';
import SurveysView from './views/SurveysView.vue';
import SurveyView from './views/SurveyView.vue';
import SurveyFillView from './views/SurveyFillView.vue';
import ImportView from './views/ImportView.vue';
import ResearchView from './views/ResearchView.vue';
import ChecksView from './views/ChecksView.vue';
import NamesView from './views/NamesView.vue';
import MergeView from './views/MergeView.vue';
import DevicesView from './views/DevicesView.vue';
import PasswordView from './views/PasswordView.vue';
import AsksView from './views/AsksView.vue';
import AskView from './views/AskView.vue';
import AskFillView from './views/AskFillView.vue';
import InterviewView from './views/InterviewView.vue';
import InterviewsView from './views/InterviewsView.vue';
import InterviewFillView from './views/InterviewFillView.vue';
import TenantsView from './views/TenantsView.vue';
import NewFamilyView from './views/NewFamilyView.vue';
import HelpView from './views/HelpView.vue';
import ArchiveView from './views/ArchiveView.vue';
import { store } from './store.js';
import { watchUpdates } from './update.js';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    // «Главная» — с неё открывается приложение (что требует участия, даты, что нового, все разделы).
    { path: '/', component: HomeView },
    { path: '/tree', component: TreeView },
    { path: '/person/:id', component: PersonView, props: true },
    { path: '/person/:id/print', component: CardPrintView, props: true },
    { path: '/people', component: PeopleView },
    { path: '/feed', component: FeedView },
    { path: '/profile', component: ProfileView },
    // Бывшее «Ещё»: старые ссылки (и «Скачать всё» из уведомлений, /more?archive=1) ведут на новые места.
    { path: '/more', redirect: (to) => (to.query.archive ? { path: '/archive', query: {} } : { path: '/profile', query: {} }) },
    { path: '/archive', component: ArchiveView },
    { path: '/print', component: PrintView },
    { path: '/family', component: FamilyView },
    { path: '/changes', component: ChangesView },
    { path: '/notify', component: NotifyView },
    { path: '/place', component: PlaceView },
    { path: '/places', component: PlacesView },
    { path: '/surveys', component: SurveysView },
    { path: '/surveys/:id', component: SurveyView, props: true },
    { path: '/import', component: ImportView },
    { path: '/research', component: ResearchView },
    { path: '/checks', component: ChecksView },
    { path: '/names', component: NamesView },
    { path: '/merge', component: MergeView, props: (r) => ({ a: r.query.a, b: r.query.b }) },
    { path: '/devices', component: DevicesView },
    { path: '/asks', component: AsksView },
    { path: '/asks/:id', component: AskView, props: true },
    { path: '/interviews', component: InterviewsView },
    { path: '/interview/:id', component: InterviewView, props: (r) => ({ id: r.params.id, person: r.query.person }) },
    { path: '/password', component: PasswordView, props: () => ({ mode: store.me?.has_password ? 'change' : 'create' }) },
    { path: '/tenants', component: TenantsView },
    { path: '/help', component: HelpView },
    { path: '/invite/:token', component: InviteView, props: true, meta: { public: true } },
    // Анкета для родственника: без входа и без дерева.
    { path: '/survey/:token', component: SurveyFillView, props: true, meta: { public: true } },
    // Вопрос родным по ссылке: тоже без входа и без дерева.
    { path: '/ask/:token', component: AskFillView, props: true, meta: { public: true } },
    // Интервью по ссылке: только вопросы, без входа и без дерева.
    { path: '/iv/:token', component: InterviewFillView, props: true, meta: { public: true } },
    // «Завести своё дерево» по ссылке от владельца главной семьи: новая семья на этом сервере.
    { path: '/new/:token', component: NewFamilyView, props: true, meta: { public: true } },
  ],
  scrollBehavior: (to, from) => (to.path === from.path ? false : { top: 0 }),
});

createApp(App).use(router).mount('#app');
watchUpdates(router);
