import Foundation

/// Erro devolvido pelo backend (`{ "error": ... }` com status >= 400).
struct BackendError: LocalizedError {
    let statusCode: Int
    let message: String

    var errorDescription: String? { message }
}

/// Cliente HTTP para o backend Cosmo (`backend/src/routes`).
///
/// Preencha `baseURL` com o endereço do backend (em dev, algo como
/// `http://192.168.x.x:3000` — não use `localhost`, que no simulador/aparelho
/// não aponta para a sua máquina).
struct BackendClient {
    static let shared = BackendClient(baseURL: URL(string: "http://localhost:3000")!)

    /// Header com o token de sessão devolvido no pareamento do Mac.
    /// Espelha `TOKEN_HEADER` em `backend/src/routes/mac.ts`.
    private static let macTokenHeader = "x-cosmo-mac-token"

    let baseURL: URL
    private let session = URLSession.shared
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        return decoder
    }()

    // MARK: - Comandos e ações

    func sendCommand(userId: String, deviceId: String, deviceToken: String, text: String) async throws -> CommandResponse {
        let body: [String: String] = [
            "userId": userId, "deviceId": deviceId, "deviceToken": deviceToken, "text": text,
        ]
        return try await post("/command", body: body)
    }

    func fetchNextAction(deviceId: String) async throws -> DeviceAction? {
        struct Response: Codable { let action: DeviceAction? }
        let response: Response = try await get("/device/\(deviceId)/next-action")
        return response.action
    }

    func reportResult(deviceId: String, userId: String, actionId: String, result: [String: String]?, error: String?) async throws {
        var body: [String: Any] = ["userId": userId, "actionId": actionId]
        if let result { body["result"] = result }
        if let error { body["error"] = error }
        _ = try await postRaw("/device/\(deviceId)/report", jsonBody: body)
    }

    func fetchPendingApprovals(deviceId: String) async throws -> [PendingApproval] {
        struct Response: Codable { let approvals: [PendingApproval] }
        let response: Response = try await get("/approvals/pending", query: ["deviceId": deviceId])
        return response.approvals
    }

    func decideApproval(approvalId: String, approved: Bool) async throws {
        let body = ["decision": approved ? "approved" : "denied"]
        _ = try await postRaw("/approvals/\(approvalId)/decision", jsonBody: body)
    }

    // MARK: - Teclado do Mac

    func pairMac(userId: String, code: String) async throws -> MacPairing {
        let body: [String: String] = ["userId": userId, "code": code]
        return try await post("/mac/pair", body: body)
    }

    func sendMacInput(userId: String, token: String, events: [MacInputEvent]) async throws {
        struct Body: Encodable {
            let userId: String
            let events: [MacInputEvent]
        }

        _ = try await send(
            "/mac/input",
            body: try JSONEncoder().encode(Body(userId: userId, events: events)),
            headers: [Self.macTokenHeader: token]
        )
    }

    func macStatus(userId: String) async throws -> MacStatus {
        try await get("/mac/status", query: ["userId": userId])
    }

    func unpairMac(userId: String, token: String) async throws {
        _ = try await send(
            "/mac/unpair",
            body: try JSONSerialization.data(withJSONObject: ["userId": userId]),
            headers: [Self.macTokenHeader: token]
        )
    }

    // MARK: - Helpers

    /// `appendingPathComponent` escapa o "?" e quebraria a query string —
    /// por isso os parâmetros entram por `URLComponents`.
    private func url(_ path: String, query: [String: String]) -> URL {
        let base = baseURL.appendingPathComponent(path)
        guard !query.isEmpty,
              var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        else {
            return base
        }

        components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        return components.url ?? base
    }

    private func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        var request = URLRequest(url: url(path, query: query))
        request.httpMethod = "GET"
        return try decoder.decode(T.self, from: try await perform(request))
    }

    private func post<T: Decodable, Body: Encodable>(_ path: String, body: Body) async throws -> T {
        let data = try await send(path, body: try JSONEncoder().encode(body))
        return try decoder.decode(T.self, from: data)
    }

    @discardableResult
    private func postRaw(_ path: String, jsonBody: [String: Any]) async throws -> Data {
        try await send(path, body: try JSONSerialization.data(withJSONObject: jsonBody))
    }

    private func send(_ path: String, body: Data, headers: [String: String] = [:]) async throws -> Data {
        var request = URLRequest(url: url(path, query: [:]))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (field, value) in headers {
            request.setValue(value, forHTTPHeaderField: field)
        }
        request.httpBody = body
        return try await perform(request)
    }

    /// Transforma status >= 400 em `BackendError` com a mensagem do backend,
    /// em vez de deixar o decode falhar com um erro genérico.
    private func perform(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)

        guard let http = response as? HTTPURLResponse, http.statusCode >= 400 else {
            return data
        }

        struct Envelope: Decodable { let error: String? }
        let message = (try? decoder.decode(Envelope.self, from: data))?.error
            ?? "O backend respondeu \(http.statusCode)."
        throw BackendError(statusCode: http.statusCode, message: message)
    }
}
