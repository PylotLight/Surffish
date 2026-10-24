export const SURFFISH_NETWORK_HELPER = {
  name: "Surffish Network Helper",
  host: "127.0.0.1",
  port: 1088,
} as const;

export interface NetworkHelperStatus {
  name: string;
  host: string;
  port: number;
  listening: boolean;
  error: string | null;
}

export interface NetworkHelperUsage {
  activeConnections: number;
  uploadedBytes: number;
  downloadedBytes: number;
  uploadBytesPerSecond: number;
  downloadBytesPerSecond: number;
}
