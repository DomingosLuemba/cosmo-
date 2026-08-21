# Teclado do Mac pelo iPhone

Transforma o iPhone num teclado do Mac: você digita no app Cosmo (aba
**Teclado**) e as teclas aparecem no app que estiver em foco no Mac.

```
iPhone (app Cosmo)  ──HTTP──►  Backend  ──WebSocket──►  Agente no Mac  ──CGEvent──►  macOS
```

## Por que esse sentido funciona (e o contrário não)

O resto do Cosmo esbarra no fato de o iOS não permitir automação de UI de
apps de terceiros (ver `README.md`). Aqui o sentido é o inverso, e é
justamente o sentido que a Apple permite:

- **macOS**: um processo autorizado em Acessibilidade pode sintetizar
  eventos de teclado com `CGEvent` e o sistema os trata como se viessem de um
  teclado físico. É a mesma API que o Keyboard Maestro, o BetterTouchTool e
  afins usam.
- **iOS**: não existe equivalente. Um app não consegue injetar teclas em
  outro app, nem ler o que você digita fora dele.

Ou seja: **iPhone digitando no Mac, sim. Mac digitando no iPhone, não** — para
isso só o Universal Control da própria Apple, que não tem API pública.

## Passo a passo

### 1. Backend

```bash
cd backend
npm install
npm run dev
```

Anote o IP da máquina na rede local (`ipconfig getifaddr en0` no macOS). O
iPhone e o Mac precisam enxergar essa máquina.

### 2. Agente no Mac

```bash
cd mac-agent
swift run cosmo-mac-agent --backend http://192.168.0.10:3000
```

Se o backend roda no próprio Mac, pode omitir `--backend`.

Na primeira vez o macOS pede permissão de **Acessibilidade**. Sem ela o
agente sai com instruções — ver `mac-agent/README.md` para o detalhe de que
quem precisa ser autorizado é o **terminal**, não o binário.

O agente imprime um código de 6 dígitos, válido por 5 minutos.

### 3. Parear no iPhone

App Cosmo → aba **Teclado** → digite o código → **Parear**.

### 4. Digitar

Toque na área de captura e digite. O texto **não** aparece no iPhone — ele
sai direto no Mac. Abaixo do campo ficam:

- **Modificadores** (⌘ ⇧ ⌥ ⌃ fn) — ficam presos até a próxima tecla, como as
  teclas presas do acesso assistido. Ligue ⌘ e toque "c" para mandar ⌘C.
- **Teclas especiais** — esc, tab, ⌫, ⏎ e as setas.
- **Atalhos prontos** — ⌘C, ⌘V, ⌘X, ⌘Z.

## Como as teclas são traduzidas

| O que você faz | Como viaja | Como o Mac injeta |
| --- | --- | --- |
| Digita texto | `{"type":"text","text":"ação 🚀"}` | `CGEventKeyboardSetUnicodeString` |
| Toca ⏎, esc, seta | `{"type":"key","key":"return"}` | virtual keycode fixo (Carbon) |
| ⌘ + "c" | `{"type":"key","key":"c","modifiers":["command"]}` | keycode do layout ativo + flag |

Texto normal vai como string Unicode porque isso **independe do layout**:
acento e emoji chegam iguais em ABNT2, US ou Dvorak. Já atalhos precisam do
keycode físico — a tecla "c" fica em posições diferentes em cada layout —,
então o agente monta o mapa caractere→keycode em tempo de execução a partir
do layout ativo, em vez de assumir US-QWERTY.

Teclas são enviadas **em lote**: digitação corrida vira um evento de texto só,
com uma janela de agrupamento de 30 ms. Uma requisição por tecla seria
desperdício.

## Testar o relay sem um Mac

```bash
cd backend
npm run test:mac
```

Sobe o backend numa porta separada, simula o agente com um cliente WebSocket
e o telefone com chamadas HTTP, e verifica o contrato entre os três:
pareamento, recusa de token inválido, entrega do lote e reconexão. Não cobre
a injeção de teclas em si — isso exige um Mac com a permissão concedida.

## Limitações

- **Só teclado.** Não tem cursor/trackpad. Dá para navegar com Tab e setas,
  mas não para clicar. (Ver "Próximos passos".)
- **O agente precisa estar rodando.** Ctrl-C nele corta o acesso na hora — é
  o botão de pânico.
- **Reiniciar o backend desfaz o pareamento**, porque o registro é em memória
  (`backend/src/mac/macRegistry.ts`), como o resto do esqueleto. Reiniciar o
  *agente* não desfaz: ele guarda o id em `~/.cosmo/mac-agent.json`.
- **Teclas perdidas não são reenviadas.** Se a rede cair no meio de um lote,
  ele é descartado de propósito: reenviar uma tecla velha depois de reconectar
  a faria cair no app que estiver em foco naquele momento, que pode ser outro.
- **Sem feedback do Mac.** O iPhone não vê a tela do Mac, então você digita
  olhando para o Mac.

## Segurança

Este canal digita de verdade no seu Mac, inclusive atalhos destrutivos. O que
existe hoje:

- O pareamento exige um código de 6 dígitos mostrado **só no terminal do
  Mac**, que expira em 5 minutos.
- Cada `POST /mac/input` exige o token de sessão devolvido no pareamento
  (header `x-cosmo-mac-token`).
- Um usuário controla um Mac por vez; `POST /mac/unpair` corta o vínculo.

O que **falta** antes de isso sair da rede local:

- Autenticação de usuário de verdade — hoje `CurrentUser` no app iOS é um
  placeholder fixo (`demo-user`), então o `userId` não prova nada sozinho. É
  o token de sessão que segura a porta.
- O token está em `UserDefaults` no iPhone; deveria estar no Keychain.
- TLS. Em `http://` na rede local, quem estiver na mesma rede vê as teclas
  passando.

Resumo: **não exponha esse backend na internet aberta como está.**

## Próximos passos

- Cursor/trackpad: mesmo canal, um evento `{"type":"mouse"}` novo e
  `CGEvent(mouseEventSource:)` no agente.
- WebSocket também na perna iPhone→backend (hoje HTTP), para cortar o custo
  de handshake em digitação longa.
- Deixar o Claude usar esse canal: uma tool `mac_type` no catálogo
  (`backend/src/agent/tools.ts`) roteada para o agente em vez da fila do
  iPhone — aí o Cosmo digita no Mac por comando de voz.
