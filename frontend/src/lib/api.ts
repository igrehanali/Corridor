import type { PlanInput, PlanResult, Place, RulesTable } from "./types";

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("Can't reach the server. Check your connection and try again.", "network", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(e?.message ?? `Request failed (${res.status})`, e?.code ?? "http_error", res.status);
  }
  return body as T;
}

export const api = {
  plan: (input: PlanInput, signal?: AbortSignal) =>
    request<PlanResult>("/api/plan", { method: "POST", body: JSON.stringify(input), signal }),
  geocode: async (q: string, signal?: AbortSignal) =>
    (await request<{ results: Place[] }>(`/api/geocode?q=${encodeURIComponent(q)}`, { signal })).results,
  rules: () => request<RulesTable>("/api/rules"),
};
