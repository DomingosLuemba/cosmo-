/**
 * Teste de fumaça do relay de teclado (`npm run test:mac`).
 *
 * Sobe o backend numa porta separada, simula o agente do Mac com um cliente
 * WebSocket e o telefone com chamadas HTTP, e verifica o contrato entre os
 * três: pareamento, autorização por token, entrega do lote e reconexão.
 *
 * Não testa a injeção de teclas em si — isso exige um Mac de verdade com
 * permissão de Acessibilidade (ver docs/MAC_KEYBOARD.md).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import WebSocket from "ws";

const PORT = Number(process.env.SMOKE_PORT ?? 3999);
const BASE = `http://localhost:${PORT}`;
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(name, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

async function startServer() {
  const server = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      // O SDK do Anthropic exige a chave já na construção do cliente; nada
      // neste teste chega a chamar a API.
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "smoke-test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetch(`${BASE}/health`);
      return server;
    } catch {
      await wait(250);
    }
  }

  server.kill();
  throw new Error(`o backend não subiu em ${BASE} a tempo`);
}

function post(path, body, token) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-cosmo-mac-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
}

function connectAgent(agentId, name) {
  const socket = new WebSocket(
    `ws://localhost:${PORT}/mac/agent?agentId=${agentId}&name=${encodeURIComponent(name)}`
  );
  const received = [];
  socket.on("message", (raw) => received.push(JSON.parse(String(raw))));
  const ready = new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });
  return { socket, received, ready };
}

async function run() {
  const agentId = "agent-smoke-1";
  const agentName = "Mac de teste";
  const agent = connectAgent(agentId, agentName);
  await agent.ready;
  await wait(150);

  const registered = agent.received.find((m) => m.type === "registered");
  const code = registered?.pairingCode;
  check("agente recebe código de pareamento", /^\d{6}$/.test(code ?? ""), `código=${code}`);

  let response = await post("/mac/input", {
    userId: "demo-user",
    events: [{ type: "text", text: "oi" }],
  }, "token-qualquer");
  check("digitar sem parear é rejeitado", response.status === 404, `status=${response.status}`);

  response = await post("/mac/pair", { userId: "demo-user", code: "000000" });
  check("código inválido é rejeitado", response.status === 404, `status=${response.status}`);

  response = await post("/mac/pair", { userId: "demo-user", code });
  const pairing = await response.json();
  check("pareamento devolve token", response.ok && typeof pairing.token === "string");

  response = await post("/mac/input", {
    userId: "demo-user",
    events: [{ type: "text", text: "oi" }],
  }, "token-errado");
  check("token errado é rejeitado", response.status === 401, `status=${response.status}`);

  agent.received.length = 0;
  response = await post("/mac/input", {
    userId: "demo-user",
    events: [
      { type: "text", text: "olá, açaí 🚀" },
      { type: "key", key: "return" },
      { type: "key", key: "c", modifiers: ["command"] },
    ],
  }, pairing.token);
  const delivery = await response.json();
  await wait(150);

  const input = agent.received.find((m) => m.type === "input");
  check("lote entregue ao agente", response.ok && delivery.delivered === 3);
  check("agente recebeu os 3 eventos", input?.events?.length === 3);
  check("texto com acento e emoji chega intacto", input?.events?.[0]?.text === "olá, açaí 🚀");
  check("atalho preserva o modificador", input?.events?.[2]?.modifiers?.[0] === "command");

  response = await post("/mac/input", {
    userId: "demo-user",
    events: [{ type: "mouse", x: 1 }],
  }, pairing.token);
  check("evento fora do catálogo é rejeitado", response.status === 400, `status=${response.status}`);

  response = await post("/mac/input", {
    userId: "demo-user",
    events: Array(65).fill({ type: "text", text: "x" }),
  }, pairing.token);
  check("lote acima do teto é rejeitado", response.status === 400, `status=${response.status}`);

  let status = await (await fetch(`${BASE}/mac/status?userId=demo-user`)).json();
  check("status mostra pareado e online", status.paired === true && status.online === true);

  // Reiniciar o agente não pode pedir pareamento de novo.
  agent.socket.close();
  await wait(200);
  status = await (await fetch(`${BASE}/mac/status?userId=demo-user`)).json();
  check("agente aparece offline após desconectar", status.online === false);

  const reconnected = connectAgent(agentId, agentName);
  await reconnected.ready;
  await wait(150);
  const reRegistered = reconnected.received.find((m) => m.type === "registered");
  check(
    "reconexão continua pareada, sem novo código",
    reRegistered?.paired === true && !reRegistered?.pairingCode
  );

  response = await post("/mac/input", {
    userId: "demo-user",
    events: [{ type: "text", text: "depois de reconectar" }],
  }, pairing.token);
  check("token continua válido após reconexão", response.ok, `status=${response.status}`);

  response = await post("/mac/unpair", { userId: "demo-user" }, pairing.token);
  check("desparear funciona", response.ok, `status=${response.status}`);

  status = await (await fetch(`${BASE}/mac/status?userId=demo-user`)).json();
  check("status volta a não-pareado", status.paired === false);

  reconnected.socket.close();
}

const server = await startServer();
try {
  await run();
} finally {
  server.kill();
}

console.log(failures === 0 ? "\nTodos os testes passaram." : `\n${failures} teste(s) falharam.`);
process.exit(failures === 0 ? 0 : 1);
