import Foundation

/// Configuração vinda de variável de ambiente ou argumento de linha de comando.
struct AgentConfig {
    let backendURL: URL
    let agentName: String

    static let defaultBackend = "http://localhost:3000"

    static func load(arguments: [String] = CommandLine.arguments) -> AgentConfig? {
        var backend = ProcessInfo.processInfo.environment["COSMO_BACKEND_URL"] ?? defaultBackend
        var name = ProcessInfo.processInfo.environment["COSMO_AGENT_NAME"] ?? Self.defaultName

        var index = 1
        while index < arguments.count {
            let argument = arguments[index]
            switch argument {
            case "--backend":
                guard index + 1 < arguments.count else {
                    Log.error("--backend precisa de uma URL, ex: --backend http://192.168.0.10:3000")
                    return nil
                }
                backend = arguments[index + 1]
                index += 2
            case "--name":
                guard index + 1 < arguments.count else {
                    Log.error("--name precisa de um valor.")
                    return nil
                }
                name = arguments[index + 1]
                index += 2
            case "--help", "-h":
                print(usage)
                return nil
            default:
                Log.error("argumento desconhecido: \(argument)\n\n\(usage)")
                return nil
            }
        }

        guard let url = URL(string: backend), url.host != nil else {
            Log.error("URL de backend inválida: \(backend)")
            return nil
        }

        return AgentConfig(backendURL: url, agentName: name)
    }

    /// Mesma origem do backend, trocando http→ws (o relay divide a porta com
    /// a API HTTP — ver `backend/src/index.ts`).
    func relayURL(agentId: String) -> URL? {
        guard var components = URLComponents(url: backendURL, resolvingAgainstBaseURL: false) else {
            return nil
        }

        components.scheme = backendURL.scheme == "https" ? "wss" : "ws"
        components.path = "/mac/agent"
        components.queryItems = [
            URLQueryItem(name: "agentId", value: agentId),
            URLQueryItem(name: "name", value: agentName),
        ]
        return components.url
    }

    private static var defaultName: String {
        Host.current().localizedName ?? ProcessInfo.processInfo.hostName
    }

    static let usage = """
    cosmo-mac-agent — deixa o iPhone digitar neste Mac.

    Uso:
      swift run cosmo-mac-agent [--backend <url>] [--name <nome>]

    Opções:
      --backend <url>   Endereço do backend Cosmo. Padrão: \(defaultBackend)
                        (também aceita a variável COSMO_BACKEND_URL)
      --name <nome>     Nome deste Mac no app. Padrão: o nome do computador.
      --help            Mostra esta ajuda.
    """
}
