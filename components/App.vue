<script setup lang="ts">
import { browser } from 'wxt/browser';
import { computed, ref, watch, onUnmounted } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Dialog from 'primevue/dialog';

import { errorMessage } from '../lib/types.ts';
import RecordForm from './RecordForm.vue';
import History from './History.vue';
import { useStore } from '../lib/store.ts';
import { createUndo } from '../lib/undo.ts';
import { duration, formatDuration, parseImport, exportJSON, exportCSV } from '../lib/model.ts';

import type { TimeRecord, RecordFields, TimerDraft } from '../lib/types.ts';

const props = defineProps<{ options?: boolean }>();

const openOptions = () => browser.runtime.openOptionsPage();

const store = useStore();
const { records, active, now, error, syncError, ready, command, inSync } = store;
const monthOf = (timestamp: number) => {
  const date = new Date(timestamp);

  return date.getFullYear() * 12 + date.getMonth();
};
const currentMonth = computed(() => monthOf(now.value));
const selectedMonth = ref(currentMonth.value);
const completedMonths = computed(() =>
  records.value.filter((r) => !r.deleted && r.end !== null).map((r) => monthOf(r.start)),
);
const firstMonth = computed(() =>
  completedMonths.value.reduce((first, month) => Math.min(first, month), currentMonth.value),
);
const lastMonth = computed(() =>
  completedMonths.value.reduce((last, month) => Math.max(last, month), currentMonth.value),
);
const historyRecords = computed(() => {
  const month = props.options ? selectedMonth.value : currentMonth.value;
  const year = Math.floor(month / 12);
  const monthStart = new Date(year, month % 12, 1).getTime();
  const nextMonthStart = new Date(year, (month % 12) + 1, 1).getTime();

  return records.value.filter((r) => r.start >= monthStart && r.start < nextMonthStart);
});

watch(currentMonth, (month, previousMonth) => {
  if (selectedMonth.value === previousMonth) {
    selectedMonth.value = month;
  }
});

const mode = ref<'timer' | 'manual'>('timer');
const drafts = ref<TimerDraft[]>([{ id: crypto.randomUUID(), title: '', billable: false }]);
const editing = ref<TimeRecord | null>(null);
const deleting = ref<TimeRecord | null>(null);
const undo = ref<TimeRecord | null>(null);
const notice = ref('');
const busy = ref(false);
const undoController = createUndo<TimeRecord>((r) => (undo.value = r));

watch(active, (a) => {
  if (a.length === 0 && drafts.value.length === 0) {
    drafts.value = [{ id: crypto.randomUUID(), title: '', billable: false }];
  }
});

async function start(d: TimerDraft) {
  if (busy.value) {
    return;
  }

  busy.value = true;

  if (await command({ type: 'create', title: d.title, billable: d.billable })) {
    drafts.value = drafts.value.filter((x) => x.id !== d.id);
  }

  busy.value = false;
}

async function manual(patch: RecordFields) {
  if (await command({ type: 'create', ...patch })) {
    mode.value = 'timer';
  }
}

async function save(patch: RecordFields) {
  if (!editing.value) {
    return;
  }

  if (await command({ type: 'edit', id: editing.value.id, patch })) {
    editing.value = null;
  }
}

function download(type: 'json' | 'csv') {
  const content = type === 'json' ? exportJSON(records.value) : exportCSV(records.value);
  const url = URL.createObjectURL(
    new Blob([content], { type: type === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }),
  );
  const a = document.createElement('a');

  a.href = url;
  a.download = `takt-${new Date().toISOString().slice(0, 10)}.${type}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  try {
    if (file.size > 20 * 1024 * 1024) {
      throw new Error('Максимальный размер файла — 20 МБ');
    }

    const imported = parseImport(await file.text());

    if (await command({ type: 'import', records: imported })) {
      notice.value = `Импортировано записей: ${imported.length}. Совпадения объединены по ID.`;
    }
  } catch (e) {
    error.value = errorMessage(e);
  }

  input.value = '';
}

function rename(record: TimeRecord, event: Event) {
  const input = event.target as HTMLInputElement;

  void command({
    type: 'edit',
    id: record.id,
    patch: { title: input.value.trim() || 'Без названия' },
  });
}

function addDraft() {
  if (drafts.value.length === 0) {
    drafts.value.push({ id: crypto.randomUUID(), title: '', billable: false });
  }
}

function removeDraft(id: string) {
  drafts.value = drafts.value.filter((d) => d.id !== id);
}

async function removeTimer() {
  const r = deleting.value;

  if (r && (await command({ type: 'delete', id: r.id }))) {
    deleting.value = null;
    undoController.offer(r);
  }
}

async function restoreTimer() {
  const r = undoController.peek();

  if (r && (await command({ type: 'restore', id: r.id }))) {
    undoController.clear();
  }
}

onUnmounted(() => undoController.dispose());
</script>

<template>
  <main :class="['app', { options }]">
    <header class="app-header">
      <div>
        <span class="logo">т</span>
        <span class="brand">такт</span>
        <span class="tagline">Время под контролем</span>
      </div>
      <Button
        v-if="!options"
        label="Параметры ↗"
        size="small"
        severity="secondary"
        @click="openOptions"
      />
      <span
        v-else
        class="tagline"
      >
        История и данные
      </span>
    </header>
    <p
      v-if="error"
      class="error"
      role="alert"
    >
      {{ error }}
    </p>
    <div
      v-if="syncError"
      class="error"
      role="alert"
    >
      {{ syncError }}
      <Button
        label="Повторить"
        size="small"
        severity="secondary"
        @click="command({ type: 'retry' })"
      />
    </div>
    <p
      v-if="notice"
      class="notice"
      role="status"
    >
      {{ notice }}
      <button
        class="plain"
        @click="notice = ''"
        aria-label="Закрыть уведомление"
      >
        ×
      </button>
    </p>
    <template v-if="ready">
      <section class="timer-panel">
        <div class="segmented">
          <button
            :class="{ selected: mode === 'timer' }"
            @click="mode = 'timer'"
          >
            Таймер
          </button>
          <button
            :class="{ selected: mode === 'manual' }"
            @click="mode = 'manual'"
          >
            Ручной ввод
          </button>
        </div>
        <template v-if="mode === 'timer'">
          <div
            v-if="undo"
            class="undo"
            role="status"
          >
            Таймер отменён
            <Button
              label="Отменить"
              size="small"
              @click="restoreTimer"
            />
          </div>
          <div
            v-for="(r, index) in active"
            :key="r.id"
            class="timer-row"
          >
            <InputText
              :model-value="r.title"
              maxlength="2000"
              aria-label="Название активной задачи"
              @change="rename(r, $event)"
            />
            <b class="running">{{ formatDuration(duration(r, now)) }}</b>
            <Button
              label="Stop"
              severity="danger"
              @click="command({ type: 'stop', id: r.id })"
            />
            <Button
              label="₽"
              :severity="r.billable ? 'success' : 'secondary'"
              :title="r.billable ? 'Оплачиваемое' : 'Неоплачиваемое'"
              :aria-label="r.billable ? 'Оплачиваемое: изменить' : 'Неоплачиваемое: изменить'"
              :aria-pressed="r.billable"
              @click="command({ type: 'edit', id: r.id, patch: { billable: !r.billable } })"
            />
            <div class="timer-actions">
              <Button
                label="✎"
                severity="secondary"
                aria-label="Редактировать активный таймер"
                @click="editing = r"
              />
              <Button
                v-if="index === active.length - 1 && drafts.length === 0"
                label="+"
                severity="secondary"
                aria-label="Добавить строку таймера"
                @click="addDraft"
              />
              <Button
                label="×"
                severity="secondary"
                aria-label="Удалить активный таймер"
                @click="deleting = r"
              />
            </div>
          </div>
          <form
            v-for="d in drafts"
            :key="d.id"
            class="timer-row draft"
            @submit.prevent="start(d)"
          >
            <div class="start-group">
              <InputText
                v-model="d.title"
                maxlength="2000"
                placeholder="Над чем работаете?"
                aria-label="Название новой задачи"
              />
              <Button
                type="submit"
                label="Start"
                :disabled="busy"
              />
            </div>
            <Button
              label="₽"
              :severity="d.billable ? 'success' : 'secondary'"
              type="button"
              :aria-label="d.billable ? 'Оплачиваемое: изменить' : 'Неоплачиваемое: изменить'"
              :title="d.billable ? 'Оплачиваемое' : 'Неоплачиваемое'"
              :aria-pressed="d.billable"
              @click="d.billable = !d.billable"
            />
            <Button
              v-if="active.length + drafts.length > 1"
              type="button"
              label="×"
              severity="secondary"
              aria-label="Скрыть новое поле таймера"
              :disabled="busy"
              @click="removeDraft(d.id)"
            />
          </form>
          <Button
            v-if="active.length === 0 && drafts.length === 0"
            label="Добавить таймер"
            severity="secondary"
            @click="addDraft"
          />
        </template>
        <RecordForm
          v-else
          @save="manual"
          @cancel="mode = 'timer'"
        />
      </section>
      <section
        v-if="options"
        class="data-panel"
      >
        <div>
          <h2>Ваши данные</h2>
          <p>
            JSON сохраняет таймеры и метки удаления для объединения. CSV содержит завершённую
            историю.
          </p>
        </div>
        <div class="actions">
          <Button
            label="Экспорт JSON"
            severity="secondary"
            @click="download('json')"
          />
          <Button
            label="Экспорт CSV"
            severity="secondary"
            @click="download('csv')"
          />
          <label class="file-button">
            Импорт JSON
            <input
              type="file"
              accept=".json,application/json"
              @change="importFile"
            />
          </label>
        </div>
      </section>
      <History
        :records="historyRecords"
        :in-sync="inSync"
        :command="command"
        :month="options ? selectedMonth : null"
        :first-month="firstMonth"
        :last-month="lastMonth"
        @previous-month="selectedMonth--"
        @next-month="selectedMonth++"
      />
      <footer>
        Без отдельного аккаунта · локальное хранение + Chrome sync
        <br />
        Синее облако — сохранено в storage.sync; доставка на другие устройства не подтверждена.
      </footer>
    </template>
    <p
      v-else
      class="empty"
    >
      Загрузка…
    </p>
    <Dialog
      :visible="!!editing"
      modal
      header="Активный таймер"
      :style="{ width: '440px', maxWidth: '95vw' }"
      @update:visible="editing = null"
    >
      <RecordForm
        v-if="editing"
        :key="editing.id"
        :record="editing"
        active
        @save="save"
        @cancel="editing = null"
      />
    </Dialog>
    <Dialog
      :visible="!!deleting"
      modal
      header="Удалить активный таймер?"
      :style="{ width: '380px', maxWidth: '95vw' }"
      @update:visible="deleting = null"
    >
      <p>
        «{{ deleting?.title }}» будет удалён без записи в историю. Отменить можно в течение 5
        секунд.
      </p>
      <div class="actions">
        <Button
          label="Удалить"
          severity="danger"
          @click="removeTimer"
        />
        <Button
          label="Назад"
          severity="secondary"
          @click="deleting = null"
        />
      </div>
    </Dialog>
  </main>
</template>
