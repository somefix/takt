<script setup lang="ts">
import { reactive, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';

import { errorMessage } from '../lib/types.ts';
import { localDate, localTime, formatDuration, formTimes } from '../lib/model.ts';

import type { TimeRecord, RecordFields, TimeMode } from '../lib/types.ts';

const props = defineProps<{ record?: TimeRecord; active?: boolean }>();
const emit = defineEmits<{ save: [fields: RecordFields]; cancel: [] }>();

const r = props.record;
const start = r?.start ?? Date.now();
const end = r?.end ?? start + 3600000;

const form = reactive({
  title: r?.title || '',
  date: localDate(start),
  start: localTime(start),
  endDate: localDate(end),
  end: localTime(end),
  duration: formatDuration(end - start),
  billable: r?.billable ?? false,
});

const mode = ref<TimeMode>('end');
const error = ref('');

function submit() {
  try {
    const times = formTimes(form, props.active, mode.value);

    emit('save', { title: form.title.trim() || 'Без названия', ...times, billable: form.billable });
  } catch (e) {
    error.value = errorMessage(e);
  }
}
</script>

<template>
  <form
    class="record-form"
    @submit.prevent="submit"
  >
    <label>
      Название
      <InputText
        v-model="form.title"
        maxlength="2000"
        placeholder="Над чем работали?"
      />
    </label>
    <div class="fields">
      <label>
        Дата
        <input
          v-model="form.date"
          type="date"
          required
        />
      </label>
      <label>
        Начало
        <input
          v-model="form.start"
          type="time"
          step="1"
          required
        />
      </label>
    </div>
    <template v-if="!active">
      <div class="segmented">
        <button
          type="button"
          :class="{ selected: mode === 'end' }"
          @click="mode = 'end'"
        >
          Окончание
        </button>
        <button
          type="button"
          :class="{ selected: mode === 'duration' }"
          @click="mode = 'duration'"
        >
          Длительность
        </button>
      </div>
      <div
        v-if="mode === 'end'"
        class="fields"
      >
        <label>
          Дата окончания
          <input
            v-model="form.endDate"
            type="date"
            required
          />
        </label>
        <label>
          Окончание
          <input
            v-model="form.end"
            type="time"
            step="1"
            required
          />
        </label>
      </div>
      <label v-else>
        Длительность (ЧЧ:ММ:СС)
        <InputText
          v-model="form.duration"
          required
        />
      </label>
    </template>
    <label class="check">
      <input
        type="checkbox"
        v-model="form.billable"
      />
      Оплачиваемое
    </label>
    <p
      v-if="error"
      role="alert"
      class="error"
    >
      {{ error }}
    </p>
    <div class="actions">
      <Button
        type="submit"
        :label="record ? 'Сохранить' : 'Добавить'"
      />
      <Button
        type="button"
        label="Отмена"
        severity="secondary"
        @click="emit('cancel')"
      />
    </div>
  </form>
</template>
