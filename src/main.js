import { createApp } from 'vue';
import './styles/base.css';
import App from './App.vue';
import { router } from './router.js';
import { setupAxis } from './axis/axis.js';

setupAxis({ router });

createApp(App).use(router).mount('#app');
