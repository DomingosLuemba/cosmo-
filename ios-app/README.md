# Cosmo — App iOS

Este diretório contém apenas os arquivos Swift — não um `.xcodeproj`, porque
gerar um projeto Xcode válido exige o próprio Xcode (macOS). Para começar a
desenvolver:

## 1. Criar o projeto no Xcode

1. Xcode → File → New → Project → **App** (iOS, SwiftUI, Swift).
2. Nome do produto: `CosmoController`. Bundle id: o que preferir (ex.
   `com.seudominio.cosmocontroller`).
3. Delete o `ContentView.swift` e o arquivo `*App.swift` gerados
   automaticamente pelo Xcode.
4. Arraste a pasta `CosmoController/` deste repositório para dentro do
   projeto no Xcode ("Copy items if needed" **desmarcado**, já que os
   arquivos já estão no lugar certo do repo — ou copie, se preferir manter
   o projeto Xcode fora do git deste jeito).

## 2. Capabilities necessárias (target → Signing & Capabilities)

- **Push Notifications** — para a push que avisa de aprovações pendentes e
  acorda o app. Do outro lado, o backend precisa das variáveis `APNS_*`
  (ver `backend/.env.example`); o `APNS_BUNDLE_ID` tem que ser o mesmo
  bundle identifier do target, e builds de debug do Xcode usam
  `APNS_ENV=sandbox`.
- **Background Modes** → marque **Remote notifications**.
- **HomeKit** — se for usar `control_home_device`.

## 3. Info.plist — chaves de permissão

Adicione (Usage Description) para os frameworks usados em `PhoneActions.swift`:

- `NSRemindersUsageDescription` — "O Cosmo cria lembretes que você pede."
- `NSCalendarsUsageDescription` — "O Cosmo cria eventos que você pede."
- `NSHomeKitUsageDescription` — se for usar HomeKit.

## 4. Apontar para o backend

Edite `Networking/BackendClient.swift` e troque `baseURL` pelo endereço real
do backend (em desenvolvimento, o IP da sua máquina na rede local — não
`localhost`, que no dispositivo/simulador não aponta para o seu Mac).

## 5. O que já está implementado vs. o que falta

Implementado (esqueleto funcional, mas não testado em dispositivo real —
requer Xcode/macOS para compilar):

- Modelos e cliente HTTP para o backend (`Networking/`).
- Despachante de ações (`Intents/ActionExecutor.swift`) para
  `open_app`, `create_reminder`, `create_calendar_event`.
- App Intents básicos para Siri/Atalhos (`Intents/*Intent.swift`).
- Tela de aprovação de ações sensíveis (`Approval/`).
- Handler de push silenciosa (`Networking/PushHandler.swift`).

Faltando (próximos passos, ver `docs/ARCHITECTURE.md`):

- Login/identidade real do usuário (hoje `CurrentUser` é um placeholder fixo).
- `compose_message` de fato abrindo `MFMessageComposeViewController` a partir
  da UI do app.
- `set_volume`, `control_home_device`, `web_search` no `ActionExecutor`.
- Testes de UI e de integração ponta a ponta com o backend.
