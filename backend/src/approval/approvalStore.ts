import { randomUUID } from "node:crypto";
import type { DeviceAction, PendingApproval } from "../types/actions.js";

class ApprovalStore {
  private pending = new Map<string, PendingApproval>();

  create(action: DeviceAction, reason: string): PendingApproval {
    action.status = "pending_approval";
    const approval: PendingApproval = {
      id: randomUUID(),
      deviceId: action.deviceId,
      action,
      reason,
      createdAt: new Date().toISOString(),
    };
    this.pending.set(approval.id, approval);
    return approval;
  }

  get(id: string): PendingApproval | undefined {
    return this.pending.get(id);
  }

  listPending(deviceId: string): PendingApproval[] {
    return [...this.pending.values()].filter((a) => a.deviceId === deviceId);
  }

  resolve(id: string): PendingApproval | undefined {
    const approval = this.pending.get(id);
    if (approval) this.pending.delete(id);
    return approval;
  }
}

export const approvalStore = new ApprovalStore();
