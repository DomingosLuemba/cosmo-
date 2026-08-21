# Cosmo — agente de teclado do Mac

Recebe as teclas digitadas no iPhone (app Cosmo → aba **Teclado**) e as injeta
no Mac como se viessem de um teclado físico.

Sentido do fluxo: **iPhone → backend → este agente → Mac**. É o inverso do
resto do projeto (que roda ações *no* iPhone), e é o sentido que a Apple
permite: o macOS deixa um processo autorizado sintetizar eventos de teclado
via `CGEvent`; o iOS não tem nada equivalente.

## Rodar

Precisa de macOS 13+ e do Xcode (ou das Command Line Tools) instalado.

```bash
cd mac-agent
swift run cosmo-mac-agent --backend http://192.168.0.10:3000
```

Troque o IP pelo da máquina que roda o backend. Se o backend estiver no
próprio Mac, pode omitir `--backend` (o padrão é `http://localhost:3000`).

Opções:

| Opção | Padrão | O que faz |
| --- | --- | --- |
| `--backend <url>` | `http://localhost:3000` | Endereço do backend. Também aceita `COSMO_BACKEND_URL`. |
| `--name <nome>` | nome do computador | Como este Mac aparece no app. Também aceita `COSMO_AGENT_NAME`. |

## Permissão de Acessibilidade (obrigatória)

Na primeira execução o macOS abre um prompt. Se você recusar (ou o prompt não
aparecer), o agente sai com uma mensagem explicando o caminho:

**Ajustes do Sistema → Privacidade e Segurança → Acessibilidade** → ligue a
chave do **app de onde você rodou o comando**.

O detalhe que costuma travar: rodando via `swift run`, quem aparece na lista é
o **Terminal/iTerm/VS Code**, não um app chamado "cosmo-mac-agent". E o macOS
invalida a autorização quando o binário muda — se parar de funcionar depois de
um `swift build`, desligue e ligue a chave de novo.

Sem essa permissão os eventos são criados sem erro e o sistema os **descarta
em silêncio** — por isso o agente checa antes de conectar, em vez de deixar
você digitando no vazio.

## Parear com o iPhone

1. Suba o backend (`cd backend && npm run dev`).
2. Rode o agente. Ele imprime um código de 6 dígitos, válido por 5 minutos.
3. No app Cosmo, aba **Teclado**, digite o código.
4. Pronto: o que você digitar no app vai para o app em foco no Mac.

O agente guarda um id em `~/.cosmo/mac-agent.json`, então reiniciar o agente
**não** pede o código de novo. Reiniciar o *backend* pede, porque o registro
de pareamentos dele é em memória (`backend/src/mac/macRegistry.ts`).

## Como as teclas viram eventos

- **Texto normal** → `CGEventKeyboardSetUnicodeString`. Independe do layout e
  aceita acento e emoji: "ação 🚀" chega igual em ABNT2, US ou Dvorak.
- **Teclas nomeadas** (`return`, `escape`, setas, F1–F12) → virtual keycodes
  do Carbon, que são fixos por posição física.
- **Atalhos** (`⌘C`, `⌘⇧T`) → o keycode real da tecla + flags de modificador.
  Como a posição do "c" muda por layout, o agente monta o mapa
  caractere→keycode em tempo de execução a partir do layout ativo
  (`KeyCodes.currentLayoutCharacterMap`), em vez de assumir US-QWERTY.

## Segurança

Enquanto o agente roda e o pareamento existe, **quem tiver o token de sessão
consegue digitar neste Mac** — inclusive atalhos destrutivos. Por isso:

- O backend é o único caminho de entrada, e ele exige o token devolvido no
  pareamento (header `x-cosmo-mac-token`) em toda requisição.
- Não exponha o backend na internet aberta como está: o esqueleto não tem
  autenticação de usuário de verdade (`CurrentUser` no app iOS é um
  placeholder fixo). Rode na sua rede local, ou coloque autenticação real
  antes.
- **Ctrl-C no agente corta o acesso na hora.** É o botão de pânico.

Ver `docs/MAC_KEYBOARD.md` para o passo a passo completo e as limitações.
