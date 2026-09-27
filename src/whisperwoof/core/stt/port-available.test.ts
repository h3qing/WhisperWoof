/**
 * isPortAvailable (utils/serverUtils.js) picks the port a sherpa-onnx,
 * whisper or llama server starts on. sherpa-onnx listens on all interfaces,
 * and on macOS a test listen on 127.0.0.1 alone still succeeds then, so a
 * second server started on that port and died ("Address already in use").
 */
import net from "net";
import { createRequire } from "module";
import { describe, it, expect, afterEach } from "vitest";

const require = createRequire(import.meta.url);
const { isPortAvailable, findAvailablePort } = require("../../../utils/serverUtils");

const held: net.Server[] = [];
function hold(port: number, host: string) {
  return new Promise<void>((resolve) => {
    const server = net.createServer();
    held.push(server);
    server.listen(port, host, () => resolve());
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", () => resolve()));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe("isPortAvailable", () => {
  afterEach(async () => {
    await Promise.all(held.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
  });

  it("sees a server on all interfaces (like sherpa-onnx)", async () => {
    const port = await freePort();
    await hold(port, "0.0.0.0");
    expect(await isPortAvailable(port)).toBe(false);
  });

  it("sees a server on 127.0.0.1 only (like whisper-server)", async () => {
    const port = await freePort();
    await hold(port, "127.0.0.1");
    expect(await isPortAvailable(port)).toBe(false);
  });

  it("finds the next port when the first is taken", async () => {
    const port = await freePort();
    await hold(port, "0.0.0.0");
    const next = await findAvailablePort(port, port + 20);
    expect(next).toBeGreaterThan(port);
  });
});
