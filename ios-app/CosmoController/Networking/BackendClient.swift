import Foundation

/// Cliente HTTP para o backend Cosmo (`backend/src/routes`).
///
/// Preencha `baseURL` com o endereço do backend (em dev, algo como
/// `http://192.168.x.x:3000` — não use `localhost`, que no simulador/aparelho
/// não aponta para a sua máquina).
struct BackendClient {
    static let shared = BackendClient(baseURL: URL(string: "http://localhost:3000")!)

    let baseURL: URL
    private let session = URLSession.shared
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        return decoder
    }()

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
        let response: Response = try await get("/approvals/pending?deviceId=\(deviceId)")
        return response.approvals
    }

    func decideApproval(approvalId: String, approved: Bool) async throws {
        let body = ["decision": approved ? "approved" : "denied"]
        _ = try await postRaw("/approvals/\(approvalId)/decision", jsonBody: body)
    }

    // MARK: - Helpers

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        let (data, _) = try await session.data(from: url)
        return try decoder.decode(T.self, from: data)
    }

    private func post<T: Decodable, Body: Encodable>(_ path: String, body: Body) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, _) = try await session.data(for: request)
        return try decoder.decode(T.self, from: data)
    }

    @discardableResult
    private func postRaw(_ path: String, jsonBody: [String: Any]) async throws -> Data {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: jsonBody)
        let (data, _) = try await session.data(for: request)
        return data
    }
}
