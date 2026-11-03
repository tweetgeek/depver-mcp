/** Per-key concurrency limiter: at most `limit` tasks in flight for one key, FIFO queueing. */
export interface Limiter {
  run<T>(key: string, limit: number, task: () => Promise<T>): Promise<T>;
}

interface Lane {
  active: number;
  queue: Array<() => void>;
}

export function createLimiter(): Limiter {
  const lanes = new Map<string, Lane>();

  function lane(key: string): Lane {
    let l = lanes.get(key);
    if (!l) {
      l = { active: 0, queue: [] };
      lanes.set(key, l);
    }
    return l;
  }

  function acquire(key: string, limit: number): Promise<void> {
    const l = lane(key);
    if (l.active < limit) {
      l.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      l.queue.push(() => {
        l.active++;
        resolve();
      });
    });
  }

  function release(key: string): void {
    const l = lane(key);
    l.active--;
    const next = l.queue.shift();
    if (next) next();
  }

  return {
    async run(key, limit, task) {
      await acquire(key, limit);
      try {
        return await task();
      } finally {
        release(key);
      }
    },
  };
}
