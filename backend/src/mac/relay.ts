import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { macRegistry } from "./macRegistry.js";

/** Intervalo do ping para derrubar agentes que sumiram sem fechar o socket. */
const HEARTBEAT_MS = 30_000;

interface AgentSocket extends WebSocket {
  agentId?: string;
  isAlive?: boolean;
}

/**
 * Canal `wss://<backend>/mac/agent` que o agente macOS mantém aberto.
 *
 * É WebSocket (e não polling como o app iOS faz em `/device/:id/next-action`)
 * porque teclado precisa de latência baixa: o backend empurra o lote de teclas
 * assim que ele chega do telefone.
 */
export function attachMacRelay(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/mac/agent" });

  wss.on("connection", (socket: AgentSocket, request) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const agentId = url.searchParams.get("agentId");
    const name = url.searchParams.get("name") ?? "Mac";

    if (!agentId) {
      socket.close(1008, "agentId é obrigatório");
      return;
    }

    socket.agentId = agentId;
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    const send = (payload: unknown) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(payload));
      }
    };

    const { pairingCode } = macRegistry.connect(agentId, name, send);
    send({ type: "registered", agentId, paired: !pairingCode, pairingCode });
    console.log(
      `[mac] agente "${name}" (${agentId}) conectou` +
        (pairingCode ? ` — código de pareamento ${pairingCode}` : " — já pareado")
    );

    socket.on("message", (raw) => {
      // O agente só reporta status/erro de execução; nada aqui muda estado.
      try {
        const message = JSON.parse(String(raw)) as { type?: string; error?: string };
        if (message.type === "error") {
          console.error(`[mac] agente ${agentId} reportou erro: ${message.error}`);
        }
      } catch {
        console.error(`[mac] mensagem inválida do agente ${agentId}`);
      }
    });

    socket.on("close", () => {
      macRegistry.disconnect(agentId);
      console.log(`[mac] agente "${name}" (${agentId}) desconectou`);
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients as Set<AgentSocket>) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, HEARTBEAT_MS);

  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}
