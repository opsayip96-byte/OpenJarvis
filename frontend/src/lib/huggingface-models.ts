export interface HuggingFaceSibling {
  rfilename: string;
  size?: number;
  lfs?: { size?: number; oid?: string };
}

export interface DiscoveredGgufModel {
  id: string;
  repoId: string;
  fileName: string;
  quantization: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  revision: string;
  downloadUrl: string;
  license: string | null;
}

export interface DeviceProfile {
  physicalRamBytes: number;
  availableStorageBytes: number;
  architecture: string;
}

export interface ModelFit {
  level: 'recommended' | 'possible' | 'not-recommended' | 'unknown';
  estimatedRuntimeRamBytes: number | null;
  requiredStorageBytes: number | null;
  reason: string;
}

interface HubModel {
  id?: string;
  sha?: string;
  siblings?: HuggingFaceSibling[];
  cardData?: { license?: string };
}

const HUB = 'https://huggingface.co';
const MAX_REPOSITORIES = 24;
const DETAIL_CONCURRENCY = 4;
const STORAGE_RESERVE_BYTES = 512 * 1024 ** 2;

function parseQuantization(fileName: string): string | null {
  const match = fileName.match(/(?:^|[-_.])(IQ\d_[A-Z0-9_]+|Q\d(?:_[A-Z0-9]+)+|F16|F32|BF16)(?=\.|$)/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function validSha256(value?: string): string | null {
  const normalized = value?.replace(/^sha256:/i, '');
  return normalized && /^[a-f0-9]{64}$/i.test(normalized) ? normalized.toLowerCase() : null;
}

export function parseQwenGgufFiles(
  repoId: string,
  siblings: HuggingFaceSibling[],
  revision = 'main',
  license: string | null = null,
): DiscoveredGgufModel[] {
  if (!/^qwen\//i.test(repoId) && !/qwen/i.test(repoId)) return [];
  return siblings
    .filter((file) => typeof file.rfilename === 'string' && file.rfilename.toLowerCase().endsWith('.gguf'))
    .map((file) => {
      const fileName = file.rfilename;
      const size = typeof file.lfs?.size === 'number' ? file.lfs.size : file.size;
      const digest = validSha256(file.lfs?.oid);
      const encodedPath = fileName.split('/').map(encodeURIComponent).join('/');
      return {
        id: `${repoId}@${revision}/${fileName}`,
        repoId,
        fileName,
        quantization: parseQuantization(fileName),
        sizeBytes: typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : null,
        sha256: digest,
        revision,
        downloadUrl: `${HUB}/${repoId}/resolve/${encodeURIComponent(revision)}/${encodedPath}?download=true`,
        license,
      };
    });
}

export function estimateAndroidModelFit(
  model: DiscoveredGgufModel,
  device: DeviceProfile,
): ModelFit {
  if (!model.sizeBytes || !Number.isFinite(device.physicalRamBytes) || device.physicalRamBytes <= 0) {
    return {
      level: 'unknown',
      estimatedRuntimeRamBytes: null,
      requiredStorageBytes: null,
      reason: 'The model file size or device memory information is unavailable.',
    };
  }

  // Conservative allowance for mapped weights, runtime overhead and context/KV cache.
  const estimatedRuntimeRamBytes = Math.ceil(model.sizeBytes * 1.65 + 900 * 1024 ** 2);
  const requiredStorageBytes = Math.ceil(model.sizeBytes * 1.15 + STORAGE_RESERVE_BYTES);
  const ramBudget = device.physicalRamBytes * 0.62;

  if (estimatedRuntimeRamBytes > ramBudget) {
    return {
      level: 'not-recommended',
      estimatedRuntimeRamBytes,
      requiredStorageBytes,
      reason: 'Estimated runtime memory exceeds the conservative memory budget for this device.',
    };
  }
  if (device.availableStorageBytes < requiredStorageBytes) {
    return {
      level: 'not-recommended',
      estimatedRuntimeRamBytes,
      requiredStorageBytes,
      reason: 'There is not enough free storage for the model and a safety reserve.',
    };
  }
  const smallQuantized = model.quantization?.startsWith('Q4') || model.quantization?.startsWith('IQ4');
  return {
    level: smallQuantized && estimatedRuntimeRamBytes <= device.physicalRamBytes * 0.45
      ? 'recommended'
      : 'possible',
    estimatedRuntimeRamBytes,
    requiredStorageBytes,
    reason: 'Estimate only. Actual memory use depends on architecture, context length and runtime settings.',
  };
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`Hugging Face request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

export async function searchQwenGgufModels(
  query = 'Qwen',
  signal?: AbortSignal,
): Promise<DiscoveredGgufModel[]> {
  const params = new URLSearchParams({
    search: query.trim() || 'Qwen',
    filter: 'gguf',
    sort: 'downloads',
    direction: '-1',
    limit: String(MAX_REPOSITORIES),
    full: 'true',
  });
  const found = await fetchJson<HubModel[]>(`${HUB}/api/models?${params.toString()}`, signal);
  const repos = (Array.isArray(found) ? found : [])
    .filter((item) => typeof item.id === 'string' && /qwen/i.test(item.id))
    .slice(0, MAX_REPOSITORIES);

  const results: DiscoveredGgufModel[] = [];
  for (let offset = 0; offset < repos.length; offset += DETAIL_CONCURRENCY) {
    const group = repos.slice(offset, offset + DETAIL_CONCURRENCY);
    const details = await Promise.all(group.map(async (repo) => {
      if (repo.siblings?.length) return repo;
      try {
        return await fetchJson<HubModel>(
          `${HUB}/api/models/${repo.id}?blobs=true`,
          signal,
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        return repo;
      }
    }));
    for (const detail of details) {
      if (!detail.id || !detail.siblings) continue;
      results.push(...parseQwenGgufFiles(
        detail.id,
        detail.siblings,
        detail.sha || 'main',
        detail.cardData?.license ?? null,
      ));
    }
  }
  return results.sort((a, b) => {
    const aSize = a.sizeBytes ?? Number.MAX_SAFE_INTEGER;
    const bSize = b.sizeBytes ?? Number.MAX_SAFE_INTEGER;
    return aSize - bSize;
  });
}
