import { Router } from "express";
import { z } from "zod";
import { approvalStore } from "../approval/approvalStore.js";
import { deviceQueue } from "../store/deviceQueue.js";
import { recordApprovalDenied } from "../agent/orchestrator.js";

export const approvalsRouter = Router();

approvalsRouter.get("/approvals/pending", (req, res) => {
  const deviceId = String(req.query.deviceId ?? "");
  if (!deviceId) {
    res.status(400).json({ error: "deviceId é obrigatório" });
    return;
  }
  res.json({ approvals: approvalStore.listPending(deviceId) });
});

const decisionSchema = z.object({
  decision: z.enum(["approved", "denied"]),
});

approvalsRouter.post("/approvals/:approvalId/decision", async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const approval = approvalStore.resolve(req.params.approvalId);
  if (!approval) {
    res.status(404).json({ error: "Aprovação não encontrada (já resolvida ou inexistente)." });
    return;
  }

  if (parsed.data.decision === "approved") {
    deviceQueue.enqueue(approval.action);
    res.json({ status: "queued", action: approval.action });
    return;
  }

  const outcome = await recordApprovalDenied(
    approval.action.userId,
    approval.deviceId,
    approval.action.id
  );
  res.json({ status: "denied", outcome });
});
