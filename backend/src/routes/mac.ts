import { Router } from "express";
import { z } from "zod";
import { macRegistry } from "../mac/macRegistry.js";
import type { MacInputEvent } from "../types/keyboard.js";

/** Teto por lote — o telefone agrupa teclas antes de mandar (ver MacKeyboardClient). */
const MAX_EVENTS_PER_BATCH = 64;
const MAX_TEXT_LENGTH = 500;

const TOKEN_HEADER = "x-cosmo-mac-token";

const modifierSchema = z.enum(["command", "shift", "option", "control", "function"]);

const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(MAX_TEXT_LENGTH) }),
  z.object({
    type: z.literal("key"),
    key: z.string().min(1).max(20),
    modifiers: z.array(modifierSchema).max(5).optional(),
  }),
]);

export const macRouter = Router();

const pairSchema = z.object({
  userId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "O código tem 6 dígitos."),
});

/** O telefone troca o código mostrado no terminal do Mac por um token de sessão. */
macRouter.post("/mac/pair", (req, res) => {
  const parsed = pairSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const result = macRegistry.claim(parsed.data.code, parsed.data.userId);
  if ("error" in result) {
    res.status(404).json({ error: result.error });
    return;
  }

  res.json(result);
});

const inputSchema = z.object({
  userId: z.string().min(1),
  events: z.array(eventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});

/** Lote de teclas do telefone → agente do Mac. */
macRouter.post("/mac/input", (req, res) => {
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const token = String(req.header(TOKEN_HEADER) ?? "");
  if (!token) {
    res.status(401).json({ error: `Header ${TOKEN_HEADER} é obrigatório.` });
    return;
  }

  const events = parsed.data.events as MacInputEvent[];
  const outcome = macRegistry.deliver(parsed.data.userId, token, events);
  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }

  res.json({ delivered: events.length, agentName: outcome.agentName });
});

macRouter.get("/mac/status", (req, res) => {
  const userId = String(req.query.userId ?? "");
  if (!userId) {
    res.status(400).json({ error: "userId é obrigatório" });
    return;
  }

  const pairing = macRegistry.pairingForUser(userId);
  if (!pairing) {
    res.json({ paired: false, online: false });
    return;
  }

  res.json({
    paired: true,
    online: macRegistry.isOnline(pairing.agentId),
    agentId: pairing.agentId,
    agentName: pairing.agentName,
    pairedAt: pairing.pairedAt,
  });
});

const unpairSchema = z.object({ userId: z.string().min(1) });

macRouter.post("/mac/unpair", (req, res) => {
  const parsed = unpairSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const token = String(req.header(TOKEN_HEADER) ?? "");
  const removed = macRegistry.unpair(parsed.data.userId, token);
  if (!removed) {
    res.status(401).json({ error: "Nenhum pareamento com esse usuário/token." });
    return;
  }

  res.json({ status: "unpaired" });
});
