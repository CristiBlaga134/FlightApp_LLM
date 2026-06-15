import { getApiBaseUrl } from "./baseUrl";

export type HealthResponse = {
  ok: boolean;
  model?: string;
  uptimeSeconds?: number;
  scraper?: {
    ready: boolean;
    checks?: {
      browserExecutableFound?: boolean;
      diagnosticsWritable?: boolean;
    };
  };
};

export async function fetchBackendHealth(): Promise<HealthResponse> {
  const baseUrl = await getApiBaseUrl();
  const response = await fetch(`${baseUrl}/health`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data?.error || "Health check failed");
  }

  return data as HealthResponse;
}
