export type Sensitivity = "auto" | "approval_required";

export type ActionStatus =
  | "pending_approval"
  | "queued"
  | "delivered"
  | "completed"
  | "failed"
  | "denied";

export interface DeviceAction {
  id: string;
  userId: string;
  deviceId: string;
  toolName: string;
  input: Record<string, unknown>;
  sensitivity: Sensitivity;
  status: ActionStatus;
  createdAt: string;
  /** Populated once the device reports back. */
  result?: unknown;
  error?: string;
}

export interface PendingApproval {
  id: string;
  deviceId: string;
  action: DeviceAction;
  reason: string;
  createdAt: string;
}
