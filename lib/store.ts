import { browser } from 'wxt/browser';
import { ref, computed, onMounted, onUnmounted } from 'vue';

import { errorMessage } from './types.ts';
import { PREFIX, validateRecord } from './model.ts';

import type { TimeRecord, StorageData, Command, CommandResponse } from './types.ts';

export function useStore() {
  const records = ref<TimeRecord[]>([]);
  const remote = ref<StorageData>({});
  const error = ref('');
  const syncError = ref('');
  const ready = ref(false);
  const now = ref(Date.now());
  let interval: ReturnType<typeof setInterval> | undefined;
  let generation = 0;

  async function refresh() {
    const g = ++generation;

    try {
      const [local, sync] = await Promise.all([
        browser.storage.local.get(null),
        browser.storage.sync.get(null),
      ]);

      if (g !== generation) {
        return;
      }

      records.value = Object.entries(local)
        .filter(([k]) => k.startsWith(PREFIX))
        .map(([, v]) => validateRecord(v));
      remote.value = sync;
      syncError.value = typeof local.syncError === 'string' ? local.syncError : '';
      ready.value = true;
    } catch (e) {
      error.value = errorMessage(e);
    }
  }

  async function command(command: Command) {
    error.value = '';

    try {
      const result: CommandResponse = await browser.runtime.sendMessage({ app: 'takt', command });

      if (!result?.ok) {
        throw new Error(result?.error || 'Фоновый процесс недоступен');
      }

      await refresh();

      return true;
    } catch (e) {
      error.value = errorMessage(e);

      return false;
    }
  }

  const changed = () => refresh();

  onMounted(() => {
    refresh();
    browser.storage.onChanged.addListener(changed);
    interval = setInterval(() => (now.value = Date.now()), 1000);
  });

  onUnmounted(() => {
    clearInterval(interval);
    browser.storage.onChanged.removeListener(changed);
  });

  return {
    records,
    now,
    error,
    syncError,
    ready,
    command,
    active: computed(() =>
      records.value.filter((r) => !r.deleted && r.end === null).sort((a, b) => a.start - b.start),
    ),
    inSync: (r: TimeRecord) => JSON.stringify(remote.value[PREFIX + r.id]) === JSON.stringify(r),
  };
}
