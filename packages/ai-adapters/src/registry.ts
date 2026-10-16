import type { AdapterByTask, AnyAdapter, ProductionTask } from "./contracts";

/**
 * The adapters compiled into this build, addressed by task and backend id.
 *
 * One backend usually contributes several adapters, one per task it can
 * perform, all sharing the backend's id. Registering an adapter says nothing
 * about whether it can run: callers still call `detect()`.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, AnyAdapter>();

  private static key(task: ProductionTask, id: string): string {
    return `${task}\n${id}`;
  }

  register(adapter: AnyAdapter): this {
    const key = AdapterRegistry.key(adapter.task, adapter.id);
    if (this.adapters.has(key)) {
      throw new Error(
        `An adapter "${adapter.id}" is already registered for ${adapter.task}.`,
      );
    }
    this.adapters.set(key, adapter);
    return this;
  }

  get<Task extends ProductionTask>(
    task: Task,
    id: string,
  ): AdapterByTask[Task] | null {
    const adapter = this.adapters.get(AdapterRegistry.key(task, id));
    return (adapter as AdapterByTask[Task] | undefined) ?? null;
  }

  /** Every adapter, or only those for one task, in registration order. */
  list(task?: ProductionTask): AnyAdapter[] {
    const all = [...this.adapters.values()];
    return task ? all.filter((adapter) => adapter.task === task) : all;
  }
}
