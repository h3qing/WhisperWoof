/**
 * SystemProfiler — Detect hardware capabilities for model recommendations.
 *
 * Gathers RAM, CPU, and GPU info so we can recommend the best local LLM
 * the user's machine can comfortably run.
 *
 * All detection is best-effort — failures return safe defaults (unknown).
 */

import * as os from 'os';
import { execFile } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GpuInfo {
  readonly name: string;
  readonly vramMb: number | null;
  /** 'nvidia' | 'apple-silicon' | 'amd' | 'intel' | 'unknown' */
  readonly vendor: string;
}

export interface SystemProfile {
  readonly ramMb: number;
  readonly cpuCores: number;
  readonly cpuModel: string;
  readonly arch: string;
  readonly platform: string;
  readonly gpu: GpuInfo;
  /** Estimated available RAM for model loading (total minus ~2 GB OS overhead) */
  readonly availableRamMb: number;
  /** True if Apple Silicon (M1/M2/M3/M4) — uses unified memory for GPU */
  readonly isAppleSilicon: boolean;
}

// ---------------------------------------------------------------------------
// GPU detection helpers
// ---------------------------------------------------------------------------

function detectNvidiaGpu(): Promise<GpuInfo | null> {
  if (os.platform() === 'darwin') return Promise.resolve(null);

  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 5000 },
      (error, stdout) => {
        if (error || !stdout) {
          resolve(null);
          return;
        }
        const parts = stdout.trim().split(',').map((s) => s.trim());
        if (parts.length < 2) {
          resolve(null);
          return;
        }
        resolve({
          name: parts[0],
          vramMb: parseInt(parts[1], 10) || null,
          vendor: 'nvidia',
        });
      },
    );
  });
}

function detectAppleSilicon(): GpuInfo | null {
  if (os.platform() !== 'darwin') return null;

  const cpuModel = os.cpus()[0]?.model ?? '';
  // Apple Silicon reports as "Apple M1", "Apple M2 Pro", etc.
  if (cpuModel.includes('Apple M') || os.arch() === 'arm64') {
    return {
      name: cpuModel || 'Apple Silicon',
      vramMb: null, // Unified memory — use total RAM instead
      vendor: 'apple-silicon',
    };
  }
  return null;
}

function detectAmdGpuLinux(): Promise<GpuInfo | null> {
  if (os.platform() !== 'linux') return Promise.resolve(null);

  return new Promise((resolve) => {
    execFile(
      'rocm-smi',
      ['--showproductname', '--showmeminfo', 'vram', '--csv'],
      { timeout: 5000 },
      (error, stdout) => {
        if (error || !stdout) {
          resolve(null);
          return;
        }
        // Best-effort parse — rocm-smi output varies by version
        const nameMatch = stdout.match(/card\d+,\s*(.+)/i);
        const vramMatch = stdout.match(/(\d+)\s*(?:MiB|MB)/i);
        resolve({
          name: nameMatch?.[1]?.trim() ?? 'AMD GPU',
          vramMb: vramMatch ? parseInt(vramMatch[1], 10) : null,
          vendor: 'amd',
        });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getSystemProfile(): Promise<Readonly<SystemProfile>> {
  const ramMb = Math.round(os.totalmem() / (1024 * 1024));
  const cpus = os.cpus();
  const cpuCores = cpus.length;
  const cpuModel = cpus[0]?.model?.trim() ?? 'Unknown CPU';
  const arch = os.arch();
  const platform = os.platform();

  // Detect GPU — try each method in priority order
  const appleSilicon = detectAppleSilicon();
  let gpu: GpuInfo;

  if (appleSilicon) {
    gpu = appleSilicon;
  } else {
    const nvidia = await detectNvidiaGpu();
    if (nvidia) {
      gpu = nvidia;
    } else {
      const amd = await detectAmdGpuLinux();
      gpu = amd ?? { name: 'Integrated / Unknown', vramMb: null, vendor: 'unknown' };
    }
  }

  const isAppleSilicon = gpu.vendor === 'apple-silicon';

  // Reserve ~2 GB for OS + Electron + other apps
  const osOverheadMb = 2048;
  const availableRamMb = Math.max(0, ramMb - osOverheadMb);

  return Object.freeze({
    ramMb,
    cpuCores,
    cpuModel,
    arch,
    platform,
    gpu,
    availableRamMb,
    isAppleSilicon,
  });
}
