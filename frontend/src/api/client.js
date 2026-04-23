const DEFAULT_API_BASE_URL = 'http://localhost:3000/api';

export function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

function resolveApiBaseUrl() {
  return getApiBaseUrl();
}

export async function apiRequest(path, options = {}) {
  const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const isJsonResponse = response.headers.get('content-type')?.includes('application/json');
  const responseBody =
    response.status === 204 ? null : isJsonResponse ? await response.json() : await response.text();

  if (!response.ok) {
    const errorMessage =
      (responseBody && typeof responseBody === 'object' && 'message' in responseBody
        ? responseBody.message
        : null) ||
      (typeof responseBody === 'string' && responseBody.trim().length > 0 ? responseBody : null) ||
      `API request failed with status ${response.status}`;

    const error = new Error(errorMessage);
    error.status = response.status;
    error.data = responseBody;
    throw error;
  }

  return responseBody;
}
