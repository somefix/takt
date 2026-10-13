import type {
  TimeRecord,
  DayGroup,
  WeekGroup,
  SyncLimits,
  SyncPlan,
  StorageData,
  TimeForm,
  TimeMode,
} from './types.ts';

export const PREFIX = 'record:';

export function validateRecord(value: unknown): TimeRecord {
  if (!value || typeof value !== 'object') {
    throw new Error('Некорректная запись в JSON');
  }

  const r = value as Record<string, unknown>;

  if (
    !r ||
    typeof r.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(r.id) ||
    typeof r.title !== 'string' ||
    r.title.length > 2000 ||
    typeof r.billable !== 'boolean' ||
    typeof r.start !== 'number' ||
    !Number.isSafeInteger(r.start) ||
    r.start < 0 ||
    !Number.isFinite(+new Date(r.start)) ||
    typeof r.updatedAt !== 'number' ||
    !Number.isSafeInteger(r.updatedAt) ||
    r.updatedAt < 0 ||
    (r.end !== null &&
      (typeof r.end !== 'number' ||
        !Number.isSafeInteger(r.end) ||
        r.end < r.start ||
        !Number.isFinite(+new Date(r.end)))) ||
    (r.deleted !== undefined && typeof r.deleted !== 'boolean')
  ) {
    throw new Error('Некорректная запись в JSON');
  }

  return {
    id: r.id,
    title: r.title,
    start: r.start,
    end: r.end,
    billable: r.billable,
    updatedAt: r.updatedAt,
    deleted: !!r.deleted,
  };
}

export function winner(a: TimeRecord | undefined, b: TimeRecord): TimeRecord {
  if (!a) {
    return b;
  }

  if (!b) {
    return a;
  }

  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt > b.updatedAt ? a : b;
  }

  if (!!a.deleted !== !!b.deleted) {
    return a.deleted ? a : b;
  }

  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

export const duration = (r: Pick<TimeRecord, 'start' | 'end'>, now = Date.now()) =>
  Math.max(0, (r.end ?? now) - r.start);

export function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);

  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const formatDurationMinutes = (ms: number) => formatDuration(ms).slice(0, -3);

export function localDate(ts: number) {
  const d = new Date(ts);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function localTime(ts: number) {
  return new Date(ts).toTimeString().slice(0, 8);
}

export function groups(records: TimeRecord[]): WeekGroup[] {
  const weeks = new Map<string, { date: string; total: number; days: Map<string, DayGroup> }>();

  for (const r of records
    .filter((r) => !r.deleted && r.end !== null)
    .sort((a, b) => b.start - a.start)) {
    const d = localDate(r.start);
    const monday = new Date(`${d}T12:00:00`);

    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

    const w = localDate(+monday);

    if (!weeks.has(w)) {
      weeks.set(w, { date: w, total: 0, days: new Map() });
    }

    const week = weeks.get(w)!;

    if (!week.days.has(d)) {
      week.days.set(d, { date: d, total: 0, records: [] });
    }

    const day = week.days.get(d)!;

    day.records.push(r);
    day.total += duration(r);
    week.total += duration(r);
  }

  return [...weeks.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((w) => ({
      ...w,
      days: [...w.days.values()].sort((a, b) => b.date.localeCompare(a.date)),
    }));
}

export function planSync(
  records: TimeRecord[],
  existing: StorageData = {},
  limits: SyncLimits = { bytes: 100000, item: 8000, items: 500 },
): SyncPlan {
  const result: Record<string, TimeRecord> = {};
  const skipped: TimeRecord[] = [];
  let used = 0;
  const live = records.filter((r) => !r.deleted);
  const active = live.filter((r) => r.end === null);
  const ended = live
    .filter((r) => r.end !== null)
    .sort((a, b) => b.end! - a.end!)
    .slice(0, 100);
  const tombstones = records.filter((r) => r.deleted).sort((a, b) => b.updatedAt - a.updatedAt);

  // Deletions take precedence so an old remote copy cannot resurrect a record.
  for (const r of [...tombstones, ...active, ...ended]) {
    const key = PREFIX + r.id;
    const bytes = new TextEncoder().encode(key + JSON.stringify(r)).length;

    if (
      bytes > limits.item ||
      used + bytes > limits.bytes ||
      Object.keys(result).length >= limits.items
    ) {
      skipped.push(r);

      continue;
    }

    result[key] = r;
    used += bytes;
  }

  const external = Object.entries(existing)
    .filter(([k]) => !k.startsWith(PREFIX))
    .reduce((n, [k, v]) => n + new TextEncoder().encode(k + JSON.stringify(v)).length, 0);

  if (external && limits.bytes === 100000) {
    return planSync(
      records,
      {},
      {
        ...limits,
        bytes: Math.max(0, limits.bytes - external),
        items: limits.items - Object.keys(existing).filter((k) => !k.startsWith(PREFIX)).length,
      },
    );
  }

  return { values: result, skipped };
}

export function parseImport(text: string): TimeRecord[] {
  const data: unknown = JSON.parse(text);

  if (
    !data ||
    typeof data !== 'object' ||
    !('format' in data) ||
    !('version' in data) ||
    !('records' in data) ||
    data.format !== 'takt' ||
    data.version !== 1 ||
    !Array.isArray(data.records)
  ) {
    throw new Error('Ожидается JSON экспорта Такт версии 1');
  }

  const map = new Map<string, TimeRecord>();

  for (const r of data.records) {
    const v = validateRecord(r);

    map.set(v.id, winner(map.get(v.id), v));
  }

  return [...map.values()];
}

export function exportJSON(records: TimeRecord[]) {
  return JSON.stringify(
    { format: 'takt', version: 1, exportedAt: new Date().toISOString(), records },
    null,
    2,
  );
}

export function exportCSV(records: TimeRecord[]) {
  const esc = (v: string | number) => '"' + String(v).replaceAll('"', '""') + '"';

  return (
    '\uFEFF' +
    [
      ['ID', 'Название', 'Начало', 'Окончание', 'Длительность (сек)', 'Оплачиваемое'],
      ...records
        .filter((r) => !r.deleted && r.end !== null)
        .map((r) => [
          r.id,
          /^[=+@-]/.test(r.title) ? "'" + r.title : r.title,
          new Date(r.start).toISOString(),
          new Date(r.end!).toISOString(),
          duration(r) / 1000,
          r.billable ? 'Да' : 'Нет',
        ]),
    ]
      .map((row) => row.map(esc).join(','))
      .join('\r\n')
  );
}

export function formTimes(
  form: TimeForm,
  active = false,
  mode: TimeMode = 'end',
  now = Date.now(),
  original?: Pick<TimeRecord, 'start' | 'end'>,
): Pick<TimeRecord, 'start' | 'end'> {
  const minuteTime = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (!minuteTime.test(form.start) || (mode === 'end' && !active && !minuteTime.test(form.end))) {
    throw new Error('Время: ЧЧ:ММ');
  }

  const start =
    original &&
    form.date === localDate(original.start) &&
    form.start === localTime(original.start).slice(0, 5)
      ? original.start
      : +new Date(`${form.date}T${form.start}`);
  let end: number | null = null;

  if (!active) {
    if (mode === 'duration') {
      if (!/^\d+:[0-5]\d$/.test(form.duration)) {
        throw new Error('Длительность: ЧЧ:ММ');
      }

      const [h, m] = form.duration.split(':').map(Number);
      const originalDuration =
        original?.end === null || !original ? null : original.end - original.start;

      end =
        start +
        (originalDuration !== null && form.duration === formatDurationMinutes(originalDuration)
          ? originalDuration
          : (h * 60 + m) * 60000);
    } else {
      end =
        original?.end !== null &&
        original?.end !== undefined &&
        form.endDate === localDate(original.end) &&
        form.end === localTime(original.end).slice(0, 5)
          ? original.end
          : +new Date(`${form.endDate}T${form.end}`);
    }
  }

  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start > now ||
    (end !== null &&
      (!Number.isSafeInteger(end) || !Number.isFinite(+new Date(end)) || end < start))
  ) {
    throw new Error('Проверьте даты: начало не позже текущего времени, окончание не раньше начала');
  }

  return { start, end };
}
