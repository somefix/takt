export function createUndo<T, H = ReturnType<typeof setTimeout>>(
  onChange: (record: T | null) => void,
  schedule: (callback: () => void, delay: number) => H = setTimeout as unknown as (
    callback: () => void,
    delay: number,
  ) => H,
  cancel: (handle: H) => void = clearTimeout as unknown as (handle: H) => void,
) {
  let current: T | null = null;
  let timer: H | undefined;
  const cancelTimer = () => {
    if (timer !== undefined) {
      cancel(timer);
    }
  };

  return {
    offer(record: T) {
      cancelTimer();
      current = record;
      onChange(record);
      timer = schedule(() => {
        current = null;
        onChange(null);
      }, 5000);
    },
    peek() {
      return current;
    },
    clear() {
      cancelTimer();
      current = null;
      onChange(null);
    },
    dispose() {
      cancelTimer();
    },
  };
}
