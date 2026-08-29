import { spawn } from "node:child_process";

const port = process.env.PORT || "4100";
const serverUrl = `http://localhost:${port}`;
const env = {
  ...process.env,
  HOST: "0.0.0.0",
  PORT: port,
  NODE_ENV: process.env.NODE_ENV || "development",
  GREEN_LINK_PUBLIC_MODE: "true",
};
const children = new Set();
let publicUrl = "";

const command = (name) => (process.platform === "win32" ? `${name}.cmd` : name);
const spawnChild = (cmd, args, options = {}) => {
  const child = spawn(cmd, args, {
    env,
    cwd: process.cwd(),
    windowsHide: false,
    ...options,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
};
const shutdown = (code = 0) => {
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 250);
};
const serverReady = async () => {
  try {
    const response = await fetch(`${serverUrl}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
};
const waitForServer = async () => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if (await serverReady()) return;
    } catch {
      // The app may still be booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`GREEN LINK server did not become ready at ${serverUrl}`);
};
const pipeOutput = (stream, prefix = "") => {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    process.stdout.write(prefix + chunk);
    const match = chunk.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i);
    if (match && match[0] !== publicUrl) {
      publicUrl = match[0];
      console.log("");
      console.log("PUBLIC URL for any network:");
      console.log(`  ${publicUrl}`);
      console.log("Share this HTTPS address while this window stays open.");
      console.log("");
    }
  });
};

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (await serverReady()) {
  console.log(`GREEN LINK is already running at ${serverUrl}.`);
} else {
  console.log("Starting GREEN LINK local server...");
  const server = spawnChild("node", ["scripts/start-lan.js"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeOutput(server.stdout, "");
  pipeOutput(server.stderr, "");
  server.once("exit", (code) => {
    if (children.size) shutdown(code || 1);
  });
}

try {
  await waitForServer();
} catch (error) {
  console.error(error.message);
  shutdown(1);
}

console.log("Opening a Cloudflare public HTTPS tunnel...");
console.log("The public URL will look like https://example.trycloudflare.com");
const tunnel = spawnChild(
  command("npx"),
  ["--yes", "cloudflared", "tunnel", "--url", serverUrl],
  process.platform === "win32" ? { shell: true } : {},
);
pipeOutput(tunnel.stdout, "");
pipeOutput(tunnel.stderr, "");
tunnel.once("exit", (code) => {
  if (code) console.error(`Cloudflare tunnel exited with code ${code}.`);
  shutdown(code || 0);
});
