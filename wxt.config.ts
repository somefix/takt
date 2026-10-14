import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Такт — учёт времени',
    description: 'Независимые таймеры и история времени с синхронизацией Chrome',
    permissions: ['storage', 'alarms', 'activeTab'],
    version: '1.0.0',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_icon: {
        16: 'icon/16-inactive.png',
        32: 'icon/32-inactive.png',
        48: 'icon/48-inactive.png',
        128: 'icon/128-inactive.png',
      },
    },
  },
});
