export type Order = {
  id: string;
  created_at: string;
  intent: string;
  department: string;
  summary: string;
  source: string;
  status: string;
};
export type Analytics = {
  source: string;
  samples: number;
  aggregates: {
    cell_x: number;
    cell_y: number;
    samples: number;
    blinks: number;
  }[];
  live: { time: string; jitter: number; blinks: number }[];
};
export async function api<T>(
  endpoint: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const base = window.desktop ? 'http://127.0.0.1:8787' : '';
  const response = await fetch(`${base}/api/${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionStorage.getItem('omni-token') || ''}`,
    },
    ...(method === 'GET' || body === undefined
      ? {}
      : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Connection failed');
  return value;
}
