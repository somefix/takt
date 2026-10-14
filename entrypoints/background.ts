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

  let iconUpdate = Promise.resolve();
  const updateIcon = () => {
    iconUpdate = iconUpdate
      .then(async () => {
        const active = (await engine.read()).some(
          (record) => !record.deleted && record.end === null,
        );
        const suffix = active ? '' : '-inactive';

        await browser.action.setIcon({
          path: {
            16: `icon/16${suffix}.png`,
            32: `icon/32${suffix}.png`,
            48: `icon/48${suffix}.png`,
            128: `icon/128${suffix}.png`,
          },
        });
      })
      .catch(console.error);
  };

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
    if (area === 'local' && Object.keys(changes).some((key) => key.startsWith('record:'))) {
      updateIcon();
    }

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
  updateIcon();
  engine.reconcile().catch(console.error);
});
