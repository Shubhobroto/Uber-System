export interface Cancellable {
  cancel(): void;
}

interface Task {
  at: number;
  seq: number;
  run: () => void;
  cancelled: boolean;
}

/**
 * Simulated clock. Nothing waits for real time: tasks run in time order (ties in scheduling order),
 * which makes every scenario deterministic and lets the UI play it at any speed.
 */
export class Scheduler {
  private current = 0;
  private seq = 0;
  private tasks: Task[] = [];

  time(): number {
    return this.current;
  }

  at(time: number, run: () => void): Cancellable {
    const task: Task = { at: Math.max(time, this.current), seq: this.seq++, run, cancelled: false };
    this.tasks.push(task);
    return { cancel: () => (task.cancelled = true) };
  }

  after(delayMs: number, run: () => void): Cancellable {
    return this.at(this.current + delayMs, run);
  }

  every(intervalMs: number, run: () => void): Cancellable {
    let stopped = false;
    let handle: Cancellable;
    const tick = () => {
      if (stopped) return;
      run();
      if (!stopped) handle = this.after(intervalMs, tick);
    };
    handle = this.after(intervalMs, tick);
    return {
      cancel: () => {
        stopped = true;
        handle.cancel();
      },
    };
  }

  advanceTo(target: number): void {
    for (;;) {
      this.tasks = this.tasks.filter((t) => !t.cancelled);
      let next: Task | undefined;
      for (const t of this.tasks) {
        if (t.at > target) continue;
        if (!next || t.at < next.at || (t.at === next.at && t.seq < next.seq)) next = t;
      }
      if (!next) break;
      this.tasks.splice(this.tasks.indexOf(next), 1);
      this.current = next.at;
      next.run();
    }
    this.current = Math.max(this.current, target);
  }

  advanceBy(ms: number): void {
    this.advanceTo(this.current + ms);
  }
}
