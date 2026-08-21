import Foundation

/// Mantém o WebSocket com `backend/src/mac/relay.ts` aberto e entrega os
/// lotes de teclas ao `KeyboardInjector`.
///
/// É WebSocket (e não polling como o app iOS) porque teclado precisa de
/// latência baixa: o backend empurra o lote assim que ele chega do telefone.
final class RelayClient {
    private let config: AgentConfig
    private let identity: AgentIdentity
    private let injector: KeyboardInjector

    private let queue = DispatchQueue(label: "com.cosmo.mac-agent.relay")
    private let session = URLSession(configuration: .default)
    private let decoder = JSONDecoder()

    private let maxReconnectDelay: TimeInterval = 30
    private let keepAliveInterval: TimeInterval = 20

    private var task: URLSessionWebSocketTask?
    private var keepAliveTimer: DispatchSourceTimer?
    /// Descarta callbacks de sockets antigos depois de uma reconexão.
    private var generation = 0
    private var reconnectScheduled = false
    private var reconnectDelay: TimeInterval = 1

    init(config: AgentConfig, identity: AgentIdentity, injector: KeyboardInjector) {
        self.config = config
        self.identity = identity
        self.injector = injector
    }

    deinit {
        keepAliveTimer?.cancel()
        task?.cancel(with: .goingAway, reason: nil)
    }

    func connect() {
        queue.async { [weak self] in self?.openSocket() }
    }

    // MARK: - Conexão

    private func openSocket() {
        guard let url = config.relayURL(agentId: identity.agentId) else {
            Log.error("não consegui montar a URL do relay a partir de \(config.backendURL.absoluteString)")
            return
        }

        reconnectScheduled = false
        generation += 1
        let currentGeneration = generation

        let socket = session.webSocketTask(with: url)
        task = socket
        socket.resume()

        Log.info("conectando em \(url.absoluteString)…")
        receive(on: socket, generation: currentGeneration)
        startKeepAlive()
    }

    private func receive(on socket: URLSessionWebSocketTask, generation: Int) {
        socket.receive { [weak self] result in
            guard let self else { return }

            self.queue.async {
                // Callback de um socket que já foi substituído: ignora.
                guard generation == self.generation else { return }

                switch result {
                case .success(let message):
                    self.handle(message)
                    self.receive(on: socket, generation: generation)
                case .failure(let error):
                    self.scheduleReconnect(reason: error.localizedDescription)
                }
            }
        }
    }

    private func scheduleReconnect(reason: String) {
        guard !reconnectScheduled else { return }
        reconnectScheduled = true

        stopKeepAlive()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil

        let delay = reconnectDelay
        reconnectDelay = min(reconnectDelay * 2, maxReconnectDelay)
        Log.warn("conexão caiu (\(reason)). Tentando de novo em \(Int(delay))s…")

        queue.asyncAfter(deadline: .now() + delay) { [weak self] in self?.openSocket() }
    }

    private func startKeepAlive() {
        stopKeepAlive()

        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + keepAliveInterval, repeating: keepAliveInterval)
        timer.setEventHandler { [weak self] in
            guard let self, let socket = self.task else { return }
            socket.sendPing { [weak self] error in
                guard let self, let error else { return }
                self.queue.async {
                    self.scheduleReconnect(reason: "ping falhou: \(error.localizedDescription)")
                }
            }
        }
        timer.resume()
        keepAliveTimer = timer
    }

    private func stopKeepAlive() {
        keepAliveTimer?.cancel()
        keepAliveTimer = nil
    }

    // MARK: - Mensagens

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        // Chegou algo: a conexão está saudável de novo.
        reconnectDelay = 1

        let data: Data
        switch message {
        case .data(let payload):
            data = payload
        case .string(let text):
            data = Data(text.utf8)
        @unknown default:
            Log.warn("tipo de mensagem WebSocket não suportado")
            return
        }

        guard let relayMessage = try? decoder.decode(RelayMessage.self, from: data) else {
            Log.warn("mensagem do backend em formato inesperado — ignorando")
            return
        }

        switch relayMessage.type {
        case "registered":
            if let code = relayMessage.pairingCode {
                Log.pairingCode(code)
            } else {
                Log.info("conectado e já pareado — pode digitar do iPhone.")
            }

        case "paired":
            Log.info("iPhone pareado. O que você digitar no app cai aqui.")

        case "unpaired":
            Log.info("pareamento desfeito pelo app.")
            if let code = relayMessage.pairingCode {
                Log.pairingCode(code)
            }

        case "input":
            guard let events = relayMessage.events, !events.isEmpty else { return }
            injector.apply(events)

        default:
            Log.warn("tipo de mensagem desconhecido: \(relayMessage.type)")
        }
    }
}
