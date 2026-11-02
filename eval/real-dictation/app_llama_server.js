/**
 * Start the app's own llama-server manager (src/helpers/llamaServer.js: the
 * bundled binary from resources/bin, the app's flags, a per-launch key) for a
 * bench script, outside Electron.
 *
 *   const server = await startAppLlamaServer("/path/to/model.gguf");
 *   fetch(`${server.url}/v1/chat/completions`, { headers: server.headers, ... });
 *   await server.stop();
 */
const LlamaServerManager = require("../../src/helpers/llamaServer");

async function startAppLlamaServer(modelPath) {
  const manager = new LlamaServerManager();
  await manager.start(modelPath);
  return {
    url: `http://127.0.0.1:${manager.port}`,
    headers: { Authorization: `Bearer ${manager.getApiKey()}` },
    stop: () => manager.stop(),
  };
}

module.exports = { startAppLlamaServer };
