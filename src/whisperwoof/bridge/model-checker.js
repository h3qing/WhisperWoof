/**
 * Model Checker Bridge — IPC-facing module for local model recommendations.
 *
 * Combines system profiling + model recommendation + Ollama status into
 * a single check the renderer can call to show the user their best option.
 */

const os = require("os");
const { execFile } = require("child_process");
const debugLogger = require("../../helpers/debugLogger");

// ---------------------------------------------------------------------------
// Model catalog (mirrors core/hardware/model-recommender.ts for JS runtime)
// ---------------------------------------------------------------------------

const MODEL_CATALOG = [
  {
    id: "llama3.1:8b",
    name: "Llama 3.1 8B",
    paramsBillion: 8,
    requiredMb: 5500,
    qualityTier: 5,
    description: "Best quality for text polish. Excellent grammar and style.",
  },
  {
    id: "mistral:7b",
    name: "Mistral 7B",
    paramsBillion: 7,
    requiredMb: 5000,
    qualityTier: 4,
    description: "Strong all-around model. Good at following instructions.",
  },
  {
    id: "llama3.2:3b",
    name: "Llama 3.2 3B",
    paramsBillion: 3,
    requiredMb: 2500,
    qualityTier: 3,
    description: "Good balance of quality and speed. Solid for everyday polish.",
  },
  {
    id: "gemma2:2b",
    name: "Gemma 2 2B",
    paramsBillion: 2,
    requiredMb: 1800,
    qualityTier: 2,
    description: "Lightweight and fast. Decent grammar correction.",
  },
  {
    id: "llama3.2:1b",
    name: "Llama 3.2 1B",
    paramsBillion: 1,
    requiredMb: 1200,
    qualityTier: 1,
    description: "Smallest option. Basic cleanup, very fast.",
  },
];

// ---------------------------------------------------------------------------
// System profiling (best-effort, all failures return safe defaults)
// ---------------------------------------------------------------------------

function detectNvidiaGpu() {
  if (os.platform() === "darwin") return Promise.resolve(null);

  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
      { timeout: 5000 },
      (error, stdout) => {
        if (error || !stdout) {
          resolve(null);
          return;
        }
        const parts = stdout.trim().split(",").map((s) => s.trim());
        if (parts.length < 2) {
          resolve(null);
          return;
        }
        resolve({
          name: parts[0],
          vramMb: parseInt(parts[1], 10) || null,
          vendor: "nvidia",
        });
      }
    );
  });
}

function detectAppleSilicon() {
  if (os.platform() !== "darwin") return null;
  const cpuModel = os.cpus()[0]?.model ?? "";
  if (cpuModel.includes("Apple M") || os.arch() === "arm64") {
    return {
      name: cpuModel || "Apple Silicon",
      vramMb: null,
      vendor: "apple-silicon",
    };
  }
  return null;
}

async function getSystemProfile() {
  const ramMb = Math.round(os.totalmem() / (1024 * 1024));
  const cpus = os.cpus();
  const cpuCores = cpus.length;
  const cpuModel = cpus[0]?.model?.trim() ?? "Unknown CPU";
  const arch = os.arch();
  const platform = os.platform();

  const appleSilicon = detectAppleSilicon();
  let gpu;

  if (appleSilicon) {
    gpu = appleSilicon;
  } else {
    const nvidia = await detectNvidiaGpu();
    gpu = nvidia ?? { name: "Integrated / Unknown", vramMb: null, vendor: "unknown" };
  }

  const isAppleSilicon = gpu.vendor === "apple-silicon";
  const osOverheadMb = 2048;
  const availableRamMb = Math.max(0, ramMb - osOverheadMb);

  return { ramMb, cpuCores, cpuModel, arch, platform, gpu, availableRamMb, isAppleSilicon };
}

// ---------------------------------------------------------------------------
// Recommendation logic
// ---------------------------------------------------------------------------

function getMemoryBudgetMb(profile) {
  if (profile.isAppleSilicon) {
    return Math.round(profile.availableRamMb * 0.75);
  }
  if (profile.gpu.vramMb != null && profile.gpu.vramMb > 0) {
    return Math.min(profile.gpu.vramMb, profile.availableRamMb);
  }
  return Math.round(profile.availableRamMb * 0.6);
}

function findModelById(id) {
  const normalized = (id || "").replace(/:latest$/, "");
  return MODEL_CATALOG.find((m) => m.id === normalized) ?? null;
}

function recommend(profile, currentModelId, installedModels = []) {
  const memoryBudgetMb = getMemoryBudgetMb(profile);
  const runnable = MODEL_CATALOG.filter((m) => m.requiredMb <= memoryBudgetMb);
  const recommended = runnable.length > 0 ? runnable[0] : MODEL_CATALOG[MODEL_CATALOG.length - 1];
  const current = currentModelId ? findModelById(currentModelId) : null;

  let canUpgrade = false;
  let upgradeReason = null;

  if (current === null && currentModelId) {
    canUpgrade = recommended.qualityTier >= 3;
    if (canUpgrade) {
      upgradeReason = `Your hardware can run ${recommended.name}, which is optimized for text polish.`;
    }
  } else if (current === null) {
    canUpgrade = true;
    upgradeReason = `Your hardware can run ${recommended.name} for high-quality text polish.`;
  } else if (recommended.qualityTier > current.qualityTier) {
    canUpgrade = true;
    const qualityGain = recommended.qualityTier - current.qualityTier;
    if (qualityGain >= 2) {
      upgradeReason =
        `You're using ${current.name} but your hardware can handle ${recommended.name} ` +
        `for significantly better polish quality.`;
    } else {
      upgradeReason = `Your hardware can run ${recommended.name} for better quality than ${current.name}.`;
    }
  }

  const recommendedInstalled = installedModels.some((m) => {
    const normalized = m.replace(/:latest$/, "");
    return normalized === recommended.id;
  });

  if (canUpgrade && !recommendedInstalled && upgradeReason) {
    upgradeReason += " You'll need to pull it first: ollama pull " + recommended.id;
  }

  return { recommended, current, canUpgrade, upgradeReason, runnable, memoryBudgetMb };
}

// ---------------------------------------------------------------------------
// Public API (called from IPC handler)
// ---------------------------------------------------------------------------

/**
 * Run full model check: profile hardware, check Ollama, return recommendation.
 *
 * @param {string|null} currentModelId - The user's currently configured model
 * @returns {Promise<object>} Full check result for the renderer
 */
async function checkLocalModel(currentModelId) {
  try {
    const profile = await getSystemProfile();

    // Check Ollama for installed models
    let installedModels = [];
    let ollamaAvailable = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch("http://localhost:11434/api/tags", {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (resp.ok) {
        const data = await resp.json();
        ollamaAvailable = true;
        installedModels = (data.models || [])
          .map((m) => m.name)
          .filter((n) => typeof n === "string");
      }
    } catch {
      // Ollama not running — that's OK
    }

    const recommendation = recommend(profile, currentModelId, installedModels);

    debugLogger.info("[WhisperWoof] Model check completed", {
      ram: profile.ramMb,
      gpu: profile.gpu.name,
      budget: recommendation.memoryBudgetMb,
      recommended: recommendation.recommended.id,
      current: currentModelId,
      canUpgrade: recommendation.canUpgrade,
    });

    return {
      success: true,
      profile: {
        ramMb: profile.ramMb,
        ramGb: +(profile.ramMb / 1024).toFixed(1),
        cpuCores: profile.cpuCores,
        cpuModel: profile.cpuModel,
        gpu: profile.gpu,
        isAppleSilicon: profile.isAppleSilicon,
      },
      recommendation: {
        recommended: recommendation.recommended,
        current: recommendation.current,
        canUpgrade: recommendation.canUpgrade,
        upgradeReason: recommendation.upgradeReason,
        runnable: recommendation.runnable,
        memoryBudgetMb: recommendation.memoryBudgetMb,
      },
      ollamaAvailable,
      installedModels,
    };
  } catch (error) {
    debugLogger.warn("[WhisperWoof] Model check failed", { error: error.message });
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  checkLocalModel,
  getSystemProfile,
  recommend,
  MODEL_CATALOG,
};
