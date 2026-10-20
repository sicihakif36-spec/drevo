import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from './App.vue';
import './style.css';
import TreeView from './views/TreeView.vue';
import PersonView from './views/PersonView.vue';
import PeopleView from './views/PeopleView.vue';
import MoreView from './views/MoreView.vue';
import PrintView from './views/PrintView.vue';
import FamilyView from './views/FamilyView.vue';
import InviteView from './views/InviteView.vue';
import ChangesView from './views/ChangesView.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: TreeView },
    { path: '/person/:id', component: PersonView, props: true },
    { path: '/people', component: PeopleView },
    { path: '/more', component: MoreView },
    { path: '/print', component: PrintView },
    { path: '/family', component: FamilyView },
    { path: '/changes', component: ChangesView },
    { path: '/invite/:token', component: InviteView, props: true, meta: { public: true } },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

createApp(App).use(router).mount('#app');
