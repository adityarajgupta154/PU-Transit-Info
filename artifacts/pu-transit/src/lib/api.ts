import { auth } from './firebase';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const user = auth.currentUser;
  if (!user) {
    throw new ApiError('Not authenticated', 401, 'unauthenticated');
  }
  
  const token = await user.getIdToken();
  if (auth.currentUser !== user) {
    throw new ApiError('Account changed. Please retry.', 401, 'unauthenticated');
  }
  options.signal?.throwIfAborted();
  
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, { ...options, headers });
  if (auth.currentUser !== user) {
    throw new ApiError('Account changed. Please retry.', 401, 'unauthenticated');
  }
  
  if (!response.ok) {
    let message = 'API Request failed';
    let code: string | undefined;
    try {
      const errorData = await response.json();
      message = errorData.error || message;
      code = errorData.code;
    } catch {
      // Ignore JSON parse error if response is not JSON
    }
    // IDN-02: on a 403 the server's view of this account differs from ours (suspended, expired, role
    // changed — or simply a refused action); the auth context re-reads /auth/me now instead of at
    // its next 20 s poll. Deliberately any 403: a refresh is cheap, a missed revocation is not.
    if (response.status === 403 && typeof window !== 'undefined') window.dispatchEvent(new Event('pu-transit:forbidden'));
    throw new ApiError(message, response.status, code);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return null;
  }

  const data = await response.json();
  options.signal?.throwIfAborted();
  if (auth.currentUser !== user) {
    throw new ApiError('Account changed. Please retry.', 401, 'unauthenticated');
  }
  return data;
}
