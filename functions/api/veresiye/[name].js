/**
 * Cloudflare Pages Function for the Veresiye portal.
 * Routes: /api/veresiye/health, /api/veresiye/veresiye-portal-login,
 *         /api/veresiye/veresiye-portal-admin
 *
 * Only the public Supabase publishable key is present here. Supabase service
 * credentials remain inside the two Supabase Edge Functions.
 */

const PROJECT_URL = 'https://ukfeuojhigxxxlnhsmls.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_b-cFhb97kOd3mLQnBi_SGQ_8oNQPkzS';
const ALLOWED_FUNCTIONS = new Set([
  'veresiye-portal-login',
  'veresiye-portal-admin',
]);
const MAX_BODY_BYTES = 16 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;

function json(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function isJsonContentType(value) {
  return /^application\/json(?:\s*;|\s*$)/i.test(value || '');
}

function getTrustedClientIp(request) {
  // CF-Connecting-IP is injected by Cloudflare at the edge. Never trust a
  // browser-provided X-Veresiye-Client-IP or X-Forwarded-For value.
  const value = request.headers.get('CF-Connecting-IP') || '';
  if (!value || value.length > 160 || /[\r\n]/.test(value)) return '';
  return value;
}

async function callSupabase(functionName, body, request) {
  const headers = {
    apikey: PUBLISHABLE_KEY,
    'Content-Type': 'application/json',
    'X-Client-Info': 'silopidijital-veresiye-cloudflare-pages',
  };
  const clientIp = getTrustedClientIp(request);
  if (clientIp) headers['X-Veresiye-Client-IP'] = clientIp;

  return fetch(`${PROJECT_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

async function healthCheck(request) {
  try {
    // Empty code is rejected before DB access and before failed-code counting.
    const upstream = await callSupabase('veresiye-portal-login', '{}', request);
    const responseText = await upstream.text();
    const reachable = upstream.status === 401 && responseText.includes('Giriş kodu geçersiz');

    if (!reachable) {
      return json(502, {
        success: false,
        message: 'Supabase Veresiye giriş fonksiyonuna ulaşıldı ancak beklenen sağlık yanıtı alınamadı.',
        upstream_status: upstream.status,
      });
    }

    return json(200, {
      success: true,
      platform: 'cloudflare-pages',
      proxy: 'ready',
      supabase_edge_function: 'reachable',
    });
  } catch (error) {
    console.error('[veresiye-cloudflare-health]', error);
    return json(502, {
      success: false,
      message: 'Supabase bağlantı kontrolü tamamlanamadı. Cloudflare sunucusu Supabase fonksiyonuna ulaşamıyor.',
    });
  }
}

export async function onRequest({ request, params }) {
  const method = String(request.method || 'GET').toUpperCase();
  const functionName = String(params?.name || '');

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        Allow: functionName === 'health' ? 'GET, OPTIONS' : 'POST, OPTIONS',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  }

  if (functionName === 'health') {
    if (method !== 'GET') {
      return json(405, { success: false, message: 'Health endpoint yalnızca GET kabul eder.' }, { Allow: 'GET, OPTIONS' });
    }
    return healthCheck(request);
  }

  if (!ALLOWED_FUNCTIONS.has(functionName)) {
    return json(404, { success: false, message: 'Bilinmeyen Veresiye API adresi.' });
  }

  if (method !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed.' }, { Allow: 'POST, OPTIONS' });
  }

  if (!isJsonContentType(request.headers.get('Content-Type'))) {
    return json(415, { success: false, message: 'İstek JSON biçiminde olmalıdır.' });
  }

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json(413, { success: false, message: 'İstek gövdesi çok büyük.' });
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return json(400, { success: false, message: 'İstek gövdesi okunamadı.' });
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json(413, { success: false, message: 'İstek gövdesi çok büyük.' });
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return json(400, { success: false, message: 'Geçersiz JSON isteği.' });
  }

  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return json(400, { success: false, message: 'JSON nesnesi bekleniyor.' });
  }

  try {
    const upstream = await callSupabase(functionName, rawBody, request);
    const responseText = await upstream.text();
    return new Response(responseText, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[veresiye-cloudflare-proxy]', error);
    return json(502, {
      success: false,
      message: 'Veresiye sunucusuna şu anda ulaşılamıyor. İnternet bağlantısını kontrol edip tekrar deneyin.',
    });
  }
}
