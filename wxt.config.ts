import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Такт — учёт времени',
    description: 'Независимые таймеры и история времени с синхронизацией Chrome',
    permissions: ['storage', 'alarms'],
    version: '1.0.0',
  },
});
