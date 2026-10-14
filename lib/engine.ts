import type { EngineAPI, Command, StorageData, TimeRecord } from './types.ts';
import { errorMessage } from './types.ts';
import { PREFIX, validateRecord, winner, planSync, sameRecord } from './model.ts';

export function createEngine(api: EngineAPI, now = () => Date.now()) {
  let queue = Promise.resolve();
  const serial = (fn: () => Promise<void>) => {
    const task = queue.then(fn);

    queue = task.catch(() => {});

    return task;
  };

  async function read(): Promise<TimeRecord[]> {
    const data = await api.storage.local.get(null);

    return Object.entries(data)
      .filter(([k]) => k.startsWith(PREFIX))
      .map(([, v]) => validateRecord(v));
  }

  async function merge(remote: StorageData) {
    const local = await api.storage.local.get(null);
    const changes: StorageData = {};

    for (const [k, v] of Object.entries(remote)) {
      if (!k.startsWith(PREFIX)) {
        continue;
      }

      try {
        const r = validateRecord(v);

        if (k !== PREFIX + r.id) {
          continue;
        }

        const next = winner(local[k] === undefined ? undefined : validateRecord(local[k]), r);

        if (!sameRecord(local[k], next)) {
          changes[k] = next;
        }
      } catch {}
    }

    if (Object.keys(changes).length) {
      await api.storage.local.set(changes);
    }
  }

  async function sync() {
    const meta = await api.storage.local.get(['syncLastAttempt']);

    if (now() - (typeof meta.syncLastAttempt === 'number' ? meta.syncLastAttempt : 0) < 10000) {
      await api.alarms.create('sync-retry', { delayInMinutes: 0.5 });

      return;
    }

    await api.storage.local.set({ syncLastAttempt: now() });

    try {
      const remote = await api.storage.sync.get(null);

      await merge(remote);

      const records = await read();
      const plan = planSync(records, remote);
      const remove = Object.keys(remote).filter((k) => k.startsWith(PREFIX) && !plan.values[k]);

      // Remove old window entries first to free quota. This never deletes local records.
      if (remove.length) {
        await api.storage.sync.remove(remove);
      }

      const changes: StorageData = {};

      for (const [k, v] of Object.entries(plan.values)) {
        if (!sameRecord(remote[k], v)) {
          changes[k] = v;
        }
      }

      if (Object.keys(changes).length) {
        await api.storage.sync.set(changes);
      }

      const urgent = plan.skipped.filter((r) => r.end === null || r.deleted);

      await api.storage.local.set({
        syncError: urgent.length
          ? 'Часть активных таймеров или меток удаления не помещается в sync. Данные сохранены локально.'
          : null,
      });
    } catch (e) {
      await api.storage.local.set({
        syncError: `Ошибка sync: ${errorMessage(e)}. Данные сохранены локально.`,
      });
      await api.alarms.create('sync-retry', { delayInMinutes: 1 });
    }
  }

  return {
    reconcile: () => serial(sync),
    receive: (remote: StorageData) =>
      serial(async () => {
        await merge(remote);
        await sync();
      }),
    command: (command: Command) =>
      serial(async () => {
        if (command.type === 'retry') {
          await sync();

          return;
        }

        const data = await api.storage.local.get(null);
        const changes: StorageData = {};

        if (command.type === 'import') {
          for (const raw of command.records) {
            const r = validateRecord(raw);
            const key = PREFIX + r.id;

            changes[key] = winner(
              data[key] === undefined ? undefined : validateRecord(data[key]),
              r,
            );
          }
        } else {
          const id = command.id || crypto.randomUUID();
          const key = PREFIX + id;
          const old = data[key] === undefined ? undefined : validateRecord(data[key]);

          if (command.type === 'create') {
            const title = typeof command.title === 'string' ? command.title.trim() : '';

            if (!title && command.end != null) {
              throw new Error('Введите название задачи');
            }

            changes[key] = validateRecord({
              id,
              title,
              url: command.url,
              billable: !!command.billable,
              start: command.start ?? now(),
              end: command.end ?? null,
              updatedAt: now(),
              deleted: false,
            });
          } else {
            if (!old) {
              throw new Error('Запись не найдена');
            }

            const updatedAt = Math.max(now(), old.updatedAt + 1);

            if (command.type === 'delete') {
              changes[key] = { ...old, deleted: true, updatedAt };
            } else if (command.type === 'restore') {
              changes[key] = { ...old, deleted: false, updatedAt };
            } else if (command.type === 'stop') {
              if (!old.title.trim()) {
                throw new Error('Введите название задачи');
              }

              changes[key] = { ...old, end: Math.max(now(), old.start), updatedAt };
            } else if (command.type === 'edit') {
              const title = command.patch.title;

              if (title !== undefined && typeof title !== 'string') {
                throw new Error('Введите название задачи');
              }

              const next = validateRecord({
                ...old,
                ...command.patch,
                title: title === undefined ? old.title : title.trim(),
                id,
                updatedAt,
              });

              if (next.end !== null && !next.title) {
                throw new Error('Введите название задачи');
              }

              changes[key] = next;
            } else {
              throw new Error('Неизвестная команда');
            }
          }
        }

        await api.storage.local.set(changes);
        await sync();
      }),
    read,
  };
}
