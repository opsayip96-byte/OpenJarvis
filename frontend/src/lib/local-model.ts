import { registerPlugin } from '@capacitor/core';

export interface LocalModelStatus {
  ready: boolean;
  sizeBytes: number;
  path: string;
  name?: string;
  sha256?: string;
  modelId?: string;
}

export interface LibraryModel extends LocalModelStatus {
  id: string;
  fileName: string;
  source?: string;
  verified?: string;
}

export interface ModelDownloadStatus {
  downloadId: number;
  status: 'queued' | 'downloading' | 'paused' | 'failed' | 'complete' | 'missing';
  bytesDownloaded: number;
  totalBytes: number;
  progress: number;
  reason?: string;
}

interface JarvisLocalModelPlugin {
  chooseModel(): Promise<LocalModelStatus>;
  getModelStatus(): Promise<LocalModelStatus>;
  removeModel(): Promise<{ ready: boolean }>;
}

interface JarvisModelLibraryPlugin {
  getDeviceStorageInfo(): Promise<{ availableStorageBytes: number; totalStorageBytes: number; physicalRamBytes: number; architecture: string }>;
  listModels(): Promise<{ models: LibraryModel[]; activeModelId?: string }>;
  listDownloads(): Promise<{ downloads: Array<{
    id: string;
    downloadId: number;
    fileName: string;
    expectedSizeBytes: number;
    status: ModelDownloadStatus['status'];
    bytesDownloaded: number;
    totalBytes: number;
    progress: number;
  }> }>;
  getActiveModel(): Promise<LocalModelStatus>;
  startDownload(options: {
    id: string;
    url: string;
    fileName: string;
    expectedSha256?: string;
    expectedSizeBytes?: number;
  }): Promise<{ downloadId: number; status: string }>;
  getDownloadStatus(options: { downloadId: number }): Promise<ModelDownloadStatus>;
  cancelDownload(options: { downloadId: number }): Promise<{ cancelled: boolean }>;
  activateModel(options: { modelId: string }): Promise<{ activeModelId: string }>;
  removeLibraryModel(options: { modelId: string }): Promise<{ removed: boolean }>;
}

export const JarvisLocalModel = registerPlugin<JarvisLocalModelPlugin>('JarvisLocalModel');
export const JarvisModelLibrary = registerPlugin<JarvisModelLibraryPlugin>('JarvisModelLibrary');

export type DeviceCapacity = Awaited<ReturnType<JarvisModelLibraryPlugin['getDeviceStorageInfo']>>;

export async function getActiveLocalModel(): Promise<LocalModelStatus> {
  try {
    const active = await JarvisModelLibrary.getActiveModel();
    if (active.ready && active.path) return active;
  } catch {
    // Older installed APKs do not expose the model library plugin.
  }
  return JarvisLocalModel.getModelStatus();
}
