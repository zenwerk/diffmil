/**
 * Converts a non-ok fetch Response into an Error carrying the server's
 * structured error body ({error, detail}), so users see the actual cause
 * (e.g. git's stderr) instead of just "HTTP 500".
 */
export async function apiError(res: Response): Promise<Error> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") {
      return new Error(body.detail ? `${body.error}: ${body.detail}` : body.error);
    }
  } catch {
    // Body was not our JSON error shape; fall through to the generic message.
  }
  return new Error(`HTTP ${res.status}`);
}
