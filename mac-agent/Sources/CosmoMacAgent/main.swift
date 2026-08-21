import Foundation

guard let config = AgentConfig.load() else {
    exit(1)
}

print("""

Cosmo — agente de teclado do Mac
Backend: \(config.backendURL.absoluteString)
Este Mac: \(config.agentName)
""")

guard AccessibilityPermission.request() else {
    Log.error("permissão de Acessibilidade não concedida.\n\n\(AccessibilityPermission.instructions)")
    exit(1)
}

let identity = AgentIdentity.loadOrCreate()
let injector = KeyboardInjector()
let client = RelayClient(config: config, identity: identity, injector: injector)

client.connect()

// Ctrl-C encerra: sem o agente rodando, nada do telefone chega ao Mac.
Log.info("rodando. Ctrl-C para parar e cortar o acesso do telefone.")
dispatchMain()
