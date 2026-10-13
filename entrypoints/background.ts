import { browser } from 'wxt/browser';
import type { Command } from '../lib/types.ts';
import { errorMessage } from '../lib/types.ts';
import { createEngine } from '../lib/engine.ts';

export default defineBackground(() => {
  const engine = createEngine({
    storage: browser.storage,
    alarms: {
      create: async (name, info) => {
        await browser.alarms.create(name, info);
      },
    },
  });

  browser.runtime.onMessage.addListener(
    (message: { app?: string; command: Command }, sender, respond) => {
      if (message?.app !== 'takt') {
        return;
      }

      engine.command(message.command).then(
        () => respond({ ok: true }),
        (e) => respond({ ok: false, error: errorMessage(e) }),
      );

      return true;
    },
  );
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      engine
        .receive(
          Object.fromEntries(
            Object.entries(changes)
              .filter(([, v]) => v.newValue !== undefined)
              .map(([k, v]) => [k, v.newValue]),
          ),
        )
        .catch(console.error);
    }
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'sync-retry') {
      engine.reconcile().catch(console.error);
    }
  });
  engine.reconcile().catch(console.error);
});
