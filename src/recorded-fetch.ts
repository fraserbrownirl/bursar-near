import type { Fetcher } from "./load.js";

/**
 * Tries the live request. A thrown fetch is a browser block (CORS or
 * Cross-Origin-Resource-Policy). When a recorded body was passed, that body
 * is the response and `recorded` is true. An HTTP error is returned as-is:
 * the source answered.
 */
export async function fetchLiveOrRecorded(
  live: Fetcher,
  url: string,
  init: RequestInit | undefined,
  recordedBody: string | undefined,
): Promise<{ response: Response; recorded: boolean }> {
  try {
    const response = await live(url, init);
    return { response, recorded: false };
  } catch (error) {
    if (recordedBody === undefined) throw error;
    return {
      response: new Response(recordedBody, { status: 200, headers: { "content-type": "application/json" } }),
      recorded: true,
    };
  }
}
