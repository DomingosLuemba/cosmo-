import { randomInt, randomUUID } from "node:crypto";
import type { MacInputEvent } from "../types/keyboard.js";

/** Quanto tempo um código de pareamento fica válido. */
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

type Sender = (payload: unknown) => void;

interface ConnectedAgent {
  id: string;
  name: string;
  connectedAt: string;
  send: Sender;
}

interface Pairing {
  agentId: string;
  agentName: string;
  userId: string;
  /** Segredo que o telefone precisa mandar em toda `POST /mac/input`. */
  token: string;
  pairedAt: string;
}

interface PairingCode {
  code: string;
  agentId: string;
  expiresAt: number;
}

export interface ClaimResult {
  agentId: string;
  agentName: string;
  token: string;
}

/**
 * Registro em memória dos agentes macOS conectados e de quem está pareado
 * com quem. Como o resto do esqueleto (deviceQueue, approvalStore), some
 * quando o processo reinicia — um MVP real persistiria os pareamentos.
 *
 * O agente guarda seu `agentId` em disco e o reenvia ao reconectar, então
 * reiniciar o agente não obriga a parear de novo; reiniciar o backend, sim.
 */
class MacRegistry {
  private connected = new Map<string, ConnectedAgent>();
  /** agentId → pareamento. */
  private pairings = new Map<string, Pairing>();
  /** code → agente que está esperando ser pareado. */
  private codes = new Map<string, PairingCode>();

  /**
   * Chamado quando o agente abre o WebSocket. Devolve o código de pareamento
   * que o agente deve mostrar no terminal, ou `undefined` se aquele agentId
   * já estiver pareado.
   */
  connect(agentId: string, name: string, send: Sender): { pairingCode?: string } {
    this.connected.set(agentId, {
      id: agentId,
      name,
      connectedAt: new Date().toISOString(),
      send,
    });

    const existing = this.pairings.get(agentId);
    if (existing) {
      existing.agentName = name;
      return {};
    }

    return { pairingCode: this.issueCode(agentId) };
  }

  disconnect(agentId: string): void {
    this.connected.delete(agentId);
    for (const [code, entry] of this.codes) {
      if (entry.agentId === agentId) this.codes.delete(code);
    }
  }

  /** O telefone troca o código de 6 dígitos por um token de sessão. */
  claim(code: string, userId: string): ClaimResult | { error: string } {
    this.purgeExpiredCodes();

    const entry = this.codes.get(code);
    if (!entry) {
      return { error: "Código inválido ou expirado. Reinicie o agente no Mac para gerar outro." };
    }

    const agent = this.connected.get(entry.agentId);
    if (!agent) {
      this.codes.delete(code);
      return { error: "O agente do Mac desconectou antes de você parear." };
    }

    this.codes.delete(code);

    const pairing: Pairing = {
      agentId: agent.id,
      agentName: agent.name,
      userId,
      token: randomUUID(),
      pairedAt: new Date().toISOString(),
    };
    this.pairings.set(agent.id, pairing);

    agent.send({ type: "paired", userId, pairedAt: pairing.pairedAt });

    return { agentId: pairing.agentId, agentName: pairing.agentName, token: pairing.token };
  }

  /** Pareamento ativo do usuário, se houver. Um usuário controla um Mac por vez. */
  pairingForUser(userId: string): Pairing | undefined {
    for (const pairing of this.pairings.values()) {
      if (pairing.userId === userId) return pairing;
    }
    return undefined;
  }

  isOnline(agentId: string): boolean {
    return this.connected.has(agentId);
  }

  /**
   * Entrega um lote de eventos ao Mac pareado. Devolve o motivo da falha em
   * vez de lançar, para a rota responder com o status HTTP certo.
   */
  deliver(
    userId: string,
    token: string,
    events: MacInputEvent[]
  ): { ok: true; agentName: string } | { ok: false; status: number; error: string } {
    const pairing = this.pairingForUser(userId);
    if (!pairing) {
      return { ok: false, status: 404, error: "Nenhum Mac pareado com este usuário." };
    }
    if (pairing.token !== token) {
      return { ok: false, status: 401, error: "Token de sessão inválido. Pareie de novo." };
    }

    const agent = this.connected.get(pairing.agentId);
    if (!agent) {
      return { ok: false, status: 503, error: `"${pairing.agentName}" está offline.` };
    }

    agent.send({ type: "input", events });
    return { ok: true, agentName: pairing.agentName };
  }

  unpair(userId: string, token: string): boolean {
    const pairing = this.pairingForUser(userId);
    if (!pairing || pairing.token !== token) return false;

    this.pairings.delete(pairing.agentId);

    const agent = this.connected.get(pairing.agentId);
    if (agent) {
      // Volta a mostrar um código novo, para o usuário poder parear de novo.
      agent.send({ type: "unpaired", pairingCode: this.issueCode(pairing.agentId) });
    }
    return true;
  }

  private issueCode(agentId: string): string {
    for (const [code, entry] of this.codes) {
      if (entry.agentId === agentId) this.codes.delete(code);
    }

    let code: string;
    do {
      code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    } while (this.codes.has(code));

    this.codes.set(code, { code, agentId, expiresAt: Date.now() + PAIRING_CODE_TTL_MS });
    return code;
  }

  private purgeExpiredCodes(): void {
    const now = Date.now();
    for (const [code, entry] of this.codes) {
      if (entry.expiresAt <= now) this.codes.delete(code);
    }
  }
}

export const macRegistry = new MacRegistry();
