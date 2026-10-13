import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import App from '../components/App.vue';
import '../components/style.css';

export function mount(options = false) {
  createApp(App, { options })
    .use(PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: '.dark' } } })
    .mount('#app');
}
