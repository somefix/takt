<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';

import RecordForm from './RecordForm.vue';
import { createUndo } from '../lib/undo.ts';
import { groups, formatDuration, localTime } from '../lib/model.ts';
import { jiraRecordLabel } from '../lib/jira.ts';

import type { TimeRecord, RecordFields, CommandHandler } from '../lib/types.ts';

const props = defineProps<{
  records: TimeRecord[];
  inSync: (record: TimeRecord) => boolean;
  command: CommandHandler;
  month: number | null;
  firstMonth: number;
  lastMonth: number;
}>();
defineEmits<{ 'previous-month': []; 'next-month': [] }>();

const weeks = computed(() => groups(props.records));
const monthLabel = computed(() => {
  if (props.month === null) {
    return '';
  }

  return new Date(Math.floor(props.month / 12), props.month % 12, 1).toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric',
  });
});
const editing = ref<TimeRecord | null>(null);
const deleting = ref<TimeRecord | null>(null);
const undo = ref<TimeRecord | null>(null);

const undoController = createUndo<TimeRecord>((r) => (undo.value = r));

const dateLabel = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

async function remove() {
  const r = deleting.value;

  if (!r) {
    return;
  }

  if (await props.command({ type: 'delete', id: r.id })) {
    deleting.value = null;
    undoController.offer(r);
  }
}

async function restore() {
  const r = undoController.peek();

  if (r && (await props.command({ type: 'restore', id: r.id }))) {
    undoController.clear();
  }
}

async function save(patch: RecordFields) {
  if (!editing.value) {
    return;
  }

  if (await props.command({ type: 'edit', id: editing.value.id, patch })) {
    editing.value = null;
  }
}

onUnmounted(() => undoController.dispose());
</script>

<template>
  <section class="history">
    <div class="section-title">
      <h2>История</h2>
      <div
        v-if="month !== null"
        class="month-navigation"
      >
        <Button
          label="‹"
          class="icon-button"
          severity="secondary"
          size="small"
          aria-label="Предыдущий месяц"
          :disabled="month <= firstMonth"
          @click="$emit('previous-month')"
        />
        <span aria-live="polite">{{ monthLabel }}</span>
        <Button
          label="›"
          class="icon-button"
          severity="secondary"
          size="small"
          aria-label="Следующий месяц"
          :disabled="month >= lastMonth"
          @click="$emit('next-month')"
        />
      </div>
    </div>
    <div
      v-if="undo"
      class="undo"
      role="status"
    >
      Запись удалена
      <Button
        label="Отменить"
        size="small"
        @click="restore"
      />
    </div>
    <div
      v-if="!weeks.length"
      class="empty"
    >
      За этот месяц нет завершённых записей.
      <br />
      <small>Запустите таймер или добавьте время вручную.</small>
    </div>
    <section
      v-for="week in weeks"
      :key="week.date"
      class="week"
    >
      <header>
        <h3>Неделя с {{ dateLabel(week.date) }}</h3>
        <strong>{{ formatDuration(week.total) }}</strong>
      </header>
      <section
        v-for="day in week.days"
        :key="day.date"
        class="day"
      >
        <header>
          <h4>{{ dateLabel(day.date) }}</h4>
          <strong>{{ formatDuration(day.total) }}</strong>
        </header>
        <article
          v-for="r in day.records"
          :key="r.id"
          class="history-row"
        >
          <div class="record-info">
            <div class="record-title">
              <strong :title="jiraRecordLabel(r.title, r.url).name">
                {{ jiraRecordLabel(r.title, r.url).name || 'Название не указано' }}
              </strong>
              <a
                v-if="r.url"
                class="record-link"
                :href="r.url"
                target="_blank"
                rel="noopener noreferrer"
                :title="r.url"
                :aria-label="`Открыть ссылку задачи: ${r.title}`"
              >
                ↗
              </a>
            </div>
            <span
              v-if="jiraRecordLabel(r.title, r.url).key"
              class="issue-key"
            >
              {{ jiraRecordLabel(r.title, r.url).key }}
            </span>
            <div class="meta">
              <span>
                {{ localTime(r.start) }} → {{ localTime(r.end!) }}
                <template
                  v-if="new Date(r.start).toDateString() !== new Date(r.end!).toDateString()"
                >
                  ({{ new Date(r.end!).toLocaleDateString('ru-RU') }})
                </template>
              </span>
              <span
                class="sync-marker"
                :class="{ synced: inSync(r) }"
                role="img"
                :aria-label="inSync(r) ? 'В sync' : 'Только локально'"
                :title="
                  inSync(r)
                    ? 'Успешно сохранено в storage.sync; доставка на другие устройства не подтверждена'
                    : 'Хранится только локально или ожидает сохранения в sync'
                "
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M19 18H6a4 4 0 0 1-.42-7.98 7 7 0 0 1 13.14-1.7A5 5 0 0 1 19 18Z"
                    :fill="inSync(r) ? 'currentColor' : 'none'"
                    :stroke="inSync(r) ? 'none' : 'currentColor'"
                    stroke-width="1.8"
                    stroke-linejoin="round"
                  />
                  <path
                    v-if="inSync(r)"
                    d="m9 13 2 2 4-4"
                    fill="none"
                    stroke="white"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </span>
            </div>
          </div>
          <div class="row-actions">
            <b class="duration">{{ formatDuration(r.end! - r.start) }}</b>
            <Button
              label="₽"
              class="icon-button"
              :severity="r.billable ? 'success' : 'secondary'"
              :aria-label="
                r.billable
                  ? 'Оплачиваемое: сделать неоплачиваемым'
                  : 'Неоплачиваемое: сделать оплачиваемым'
              "
              :title="r.billable ? 'Оплачиваемое' : 'Неоплачиваемое'"
              :aria-pressed="r.billable"
              @click="command({ type: 'edit', id: r.id, patch: { billable: !r.billable } })"
            />
            <Button
              label="▶"
              class="icon-button"
              severity="secondary"
              title="Запустить новый таймер"
              aria-label="Запустить новый таймер"
              @click="command({ type: 'create', title: r.title, url: r.url, billable: r.billable })"
            />
            <Button
              label="✎"
              class="icon-button"
              severity="secondary"
              aria-label="Редактировать запись"
              @click="editing = r"
            />
            <Button
              label="×"
              class="icon-button"
              severity="secondary"
              aria-label="Удалить запись"
              @click="deleting = r"
            />
          </div>
        </article>
      </section>
    </section>
    <Dialog
      :visible="!!editing"
      modal
      header="Редактирование записи"
      :style="{ width: '440px', maxWidth: '95vw' }"
      @update:visible="editing = null"
    >
      <RecordForm
        v-if="editing"
        :key="editing.id"
        :record="editing"
        @save="save"
        @cancel="editing = null"
      />
    </Dialog>
    <Dialog
      :visible="!!deleting"
      modal
      header="Удалить запись?"
      :style="{ width: '380px', maxWidth: '95vw' }"
      @update:visible="deleting = null"
    >
      <p>«{{ deleting?.title }}» будет удалена. Отменить можно в течение 5 секунд.</p>
      <div class="actions">
        <Button
          label="Удалить"
          severity="danger"
          @click="remove"
        />
        <Button
          label="Отмена"
          severity="secondary"
          @click="deleting = null"
        />
      </div>
    </Dialog>
  </section>
</template>
