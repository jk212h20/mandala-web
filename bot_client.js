// HTTP client for the MLFactory Mandala AZ service.
//
// Mirrors Boop's server/src/bots/azClient.ts pattern:
//   - fetch (Node 18+ has it globally; no extra deps)
//   - AbortController for hard timeout
//   - one retry on 5xx / network failure, none on 4xx
//   - typed error classes the caller can switch on
//   - lazy singleton, instantiated only when AZ_SERVICE_URL is set
//
// Service contract documented in:
//   MLFactory/src/mlfactory/service/mandala_app.py
//
// Request body:
//   { state: <full mandala-web game state>, playerIndex: 0|1, history?: [...] }
//
// Response body:
//   { action: {type, ...}, templateIndex, value, latency_ms, mode }
//
// Errors thrown:
//   AzServiceBadRequest  - 4xx from service (state malformed, not bot's turn,
//                          game finished). Do NOT retry; surface to caller.
//   AzServiceUnavailable - 5xx, network error, or timeout. Retried once
//                          internally; if still failing, thrown.

const DEFAULT_TIMEOUT_MS = 15_000;
const SINGLE_RETRY_DELAY_MS = 300;

export class AzServiceBadRequest extends Error {
  constructor(message) {
    super(message);
    this.name = 'AzServiceBadRequest';
  }
}

export class AzServiceUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = 'AzServiceUnavailable';
  }
}

export class AzClient {
  constructor(baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!baseUrl) throw new Error('AzClient: baseUrl required');
    // Strip trailing slash so we can append `/health`, `/move` cleanly.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async health() {
    const res = await this._fetchWithTimeout(`${this.baseUrl}/health`, { method: 'GET' });
    if (!res.ok) {
      const text = await res.text();
      throw new AzServiceUnavailable(`AZ /health ${res.status}: ${text}`);
    }
    return res.json();
  }

  /**
   * Ask the AZ service for the bot's next move.
   *
   * @param {object} state - Full mandala game state from the bot's POV.
   *   This MUST be a get-player-view-filtered state for the bot's seat
   *   (so the bot's own hand is visible, opponent's is hidden). The
   *   server-side game state is exactly that when filtered through
   *   getPlayerView(state, botIndex).
   * @param {number} playerIndex - 0 or 1, which seat the bot occupies.
   * @param {Array<{templateIndex:number, actorIndex:number}>} [history]
   *   Optional. If we ever start tracking template-encoded action history,
   *   pass it here for richer encoder features. Empty/omitted is fine —
   *   the trained net still plays without it.
   * @returns {Promise<{action: object, templateIndex: number, value: number, latency_ms: number, mode: string}>}
   */
  async requestMove(state, playerIndex, history = undefined) {
    const url = `${this.baseUrl}/move`;
    const body = JSON.stringify({
      state,
      playerIndex,
      ...(history !== undefined ? { history } : {}),
    });

    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this._fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (res.status >= 400 && res.status < 500) {
          // Client error — service rejected the request as malformed or
          // out-of-turn. No retry; surface the body to caller.
          const text = await res.text();
          throw new AzServiceBadRequest(`AZ /move ${res.status}: ${text}`);
        }
        if (!res.ok) {
          const text = await res.text();
          throw new AzServiceUnavailable(`AZ /move ${res.status}: ${text}`);
        }
        const json = await res.json();
        this._validateMoveResponse(json);
        return json;
      } catch (err) {
        if (err instanceof AzServiceBadRequest) throw err; // no retry on 4xx
        lastErr = err;
        if (attempt === 0) {
          // One brief retry to absorb transient cold-start / network blips.
          await new Promise(r => setTimeout(r, SINGLE_RETRY_DELAY_MS));
          continue;
        }
      }
    }
    throw new AzServiceUnavailable(
      `AZ /move failed after retry: ${lastErr?.message ?? lastErr}`
    );
  }

  async _fetchWithTimeout(url, init) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
  }

  _validateMoveResponse(json) {
    if (!json || typeof json !== 'object') {
      throw new AzServiceUnavailable('AZ /move returned non-object body');
    }
    if (!json.action || typeof json.action !== 'object') {
      throw new AzServiceUnavailable('AZ /move missing .action');
    }
    const validKinds = new Set([
      'build_mountain',
      'grow_field',
      'discard_redraw',
      'claim_color',
    ]);
    if (!validKinds.has(json.action.type)) {
      throw new AzServiceUnavailable(`AZ /move unknown action.type: ${json.action.type}`);
    }
  }
}

// --- Lazy singleton -------------------------------------------------------
//
// Returns a configured AzClient if AZ_SERVICE_URL is set; null otherwise.
// Callers MUST handle the null case (means "no bot service configured" —
// /create_bot_room should fail with a friendly error).

let _singleton = null;
let _singletonInitialized = false;

export function getAzClient() {
  if (_singletonInitialized) return _singleton;
  _singletonInitialized = true;
  const url = process.env.AZ_SERVICE_URL;
  if (!url) {
    console.warn('[bot] AZ_SERVICE_URL not set; bot games will be disabled');
    return null;
  }
  _singleton = new AzClient(url);
  console.log(`[bot] AZ service configured at ${url}`);
  return _singleton;
}
