# Arquitetura

```mermaid
sequenceDiagram
    participant U as Usuário
    participant App as App iOS (Cosmo)
    participant BE as Backend (Node/TS)
    participant C as Claude API

    U->>App: Comando (texto/voz)
    App->>BE: POST /command
    BE->>C: mensagens + catálogo de tools
    C-->>BE: pedido de tool call (ação)
    BE->>BE: classifica ação (policy/sensitivity.ts)
    alt ação autônoma
        BE->>BE: enfileira ação para o dispositivo
    else ação sensível
        BE->>BE: cria "pending approval"
        BE->>App: push notification (pedir aprovação)
        App->>U: mostra ApprovalView
        U->>App: aprova / nega
        App->>BE: POST /approvals/:id/decision
        BE->>BE: se aprovado, enfileira ação
    end
    App->>BE: GET /device/:id/next-action (poll)
    BE-->>App: ação enfileirada
    App->>App: executa via App Intent / EventKit / etc.
    App->>BE: POST /device/:id/report (resultado)
    BE->>C: resultado da tool → continua a conversa
```

## Componentes

### Backend (`backend/`)

- `agent/orchestrator.ts` — chama a API do Claude com o histórico da
  conversa e o catálogo de tools; interpreta as `tool_use` que o modelo
  retorna.
- `agent/tools.ts` — catálogo de ações possíveis (schema JSON de cada tool),
  espelhando o que o app iOS de fato consegue executar.
- `policy/sensitivity.ts` — classifica cada ação como `auto` ou
  `approval_required`, seguindo `docs/POLICY.md`.
- `approval/approvalStore.ts` — fila em memória de aprovações pendentes por
  dispositivo.
- `approval/push.ts` — stub de envio de push (APNs); precisa de certificado/
  chave da Apple para funcionar de verdade.
- `store/deviceQueue.ts` — fila de ações prontas para o app executar.
- `store/sessionStore.ts` — histórico de conversa por usuário/dispositivo.
- `mac/macRegistry.ts` — agentes macOS conectados e pareamentos por código.
- `mac/relay.ts` — WebSocket que empurra as teclas do telefone para o Mac.
- `routes/` — API HTTP consumida pelo app.

### App iOS (`ios-app/`)

- `Intents/` — `AppIntent`s que a Siri/Atalhos conseguem invocar e que o
  próprio Cosmo executa ao receber uma ação do backend.
- `Networking/BackendClient.swift` — chama a API do backend.
- `Networking/PushHandler.swift` — recebe push silenciosa, acorda o app em
  background, busca a próxima ação (`GET /device/:id/next-action`).
- `Approval/ApprovalView.swift` — tela de confirmação para ações sensíveis.
- `Intents/ActionExecutor.swift` — despacha a ação recebida do backend para
  o `AppIntent`/API correspondente.
- `RemoteKeyboard/` — aba "Teclado": captura as teclas com `UIKeyInput` e as
  manda em lote para o Mac (ver `docs/MAC_KEYBOARD.md`).

### Agente macOS (`mac-agent/`)

Executável Swift (SPM) que fica conectado ao backend por WebSocket e injeta
as teclas recebidas com `CGEvent`. É a única parte do projeto que roda no
Mac, e o único caminho em que o Cosmo controla *outro* aparelho a partir do
iPhone — ver a seção abaixo.

## Teclado do Mac (iPhone → Mac)

Fluxo separado do de ações: aqui o iPhone é o *controle*, não o alvo.

```mermaid
sequenceDiagram
    participant U as Usuário
    participant App as App iOS (aba Teclado)
    participant BE as Backend (relay)
    participant Ag as Agente no Mac
    participant Mac as macOS

    Ag->>BE: WebSocket /mac/agent (agentId)
    BE-->>Ag: código de pareamento (6 dígitos)
    Ag->>U: mostra o código no terminal
    U->>App: digita o código
    App->>BE: POST /mac/pair
    BE-->>App: token de sessão
    loop a cada tecla
        U->>App: digita
        App->>App: agrupa eventos (30 ms)
        App->>BE: POST /mac/input (+ token)
        BE->>Ag: push do lote pelo WebSocket
        Ag->>Mac: CGEvent (keycode ou string Unicode)
    end
```

Por que WebSocket só de um lado: o app iOS já fala HTTP com o backend e
digitação sai em lote, então o custo por requisição é aceitável; já a perna
backend→Mac precisa ser *push*, senão o agente teria que ficar em polling e
a latência apareceria na hora de digitar.

Detalhes de tradução de tecla, limitações e segurança: `docs/MAC_KEYBOARD.md`.

## Roadmap para ampliar o que é "autônomo"

Como o iOS não permite automação de UI de terceiros, cobrir mais serviços
(WhatsApp, Instagram, Amazon, etc.) exige integrar as **APIs oficiais** de
cada um deles como novas tools no backend — não simular toques na tela. Cada
nova integração:

1. Vira uma tool nova em `agent/tools.ts`.
2. É classificada em `policy/sensitivity.ts`.
3. Se precisar rodar algo no dispositivo (não só numa API externa), ganha um
   `AppIntent` correspondente no app iOS.

## Por que não usar Accessibility Service / ADB como no Android

Esses mecanismos não existem no iOS sem jailbreak. Jailbreak está fora de
escopo por quebrar garantias de segurança do dispositivo do usuário e não é
algo que este projeto deve assumir como pré-requisito.
