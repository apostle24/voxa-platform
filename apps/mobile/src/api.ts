import * as SecureStore from 'expo-secure-store';

const API = (process.env.EXPO_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');
let refreshInFlight: Promise<boolean> | null = null;

type AuthPayload = { accessToken: string; refreshToken: string; user: User };
export type User = { id: string; email: string; displayName: string; role: string };
export type ApiRecord = { id: string; title?: string; name?: string; description?: string; artworkUrl?: string; coverImageUrl?: string; creator?: any; show?: any; status?: string; slug?: string; memberCount?: number; category?: string; [key: string]: any };

export async function saveSession(data: AuthPayload) {
  await SecureStore.setItemAsync('voxa_access_token', data.accessToken);
  await SecureStore.setItemAsync('voxa_refresh_token', data.refreshToken);
  await SecureStore.setItemAsync('voxa_user', JSON.stringify(data.user));
}
export async function clearSession() {
  await Promise.all(['voxa_access_token','voxa_refresh_token','voxa_user'].map(k => SecureStore.deleteItemAsync(k)));
}
export async function getSavedUser(): Promise<User | null> {
  const raw = await SecureStore.getItemAsync('voxa_user');
  if (!raw) return null;
  try { return JSON.parse(raw) as User; } catch { return null; }
}
async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = await SecureStore.getItemAsync('voxa_refresh_token');
    if (!refreshToken) return false;
    const response = await fetch(API + '/auth/mobile/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) { await clearSession(); return false; }
    const data = await response.json();
    await saveSession(data);
    return true;
  })();
  try { return await refreshInFlight; } finally { refreshInFlight = null; }
}
export async function api<T = any>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = await SecureStore.getItemAsync('voxa_access_token');
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', 'Bearer ' + token);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(API + path, { ...init, headers });
  if (response.status === 401 && retry && !path.startsWith('/auth/mobile/')) {
    if (await refreshSession()) return api<T>(path, init, false);
    throw new Error('Your session expired. Please sign in again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'VOXA could not complete that request');
  return data as T;
}
export async function signIn(email: string, password: string) {
  const response = await fetch(API + '/auth/mobile/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Unable to sign in');
  return data;
}
export async function verifyMfa(token: string, code: string) {
  const response = await fetch(API + '/auth/mobile/mfa/challenge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, code }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Unable to verify code');
  return data;
}
export async function signOut() {
  const refreshToken = await SecureStore.getItemAsync('voxa_refresh_token');
  try {
    if (refreshToken) await fetch(API + '/auth/mobile/logout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } finally { await clearSession(); }
}
export const imageFor = (item: ApiRecord) => item.artworkUrl || item.coverImageUrl || item.show?.artworkUrl || item.creator?.avatarUrl || null;

export async function registerAccount(displayName: string, email: string, password: string) {
  const response = await fetch(API + '/auth/mobile/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, email, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Unable to create your account');
  return data;
}
