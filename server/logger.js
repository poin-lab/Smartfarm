import { randomUUID } from "node:crypto";

export function requestLogger(req, res, next) {
  const started = performance.now();
  req.id = String(req.headers["x-request-id"] || randomUUID());
  res.setHeader("X-Request-Id", req.id);
  res.on("finish", () => {
    const entry = {
      level: res.statusCode >= 500 ? "error" : "info",
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      durationMs: Math.round(performance.now() - started),
      timestamp: new Date().toISOString(),
    };
    console.log(JSON.stringify(entry));
  });
  next();
}
