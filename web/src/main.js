import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from './App.vue';
import './style.css';
import TreeView from './views/TreeView.vue';
import PersonView from './views/PersonView.vue';
import PeopleView from './views/PeopleView.vue';
import MoreView from './views/MoreView.vue';
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

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: TreeView },
    { path: '/person/:id', component: PersonView, props: true },
    { path: '/person/:id/print', component: CardPrintView, props: true },
    { path: '/people', component: PeopleView },
    { path: '/feed', component: FeedView },
    { path: '/more', component: MoreView },
    { path: '/print', component: PrintView },
    { path: '/family', component: FamilyView },
    { path: '/changes', component: ChangesView },
    { path: '/notify', component: NotifyView },
    { path: '/place', component: PlaceView },
    { path: '/places', component: PlacesView },
    { path: '/surveys', component: SurveysView },
    { path: '/surveys/:id', component: SurveyView, props: true },
    { path: '/invite/:token', component: InviteView, props: true, meta: { public: true } },
    // Анкета для родственника: без входа и без дерева.
    { path: '/survey/:token', component: SurveyFillView, props: true, meta: { public: true } },
  ],
  scrollBehavior: (to, from) => (to.path === from.path ? false : { top: 0 }),
});

createApp(App).use(router).mount('#app');
