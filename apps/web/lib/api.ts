const API_BASE = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

/**
 * Authenticated browser API request. The refresh credential is an HttpOnly
 * cookie; access tokens remain short-lived and in tab memory (sessionStorage).
 */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = typeof window !== 'undefined' ? window.sessionStorage.getItem('voxa_access_token') : null;
  if (token && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);

  const options: RequestInit = { ...init, headers, credentials: 'include' };
  const response = await fetch(url, options);
  if (response.status !== 401 || url.includes('/auth/refresh') || url.includes('/auth/login') || url.includes('/auth/register')) {
    return response;
  }

  const refreshed = await fetch(API_BASE + '/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  });
  if (!refreshed.ok) {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem('voxa_access_token');
    return response;
  }

  const data = await refreshed.json() as { accessToken?: string };
  if (!data.accessToken) return response;
  if (typeof window !== 'undefined') window.sessionStorage.setItem('voxa_access_token', data.accessToken);
  headers.set('Authorization', 'Bearer ' + data.accessToken);
  return fetch(url, { ...init, headers, credentials: 'include' });
}

export async function logoutVoxa(): Promise<void> {
  await fetch(API_BASE + '/auth/logout', { method: 'POST', credentials: 'include' });
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem('voxa_access_token');
    window.sessionStorage.removeItem('voxa_user');
  }
}
