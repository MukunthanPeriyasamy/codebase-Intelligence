/** Server-side backend address. Agent execution and persistence live in FastAPI. */
export function backendBase(): string {
  return (process.env.SERVER_BASE_URL || process.env.PYTHON_BACKEND_HOST || 'http://127.0.0.1:8001').replace(/\/+$/, '') + '/api/v1';
}
