export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100/api/v1';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('wms_access_token');
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });

  if (response.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('wms_access_token');
    window.location.href = '/login';
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
      code?: string;
      conflictingTripCode?: string;
      conflictType?: string;
    } | null;
    const detail = body?.conflictingTripCode
      ? `${body.code}: ${body.conflictType} đang được gán cho ${body.conflictingTripCode}`
      : Array.isArray(body?.message)
        ? body.message.join(', ')
        : body?.message;
    throw new Error(detail ?? body?.code ?? `API request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
