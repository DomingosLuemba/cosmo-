import Foundation

/// Identidade estável do agente entre execuções.
///
/// O backend usa esse id para lembrar o pareamento: reiniciar o agente não
/// obriga a digitar o código de novo. (Reiniciar o *backend* obriga, porque
/// o registro dele é em memória — ver `backend/src/mac/macRegistry.ts`.)
struct AgentIdentity: Codable {
    let agentId: String

    private static var fileURL: URL {
        FileManager.default
            .homeDirectoryForCurrentUser
            .appendingPathComponent(".cosmo", isDirectory: true)
            .appendingPathComponent("mac-agent.json")
    }

    static func loadOrCreate() -> AgentIdentity {
        let url = fileURL

        if let data = try? Data(contentsOf: url),
           let identity = try? JSONDecoder().decode(AgentIdentity.self, from: data) {
            return identity
        }

        let identity = AgentIdentity(agentId: UUID().uuidString)
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let data = try JSONEncoder().encode(identity)
            try data.write(to: url, options: .atomic)
            // Só o dono lê: o agentId é o que identifica este Mac no relay.
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: url.path
            )
        } catch {
            Log.warn("não consegui salvar a identidade em \(url.path): \(error.localizedDescription)")
            Log.warn("o pareamento vai ser pedido de novo na próxima execução.")
        }
        return identity
    }
}
