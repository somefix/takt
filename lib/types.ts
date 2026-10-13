export interface TimeRecord {
  id: string;
  title: string;
  start: number;
  end: number | null;
  billable: boolean;
  updatedAt: number;
  deleted: boolean;
}

export type RecordFields = Pick<TimeRecord, 'title' | 'start' | 'end' | 'billable'>;

export type RecordPatch = Partial<RecordFields>;

export type Command =
  | ({ type: 'create'; id?: string } & Partial<RecordFields>)
  | { type: 'edit'; id: string; patch: RecordPatch }
  | { type: 'delete' | 'restore' | 'stop'; id: string }
  | { type: 'import'; records: TimeRecord[] }
  | { type: 'retry' };

export type CommandHandler = (command: Command) => Promise<boolean>;

export type CommandResponse = { ok: true } | { ok: false; error: string };

export type StorageData = Record<string, unknown>;

export interface StorageArea {
  get(keys: string | string[] | null): Promise<StorageData>;
  set(items: StorageData): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface EngineAPI {
  storage: { local: StorageArea; sync: StorageArea };
  alarms: { create(name: string, info: { delayInMinutes: number }): Promise<void> };
}

export interface DayGroup {
  date: string;
  total: number;
  records: TimeRecord[];
}

export interface WeekGroup {
  date: string;
  total: number;
  days: DayGroup[];
}

export interface SyncLimits {
  bytes: number;
  item: number;
  items: number;
}

export interface SyncPlan {
  values: Record<string, TimeRecord>;
  skipped: TimeRecord[];
}

export interface TimeForm {
  date: string;
  start: string;
  endDate: string;
  end: string;
  duration: string;
}

export type TimeMode = 'end' | 'duration';

export interface TimerDraft {
  id: string;
  title: string;
  billable: boolean;
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
