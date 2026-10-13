<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';

import RecordForm from './RecordForm.vue';
import { createUndo } from '../lib/undo.ts';
import { groups, formatDuration, localTime } from '../lib/model.ts';

import type { TimeRecord, RecordFields, CommandHandler } from '../lib/types.ts';

const props = defineProps<{
  records: TimeRecord[];
  inSync: (record: TimeRecord) => boolean;
  command: CommandHandler;
}>();

const weeks = computed(() => groups(props.records));
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
      <span>С понедельника · суммы включают параллельное время</span>
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
      Пока нет завершённых записей.
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
            <strong>{{ r.title }}</strong>
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
                :title="
                  inSync(r)
                    ? 'Успешно сохранено в storage.sync; доставка на другие устройства не подтверждена'
                    : 'Хранится только локально или ожидает сохранения в sync'
                "
              >
                ● {{ inSync(r) ? 'В sync' : 'Только локально' }}
              </span>
            </div>
          </div>
          <div class="row-actions">
            <b class="duration">{{ formatDuration(r.end! - r.start) }}</b>
            <Button
              label="₽"
              :severity="r.billable ? 'success' : 'secondary'"
              :aria-label="
                r.billable
                  ? 'Оплачиваемое: сделать неоплачиваемым'
                  : 'Неоплачиваемое: сделать оплачиваемым'
              "
              :title="r.billable ? 'Оплачиваемое' : 'Неоплачиваемое'"
              :aria-pressed="r.billable"
              size="small"
              @click="command({ type: 'edit', id: r.id, patch: { billable: !r.billable } })"
            />
            <Button
              label="▶"
              severity="secondary"
              size="small"
              title="Запустить новый таймер"
              aria-label="Запустить новый таймер"
              @click="command({ type: 'create', title: r.title, billable: r.billable })"
            />
            <Button
              label="✎"
              severity="secondary"
              size="small"
              aria-label="Редактировать запись"
              @click="editing = r"
            />
            <Button
              label="×"
              severity="secondary"
              size="small"
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
