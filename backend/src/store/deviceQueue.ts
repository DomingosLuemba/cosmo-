import type { DeviceAction } from "../types/actions.js";

/**
 * Fila em memória de ações prontas para o app iOS buscar e executar.
 * Um MVP real trocaria isso por algo persistente (Redis/Postgres) — aqui
 * fica em memória de propósito, como esqueleto.
 */
class DeviceQueue {
  private queues = new Map<string, DeviceAction[]>();
  private actionsById = new Map<string, DeviceAction>();

  enqueue(action: DeviceAction): void {
    action.status = "queued";
    this.actionsById.set(action.id, action);
    const queue = this.queues.get(action.deviceId) ?? [];
    queue.push(action);
    this.queues.set(action.deviceId, queue);
  }

  /** Remove e retorna a próxima ação pendente para o dispositivo, se houver. */
  dequeueNext(deviceId: string): DeviceAction | undefined {
    const queue = this.queues.get(deviceId);
    const action = queue?.shift();
    if (action) {
      action.status = "delivered";
    }
    return action;
  }

  getById(actionId: string): DeviceAction | undefined {
    return this.actionsById.get(actionId);
  }

  reportResult(actionId: string, result: unknown, error?: string): DeviceAction | undefined {
    const action = this.actionsById.get(actionId);
    if (!action) return undefined;
    action.status = error ? "failed" : "completed";
    action.result = result;
    action.error = error;
    return action;
  }
}

export const deviceQueue = new DeviceQueue();
