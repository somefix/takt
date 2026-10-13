import type { TimeRecord, StorageData, StorageArea, EngineAPI } from '../lib/types.ts';
import { validateRecord } from '../lib/model.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../lib/engine.ts';
import {
  duration,
  groups,
  planSync,
  parseImport,
  exportJSON,
  exportCSV,
  winner,
  PREFIX,
} from '../lib/model.ts';
const record = (id: string, overrides: Partial<TimeRecord> = {}): TimeRecord => ({
  id,
  title: 'Задача',
  start: 100000,
  end: 160000,
  billable: false,
  updatedAt: 200000,
  deleted: false,
  ...overrides,
});
function mock() {
  const local: StorageData = {},
    sync: StorageData = {},
    alarms: { name: string; delayInMinutes: number }[] = [],
    writes: string[] = [];
  let fail = false;
  const area = (data: StorageData, name: string): StorageArea => ({
    get: async (keys) =>
      structuredClone(
        keys === null
          ? data
          : Object.fromEntries(
              (Array.isArray(keys) ? keys : [keys])
                .filter((k) => k in data)
                .map((k) => [k, data[k]]),
            ),
      ),
    set: async (values) => {
      if (name === 'sync' && fail) throw Error('QUOTA_BYTES');
      Object.assign(data, structuredClone(values));
      writes.push(name);
    },
    remove: async (keys) => {
      for (const k of keys) delete data[k];
    },
  });
  const api: EngineAPI = {
    storage: { local: area(local, 'local'), sync: area(sync, 'sync') },
    alarms: {
      create: async (name, opts) => {
        alarms.push({ name, ...opts });
      },
    },
  };
  return {
    local,
    sync,
    alarms,
    writes,
    setFail: (v: boolean) => (fail = v),
    getRecord: (id: string) => validateRecord(local[PREFIX + id]),
    api,
  };
}
test('parallel timers, restart, edits, stop and manual entry do not affect other timers', async () => {
  const m = mock();
  let now = 1000000;
  let e = createEngine(m.api, () => now);
  await e.command({ type: 'create', id: 'a', title: 'A', billable: true });
  await e.command({ type: 'create', id: 'b', title: 'B' });
  now += 3600000;
  e = createEngine(m.api, () => now);
  assert.equal(duration((await e.read()).find((r) => r.id === 'a')!, now), 3600000);
  await e.command({ type: 'create', id: 'manual', title: 'Вручную', start: 100, end: 60100 });
  assert.equal((await e.read()).filter((r) => r.end === null).length, 2);
  await e.command({
    type: 'edit',
    id: 'a',
    patch: { start: 900000, title: 'Новая', billable: false },
  });
  assert.equal(m.getRecord('a').end, null);
  await e.command({ type: 'stop', id: 'a' });
  assert.equal(m.getRecord('a').end, now);
  assert.equal(m.getRecord('b').end, null);
});
test('delete tombstone, undo, remote merge and no resurrection', async () => {
  const m = mock();
  let now = 1000000;
  const e = createEngine(m.api, () => now);
  await e.command({ type: 'create', id: 'a' });
  const old = structuredClone(m.getRecord('a'));
  await e.command({ type: 'delete', id: 'a' });
  assert.equal(m.getRecord('a').deleted, true);
  await e.receive({ 'record:a': old });
  assert.equal(m.getRecord('a').deleted, true);
  await e.command({ type: 'restore', id: 'a' });
  assert.equal(m.getRecord('a').deleted, false);
  assert.ok(m.getRecord('a').updatedAt > old.updatedAt);
  now += 20000;
  await e.receive({ 'record:a': record('a', { updatedAt: now, title: 'Другой компьютер' }) });
  assert.equal(m.getRecord('a').title, 'Другой компьютер');
  assert.equal(winner(record('a'), record('a', { deleted: true })).deleted, true);
});
test('JSON validates atomically, deduplicates, merges by ID and CSV escapes content', async () => {
  const rows = [
    record('a', { title: 'Текст, "кавычки"\nстрока' }),
    record('b', { end: null }),
    record('c', { deleted: true }),
  ];
  assert.deepEqual(parseImport(exportJSON(rows)), rows);
  assert.equal(
    parseImport(exportJSON([record('a'), record('a', { updatedAt: 300000, title: 'новая' })]))
      .length,
    1,
  );
  assert.throws(() => parseImport('{"format":"unknown","records":[]}'));
  assert.throws(() => parseImport(exportJSON([record('a', { end: 1 })])));
  assert.throws(() => parseImport(exportJSON([record('a', { id: 'invalid/id' })])));
  const csv = exportCSV(rows);
  assert.ok(csv.includes('"Текст, ""кавычки""\nстрока"'));
  assert.ok(!csv.includes('"b"'));
  assert.ok(exportCSV([record('a', { title: '=SUM(A1)' })]).includes("'=SUM"));
  const m = mock();
  const e = createEngine(m.api, () => 1000000);
  await e.command({ type: 'import', records: rows });
  await e.command({ type: 'import', records: rows });
  assert.equal((await e.read()).length, 3);
});
test('Monday week grouping and parallel duration totals', () => {
  const monday = +new Date('2026-10-05T10:00:00'),
    sunday = +new Date('2026-10-04T10:00:00');
  const g = groups([
    record('a', { start: monday, end: monday + 3600000 }),
    record('b', { start: monday, end: monday + 7200000 }),
    record('c', { start: sunday, end: sunday + 1000 }),
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[0].date, '2026-10-05');
  assert.equal(g[0].total, 10800000);
  assert.equal(g[0].days[0].total, 10800000);
});
test('sync window: at most 100 completed, active retained, reduction by bytes/item/count', () => {
  const rows = Array.from({ length: 150 }, (_, i) => record(`r${i}`, { end: 160000 + i }));
  rows.push(record('active', { end: null }));
  const p = planSync(rows);
  assert.equal(Object.keys(p.values).length, 101);
  assert.ok(p.values['record:active']);
  assert.ok(!p.values['record:r0']);
  const small = planSync(rows, {}, { bytes: 1000, item: 8000, items: 500 });
  assert.ok(Object.keys(small.values).length < 10);
  assert.ok(small.values['record:active']);
  const item = planSync(
    [record('large', { title: 'Я'.repeat(2000) })],
    {},
    { bytes: 100000, item: 100, items: 500 },
  );
  assert.equal(item.skipped.length, 1);
  assert.equal(
    Object.keys(planSync(rows, {}, { bytes: 100000, item: 8000, items: 2 }).values).length,
    2,
  );
});
test('sync failure keeps local data, reports error and retries; rate limited writes', async () => {
  const m = mock();
  let now = 1000000;
  const e = createEngine(m.api, () => now);
  m.setFail(true);
  await e.command({ type: 'create', id: 'a' });
  assert.ok(m.getRecord('a'));
  assert.match(String(m.local.syncError), /QUOTA_BYTES/);
  assert.ok(m.alarms.length);
  m.setFail(false);
  now += 20000;
  await e.reconcile();
  assert.deepEqual(m.getRecord('a'), m.sync['record:a']);
  assert.equal(m.local.syncError, null);
  const count = m.writes.filter((x) => x === 'sync').length;
  await e.command({ type: 'edit', id: 'a', patch: { title: 'Edited' } });
  assert.equal(m.writes.filter((x) => x === 'sync').length, count);
  now += 20000;
  await e.reconcile();
  assert.equal(validateRecord(m.sync['record:a']).title, 'Edited');
});
test('removing a record from sync window retains local history', async () => {
  const m = mock();
  const rows = Array.from({ length: 130 }, (_, i) => record(`r${i}`, { end: 160000 + i }));
  for (const r of rows) {
    m.local[PREFIX + r.id] = r;
    m.sync[PREFIX + r.id] = r;
  }
  const e = createEngine(m.api, () => 1000000);
  await e.reconcile();
  assert.equal((await e.read()).length, 130);
  assert.equal(Object.keys(m.sync).length, 100);
  assert.ok(m.getRecord('r0'));
  assert.ok(!m.sync['record:r0']);
});
test('duration edit recalculates end, overnight manual input and invalid time rejected', async () => {
  const { formTimes } = await import('../lib/model.ts');
  const f = {
    date: '2026-10-05',
    start: '23:30:00',
    endDate: '2026-10-06',
    end: '01:00:00',
    duration: '02:15:30',
  };
  const end = formTimes(f, false, 'end', Date.now());
  assert.equal(end.end! - end.start, 5400000);
  const changed = formTimes(f, false, 'duration', Date.now());
  assert.equal(changed.end! - changed.start, 8130000);
  assert.equal(formTimes(f, true, 'end', Date.now()).end, null);
  assert.throws(() => formTimes({ ...f, endDate: f.date }, false, 'end'));
  assert.throws(() => formTimes({ ...f, duration: '01:90:00' }, false, 'duration'));
  assert.throws(() => formTimes({ ...f, date: '2999-01-01' }, true));
});
test('undo expires after five seconds and a new deletion replaces its deadline', async () => {
  const { createUndo } = await import('../lib/undo.ts');
  let shown: TimeRecord | null = null,
    ms = 0,
    callback: () => void = () => {},
    clears = 0;
  const undo = createUndo<TimeRecord, number>(
    (r) => (shown = r),
    (fn, delay) => {
      callback = fn;
      ms = delay;
      return 1;
    },
    () => clears++,
  );
  undo.offer(record('a'));
  assert.equal(ms, 5000);
  assert.equal((shown as TimeRecord | null)?.id, 'a');
  undo.offer(record('b'));
  assert.equal(undo.peek()?.id, 'b');
  assert.ok(clears >= 1);
  callback();
  assert.equal(shown, null);
  assert.equal(undo.peek(), null);
  undo.offer(record('c'));
  undo.clear();
  assert.equal(shown, null);
});
