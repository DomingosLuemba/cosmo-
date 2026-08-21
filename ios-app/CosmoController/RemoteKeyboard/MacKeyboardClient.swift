import Foundation

/// Estado do teclado remoto: pareamento com o Mac e envio das teclas.
///
/// As teclas saem em lote (`POST /mac/input`) em vez de uma requisição por
/// tecla: digitação rápida vira um punhado de eventos numa chamada só.
@MainActor
final class MacKeyboardClient: ObservableObject {
    static let shared = MacKeyboardClient()

    @Published private(set) var pairing: MacPairing?
    @Published private(set) var isOnline = false
    @Published private(set) var statusMessage = ""

    /// Teto por lote — precisa bater com `MAX_EVENTS_PER_BATCH` em
    /// `backend/src/routes/mac.ts`.
    private let maxBatch = 64
    /// Teto de caracteres ao juntar textos (o backend corta em 500).
    private let maxMergedText = 400
    /// Janela de agrupamento. Curta o bastante para não dar sensação de lag.
    private let flushDelay: Duration = .milliseconds(30)

    private var buffer: [MacInputEvent] = []
    private var flushTask: Task<Void, Never>?

    private let storageKey = "cosmo.mac.pairing"

    var isPaired: Bool { pairing != nil }

    private init() {
        pairing = loadPairing()
    }

    // MARK: - Pareamento

    func pair(code: String) async {
        let digits = code.filter(\.isNumber)
        guard digits.count == 6 else {
            statusMessage = "O código tem 6 dígitos."
            return
        }

        do {
            let result = try await BackendClient.shared.pairMac(userId: CurrentUser.id, code: digits)
            pairing = result
            savePairing(result)
            isOnline = true
            statusMessage = "Pareado com \(result.agentName)."
        } catch {
            statusMessage = "Não consegui parear: \(error.localizedDescription)"
        }
    }

    func unpair() async {
        guard let pairing else { return }

        // Mesmo se o backend recusar, some com o pareamento local: o usuário
        // pediu para desconectar.
        try? await BackendClient.shared.unpairMac(userId: CurrentUser.id, token: pairing.token)

        self.pairing = nil
        savePairing(nil)
        isOnline = false
        statusMessage = "Desconectado do Mac."
    }

    func refreshStatus() async {
        guard pairing != nil else { return }

        do {
            let status = try await BackendClient.shared.macStatus(userId: CurrentUser.id)
            isOnline = status.online
            if !status.paired {
                // O backend reiniciou e perdeu o pareamento (registro em memória).
                pairing = nil
                savePairing(nil)
                statusMessage = "O backend perdeu o pareamento. Pareie de novo."
            } else if !status.online {
                statusMessage = "\(status.agentName ?? "O Mac") está offline. Rode o agente lá."
            } else {
                statusMessage = "Conectado a \(status.agentName ?? "seu Mac")."
            }
        } catch {
            statusMessage = "Não consegui falar com o backend: \(error.localizedDescription)"
        }
    }

    // MARK: - Envio de teclas

    func send(_ event: MacInputEvent) {
        guard isPaired else { return }

        append(event)

        if buffer.count >= maxBatch {
            flushTask?.cancel()
            flushTask = Task { [weak self] in await self?.flush() }
        } else {
            scheduleFlush()
        }
    }

    func typeText(_ text: String) {
        send(.text(text))
    }

    func pressKey(_ key: String, modifiers: [MacModifier] = []) {
        send(.key(key, modifiers))
    }

    private func append(_ event: MacInputEvent) {
        // Digitação corrida vira um evento só: 10 letras seguidas saem como
        // um texto, não como 10 eventos.
        if case .text(let incoming) = event,
           case .text(let existing)? = buffer.last,
           existing.count + incoming.count <= maxMergedText {
            buffer[buffer.count - 1] = .text(existing + incoming)
            return
        }
        buffer.append(event)
    }

    private func scheduleFlush() {
        flushTask?.cancel()
        let delay = flushDelay
        flushTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await self?.flush()
        }
    }

    private func flush() async {
        guard let pairing, !buffer.isEmpty else { return }

        let batch = buffer
        // Esvazia antes de enviar: se falhar, as teclas são descartadas de
        // propósito. Reenviar tecla velha depois de reconectar é pior —
        // ela cairia no app que estiver em foco naquele momento.
        buffer.removeAll()

        do {
            try await BackendClient.shared.sendMacInput(
                userId: CurrentUser.id,
                token: pairing.token,
                events: batch
            )
            if !isOnline {
                isOnline = true
                statusMessage = "Conectado a \(pairing.agentName)."
            }
        } catch {
            isOnline = false
            statusMessage = "Tecla não chegou: \(error.localizedDescription)"
        }
    }

    // MARK: - Persistência

    // TODO: o token é credencial — mover para o Keychain junto com o login
    // real do usuário (hoje `CurrentUser` é um placeholder fixo).
    private func loadPairing() -> MacPairing? {
        guard let data = UserDefaults.standard.data(forKey: storageKey) else { return nil }
        return try? JSONDecoder().decode(MacPairing.self, from: data)
    }

    private func savePairing(_ pairing: MacPairing?) {
        guard let pairing, let data = try? JSONEncoder().encode(pairing) else {
            UserDefaults.standard.removeObject(forKey: storageKey)
            return
        }
        UserDefaults.standard.set(data, forKey: storageKey)
    }
}
