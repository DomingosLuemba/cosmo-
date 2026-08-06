# Cosmo — IA que controla o iPhone por comando

Cosmo é um assistente que usa o **Claude** como "cérebro" para interpretar comandos
do usuário e executar ações no iPhone, agindo com autonomia total em tarefas
reversíveis do dia a dia e **parando para pedir aprovação explícita** apenas em
ações sensíveis (assinaturas, pagamentos, compras, exclusão permanente de
dados, mudanças de segurança da conta, etc).

Este repositório contém o **esqueleto** do projeto: arquitetura, estrutura de
pastas e código inicial de cada componente. Ainda não é um produto funcional
de ponta a ponta — é a base para construir sobre.

## Aviso importante sobre limites reais do iOS

No iOS **sem jailbreak**, nenhum app de terceiros — nem o Cosmo — consegue
"ver a tela e tocar em qualquer app" como um assistente faria no Android via
Accessibility Service. A Apple não permite automação genérica de UI de apps
de terceiros. Isso não é uma limitação de implementação: é uma restrição de
plataforma.

Na prática, o controle real do Cosmo fica limitado ao que a Apple expõe por
frameworks públicos:

- **App Intents / SiriKit** — ações que o próprio app Cosmo declara e que a
  Siri/Atalhos podem disparar.
- **EventKit** — lembretes e eventos de calendário.
- **Contacts / MessageUI** — abrir a tela de composição de mensagem/e-mail
  pré-preenchida (o envio final ainda exige toque do usuário, por design da
  Apple, a menos que se use a API de Mensagens do próprio app).
- **HomeKit** — dispositivos domésticos.
- **URL Schemes / Universal Links** — abrir outros apps em telas específicas,
  se o app de destino expuser esse esquema.
- **Atalhos (Shortcuts) do usuário** — automações que o próprio usuário
  configura no app Atalhos, disparadas remotamente pelo Cosmo.

Ações fora desse catálogo (ex.: "manda uma DM no Instagram", "compra algo na
Amazon sem eu confirmar") **não são tecnicamente possíveis de forma nativa e
autônoma no iOS**. Ver `docs/ARCHITECTURE.md` para o roadmap de como ampliar
a cobertura (ex.: integrações oficiais via API de cada serviço, em vez de
automação de UI).

## Estrutura

```
backend/      Servidor Node/TypeScript: orquestra o Claude, define as tools
              disponíveis, aplica a política de aprovação e mantém a fila de
              ações para o app executar no telefone.
ios-app/      App iOS (Swift/SwiftUI + App Intents): recebe ações do backend
              e as executa localmente; mostra tela de aprovação para ações
              sensíveis.
docs/         Arquitetura e política de sensibilidade (o que é autônomo vs.
              o que exige aprovação).
```

## Fluxo resumido

1. Usuário manda um comando em texto/voz para o app (ou direto pro backend).
2. Backend chama o Claude com o histórico + catálogo de tools (ações
   possíveis no telefone).
3. Para cada ação que o Claude decide executar, o backend classifica:
   - **Autônoma** → entra na fila do dispositivo, o app executa sozinho.
   - **Sensível** → vira uma "aprovação pendente"; o app mostra a tela de
     confirmação; só executa se o usuário aprovar.
4. O app reporta o resultado de cada ação de volta ao backend, que alimenta
   o Claude para decidir o próximo passo.

Veja `docs/ARCHITECTURE.md` para o diagrama completo e `docs/POLICY.md` para
a lista exata do que é considerado sensível.

## Como rodar o backend (dev)

```bash
cd backend
cp .env.example .env   # preencha ANTHROPIC_API_KEY
npm install
npm run dev
```

## Como abrir o app iOS

O app precisa do Xcode (macOS) para compilar — não é possível gerar/testar
aqui. Veja `ios-app/README.md` para o passo a passo de criar o projeto Xcode
e importar os arquivos Swift deste repositório.
