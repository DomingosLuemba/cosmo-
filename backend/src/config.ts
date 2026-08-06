import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ausente: ${name}. Veja .env.example.`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  get anthropicApiKey(): string {
    return requireEnv("ANTHROPIC_API_KEY");
  },
};
