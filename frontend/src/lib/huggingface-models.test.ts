import { describe, expect, it } from 'vitest';
import {
  estimateAndroidModelFit,
  parseQwenGgufFiles,
  type DeviceProfile,
} from './huggingface-models';

const device: DeviceProfile = {
  physicalRamBytes: 8 * 1024 ** 3,
  availableStorageBytes: 100 * 1024 ** 3,
  architecture: 'arm64',
};

describe('parseQwenGgufFiles', () => {
  it('extracts quantization, size and SHA-256 from GGUF siblings', () => {
    const models = parseQwenGgufFiles('Qwen/Qwen3-1.7B-GGUF', [
      { rfilename: 'Qwen3-1.7B-Q4_K_M.gguf', size: 1_100_000_000, lfs: { oid: 'a'.repeat(64) } },
      { rfilename: 'README.md', size: 100 },
    ], 'abc123');
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      repoId: 'Qwen/Qwen3-1.7B-GGUF',
      quantization: 'Q4_K_M',
      sizeBytes: 1_100_000_000,
      sha256: 'a'.repeat(64),
      revision: 'abc123',
    });
    expect(models[0].downloadUrl).toContain('Qwen3-1.7B-Q4_K_M.gguf');
  });

  it('ignores non-Qwen repositories and non-GGUF files', () => {
    expect(parseQwenGgufFiles('someone/llama-GGUF', [{ rfilename: 'model.Q4_K_M.gguf' }])).toEqual([]);
    expect(parseQwenGgufFiles('Qwen/Qwen3-GGUF', [{ rfilename: 'README.md' }])).toEqual([]);
  });

  it('keeps unknown file size and checksum unknown', () => {
    const [model] = parseQwenGgufFiles('Qwen/Qwen2.5-GGUF', [{ rfilename: 'qwen-Q5_K_M.gguf' }]);
    expect(model.sizeBytes).toBeNull();
    expect(model.sha256).toBeNull();
    expect(model.quantization).toBe('Q5_K_M');
  });
});

describe('estimateAndroidModelFit', () => {
  it('recommends a small quantized model on an 8 GB device', () => {
    const [model] = parseQwenGgufFiles('Qwen/Qwen3-1.7B-GGUF', [
      { rfilename: 'Qwen3-1.7B-Q4_K_M.gguf', size: 1_100_000_000 },
    ]);
    expect(estimateAndroidModelFit(model, device).level).toBe('recommended');
  });

  it('does not recommend a large model that leaves insufficient RAM', () => {
    const [model] = parseQwenGgufFiles('Qwen/Qwen3-14B-GGUF', [
      { rfilename: 'Qwen3-14B-Q4_K_M.gguf', size: 9_000_000_000 },
    ]);
    expect(estimateAndroidModelFit(model, device).level).toBe('not-recommended');
  });

  it('warns when metadata does not include a file size', () => {
    const [model] = parseQwenGgufFiles('Qwen/Qwen3-GGUF', [
      { rfilename: 'Qwen3-Q4_K_M.gguf' },
    ]);
    expect(estimateAndroidModelFit(model, device).level).toBe('unknown');
  });
});
