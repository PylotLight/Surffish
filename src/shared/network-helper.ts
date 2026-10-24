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
