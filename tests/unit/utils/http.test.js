import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryError, requestJson } from '../../../src/utils/http.js';

function stubFetch(implementation) {
  vi.stubGlobal('fetch', vi.fn(implementation));
}

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the request to fail.');
}

const call = () =>
  requestJson('https://example.test/x', { route: 'POST /x', method: 'POST', body: {} });

describe('outbound request classification', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns parsed JSON and tolerates empty bodies', async () => {
    stubFetch(async () => new Response('{"id":"1"}', { status: 200 }));
    await expect(call()).resolves.toEqual({ id: '1' });
    stubFetch(async () => new Response(null, { status: 204 }));
    await expect(call()).resolves.toBeNull();
  });

  it.each([
    [
      { status: 429, body: '{"retry_after":2.5}' },
      { outcome: 'rejected', permanent: false, retryAfterSeconds: 3 },
    ],
    [
      { status: 503, body: '' },
      { outcome: 'unknown', permanent: false },
    ],
    [
      { status: 404, body: '{"code":10015,"message":"Unknown Webhook"}' },
      { outcome: 'rejected', permanent: true, providerCode: 10015 },
    ],
  ])('classifies HTTP %o', async ({ status, body }, expected) => {
    stubFetch(async () => new Response(body || null, { status }));
    const error = await failure(call());
    expect(error).toBeInstanceOf(DeliveryError);
    expect(error).toMatchObject({ httpStatus: status, ...expected });
    expect(error.message.startsWith('POST /x returned')).toBe(true);
  });

  it('includes the provider error code and message for OpenAI-style errors', async () => {
    stubFetch(
      async () =>
        new Response(
          '{"error":{"message":"The model `retired-model` does not exist","type":"invalid_request_error","code":"model_not_found"}}',
          { status: 404 },
        ),
    );
    const error = await failure(call());
    expect(error).toMatchObject({ outcome: 'rejected', permanent: true, providerCode: null });
    expect(error.message).toBe(
      'POST /x returned 404: model_not_found: The model `retired-model` does not exist',
    );
  });

  it('distinguishes requests that never left from ambiguous network failures', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    });
    expect(await failure(call())).toMatchObject({ outcome: 'not_sent' });

    stubFetch(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    });
    expect(await failure(call())).toMatchObject({ outcome: 'unknown' });

    stubFetch(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    expect(await failure(call())).toMatchObject({ outcome: 'unknown' });
  });

  it('never puts the real URL into error messages', async () => {
    stubFetch(async () => new Response('{}', { status: 500 }));
    const error = await failure(
      requestJson('https://discord.com/api/webhooks/1/secret-token', {
        route: 'POST /webhooks/:id/:token',
      }),
    );
    expect(error.message).not.toContain('secret-token');
  });
});
