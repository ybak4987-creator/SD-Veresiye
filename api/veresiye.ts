/**
 * Same-origin Vercel Node.js function proxy for the two approved Veresiye
 * Supabase Edge Functions. The publishable key is pinned below; service-role
 * credentials never leave the Supabase Edge Functions.
 *
 * VERCEL YONLENDIRME NOTU
 * -----------------------
 * Vercel dinamik dosya adlarini (`[function].ts`) rewrite hedeflerinde
 * desteklemez ve `functions` deseninde eslestirmez: build
 * "The pattern .* doesn't match any Serverless Functions" hatasi verir.
 *
 * Bu yuzden SABIT bir dosya adi kullanilir (`api/veresiye.ts`) ve uc rota
 * `vercel.json` icindeki uc ayri rewrite ile buraya baglanir. Istenen Veresiye
 * fonksiyonunun adi `?fn=<ad>` sorgu parametresiyle tasinir.
 *
 *   /api/veresiye/health                    -> /api/veresiye?fn=health
 *   /api/veresiye/veresiye-portal-login     -> /api/veresiye?fn=veresiye-portal-login
 *
 * Istemci tarafi (src/services/veresiyeApi.ts) hicbir sey bilmez; o hala
 * /api/veresiye/<ad> adreslerine istek atar.
 */

type HeaderValue = string | string[] | undefined;
type VercelRequest = {
  method?: string;
  headers: Record<string, HeaderValue>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type VercelResponse = {
  status(code: number): VercelResponse;
  setHeader(name: string, value: string): VercelResponse;
  send(body: string): VercelResponse;
  json(body: unknown): VercelResponse;
  end(): VercelResponse;
};

const PROJECT_URL = 'https://ukfeuojhigxxxlnhsmls.supabase.co';
const ALLOWED_FUNCTIONS = new Set(['veresiye-portal-login']);
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Supabase anahtari.
 *
 * ONCELIK: SUPABASE_PUBLISHABLE_KEY ortam degiskeni (Vercel > Settings >
 * Environment Variables). Tanimliysa kod icindeki deger HIC kullanilmaz.
 * Tanimli degilse asagidaki varsayilan devreye girer; boylece ilk kurulum
 * calisir ve anahtar donusturmek icin kod degistirmek gerekmez.
 *
 * ASLA service_role anahtari buraya yazilmaz: bu kod sunucuda calissa da
 * depoya islenen bir service_role anahtari tum veritabanini acar.
 */
const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_b-cFhb97kOd3mLQnBi_SGQ_8oNQPkzS';

function resolvePublishableKey(): string {
  const fromEnv = typeof process !== 'undefined' ? process.env?.SUPABASE_PUBLISHABLE_KEY : undefined;
  const value = String(fromEnv || '').trim();
  return value || DEFAULT_PUBLISHABLE_KEY;
}
const UPSTREAM_TIMEOUT_MS = 20_000;

function headerValue(value: HeaderValue): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function reply(res: VercelResponse, status: number, body: Record<string, unknown>): VercelResponse {
  return res
    .status(status)
    .setHeader('Content-Type', 'application/json; charset=utf-8')
    .setHeader('Cache-Control', 'no-store, max-age=0')
    .setHeader('X-Content-Type-Options', 'nosniff')
    .json(body);
}

function serializeBody(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

function firstForwardedIp(value: HeaderValue): string | null {
  const first = headerValue(value).split(',')[0]?.trim() || '';
  if (!first || first.length > 160 || /[\r\n]/.test(first)) return null;
  return first;
}

/** `?fn=` parametresini okur; dizi gelirse reddeder. */
function readFunctionName(query: VercelRequest['query']): string {
  const raw = query?.fn;
  if (Array.isArray(raw)) return raw.length === 1 ? raw[0] : '';
  return raw || '';
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const method = String(req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    res.status(204);
    res.end();
    return;
  }

  const functionName = readFunctionName(req.query);
  const publishableKey = resolvePublishableKey();

  // ---- Saglik kontrolu ----
  if (functionName === 'health') {
    if (method !== 'GET') {
      reply(res, 405, { success: false, message: 'Health endpoint yalnizca GET kabul eder.' });
      return;
    }
    try {
      const probe = await fetch(`${PROJECT_URL}/functions/v1/veresiye-portal-login`, {
        method: 'POST',
        headers: {
          apikey: publishableKey,
          'Content-Type': 'application/json',
          'X-Client-Info': 'sd-veresiye-vercel-health',
        },
        body: '{}',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      const body = await probe.text();
      // Bos kod, DB'ye gitmeden ve hatali deneme sayilmadan reddedilir.
      if (probe.status === 401 && body.includes('Giriş kodu geçersiz')) {
        reply(res, 200, {
          success: true,
          platform: 'vercel',
          proxy: 'ready',
          supabase_edge_function: 'reachable',
        });
      } else {
        reply(res, 502, {
          success: false,
          message: 'Supabase Veresiye giris fonksiyonuna ulasildi ancak beklenen saglik yaniti alinamadi.',
          upstream_status: probe.status,
        });
      }
    } catch (error) {
      console.error('[veresiye-vercel-health]', error);
      reply(res, 502, {
        success: false,
        message: 'Supabase baglanti kontrolu tamamlanamadi.',
      });
    }
    return;
  }

  if (!ALLOWED_FUNCTIONS.has(functionName)) {
    reply(res, 404, { success: false, message: 'Bilinmeyen Veresiye API adresi.' });
    return;
  }

  if (method !== 'POST') {
    reply(res, 405, { success: false, message: 'Method not allowed.' });
    return;
  }

  if (!/^application\/json(?:\s*;|\s*$)/i.test(headerValue(req.headers['content-type']))) {
    reply(res, 415, { success: false, message: 'Istek JSON biciminde olmalidir.' });
    return;
  }

  const rawBody = serializeBody(req.body) ?? '';
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    reply(res, 413, { success: false, message: 'Istek govdesi cok buyuk.' });
    return;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody || '{}');
  } catch {
    reply(res, 400, { success: false, message: 'Gecersiz JSON istegi.' });
    return;
  }
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    reply(res, 400, { success: false, message: 'JSON nesnesi bekleniyor.' });
    return;
  }

  const headers: Record<string, string> = {
    apikey: publishableKey,
    'Content-Type': 'application/json',
    'X-Client-Info': 'sd-veresiye-vercel-proxy',
  };
  const clientIp =
    firstForwardedIp(req.headers['x-forwarded-for']) ||
    firstForwardedIp(req.headers['x-real-ip']);
  if (clientIp) headers['X-Veresiye-Client-IP'] = clientIp;

  try {
    const upstream = await fetch(`${PROJECT_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(parsedBody),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const responseBody = await upstream.text();
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(upstream.status);
    res.send(responseBody);
  } catch (error) {
    console.error('[veresiye-vercel-proxy]', error);
    reply(res, 502, {
      success: false,
      message: 'Veresiye sunucusuna su anda ulasilamiyor. Internet baglantisini kontrol edip tekrar deneyin.',
    });
  }
}
