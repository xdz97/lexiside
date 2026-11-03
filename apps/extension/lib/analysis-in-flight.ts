export class InFlightByKey<T> {
  private readonly tasks = new Map<string, Promise<T>>();

  run(key: string, start: () => Promise<T>): Promise<T> {
    const existing = this.tasks.get(key);
    if (existing) return existing;

    const task = Promise.resolve().then(start);
    this.tasks.set(key, task);
    void task.finally(() => {
      if (this.tasks.get(key) === task) this.tasks.delete(key);
    }).catch(() => undefined);
    return task;
  }
}
