try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const int = (name, fallback, min, max) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
};

export const config = Object.freeze({
  env: process.env.NODE_ENV || "development",
  host: process.env.HOST || "0.0.0.0",
  port: int("PORT", 4100, 1, 65535),
  databaseUrl: process.env.DATABASE_URL,
  trustProxy: process.env.TRUST_PROXY === "true",
  sessionHours: int("SESSION_HOURS", 12, 1, 720),
});

export function assertProductionSecrets() {
  if (!config.databaseUrl)
    throw new Error(
      "DATABASE_URL is required (set it in .env, e.g. postgres://user:pass@localhost:5432/green_link).",
    );
  if (config.env !== "production") return;
  if ((process.env.LOGIN_ACCOUNT_SOURCE || "database") !== "database")
    throw new Error("Production requires LOGIN_ACCOUNT_SOURCE=database.");
  if (
    !process.env.LEDGER_SIGNING_KEY ||
    process.env.LEDGER_SIGNING_KEY.length < 32
  ) {
    throw new Error(
      "Production requires LEDGER_SIGNING_KEY with at least 32 characters.",
    );
  }
}
