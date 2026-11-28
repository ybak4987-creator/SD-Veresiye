import webpush from 'web-push';

type HeaderValue = string | string[] | undefined;
type Request = { method?: string; headers: Record<string, HeaderValue>; query?: Record<string, string | string[] | undefined>; body?: unknown };
type Response = { status(code: number): Response; setHeader(name: string, value: string): Response; json(body: unknown): Response; send(body: string): Response; end(): Response };
type JsonRecord = Record<string, unknown>;
type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };

const PROJECT_URL = 'https://ukfeuojhigxxxlnhsmls.supabase.co';
const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_b-cFhb97kOd3mLQnBi_SGQ_8oNQPkzS';
const EDGE_LIST = 'veresiye-push-list';
const EDGE_SUBSCRIBE = 'veresiye-push-subscribe';
const MAX_BODY_BYTES = 32 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function header(value: HeaderValue): string { return Array.isArray(value) ? value[0] || '' : value || ''; }

function sendJson(res: Response, status: number, body: JsonRecord): void {
  res.status(status)
    .setHeader('Content-Type', 'application/json; charset=utf-8')
    .setHeader('Cache-Control', 'no-store, max-age=0')
    .setHeader('X-Content-Type-Options', 'nosniff')
    .json(body);
}

function parseBody(value: unknown): JsonRecord | null {
  const raw = typeof value === 'string' ? value : value && typeof value === 'object' ? JSON.stringify(value) : '';
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonRecord : null;
  } catch { return null; }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function readFunctionName(query: Request['query']): string {
  const raw = query?.fn;
  return Array.isArray(raw) ? (raw.length === 1 ? raw[0] : '') : raw || '';
}

function vapidConfig() {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(process.env.VAPID_SUBJECT || '').trim();
  const validPublic = /^[A-Za-z0-9_-]{80,100}$/.test(publicKey);
  const validPrivate = /^[A-Za-z0-9_-]{40,60}$/.test(privateKey);
  const validSubject = /^https:\/\//i.test(subject) || /^mailto:/i.test(subject);
  return { publicKey, privateKey, subject, ready: validPublic && validPrivate && validSubject };
}

async function edgeCall(functionName: string, payload: JsonRecord) {
  const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_PUBLISHABLE_KEY).trim();
  const upstream = await fetch(`${PROJECT_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json', 'X-Client-Info': 'sd-veresiye-web-push' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await upstream.text();
  let data: JsonRecord = {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as JsonRecord;
  } catch { /* Generic upstream error below. */ }
  return { status: upstream.status, ok: upstream.ok, data };
}

async function verifyWebhookSecret(secret: string): Promise<boolean> {
  if (!secret || secret.length < 32) return false;
  try {
    // The Edge Function checks its Vault secret before validating event fields.
    // This intentionally invalid event type causes no database write.
    const probe = await edgeCall(EDGE_LIST, {
      action: 'prepare_event', webhook_secret: secret,
      event_type: '__healthcheck__', event_id: '00000000-0000-4000-8000-000000000001',
    });
    return probe.status === 400 && probe.data.message === 'Olay bilgisi geçersiz.';
  } catch { return false; }
}

function configureVapid(): boolean {
  const config = vapidConfig();
  if (!config.ready) return false;
  try { webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey); return true; }
  catch { return false; }
}

function notificationPayload(title: string, body: string, tag: string): string {
  return JSON.stringify({ title, body, tag, url: '/' });
}

async function removeExpiredBySession(sessionToken: string, endpoint: string): Promise<void> {
  await edgeCall(EDGE_LIST, { action: 'remove', session_token: sessionToken, endpoint });
}

async function removeExpiredByWebhook(secret: string, customerId: string, businessId: string, endpoint: string): Promise<void> {
  await edgeCall(EDGE_LIST, { action: 'remove', webhook_secret: secret, customer_id: customerId, business_id: businessId, endpoint });
}

async function handleTest(sessionToken: string, res: Response): Promise<void> {
  if (!sessionToken || sessionToken.length > 4096) {
    sendJson(res, 401, { success: false, message: 'Müşteri oturumu geçersiz.' }); return;
  }
  if (!configureVapid()) {
    sendJson(res, 503, { success: false, message: 'Push sunucu anahtarları hazır değil.' }); return;
  }
  const result = await edgeCall(EDGE_LIST, { action: 'test', session_token: sessionToken });
  if (!result.ok || result.data.success !== true) {
    sendJson(res, result.status || 502, { success: false, message: result.data.message || 'Müşteri cihazları doğrulanamadı.' }); return;
  }
  const subscriptions = Array.isArray(result.data.subscriptions) ? result.data.subscriptions as Subscription[] : [];
  if (!subscriptions.length) {
    sendJson(res, 409, { success: false, message: 'Bu hesap için kayıtlı bildirim cihazı bulunamadı.' }); return;
  }
  const payload = notificationPayload(
    'SD Veresiye',
    'Bildirim bağlantısı çalışıyor. Hesabınızda yeni bir hareket olduğunda haber vereceğiz.',
    `sd-veresiye-test-${Date.now()}`,
  );
  const results = await Promise.all(subscriptions.map(async (subscription) => {
    try { await webpush.sendNotification(subscription, payload, { TTL: 3600, urgency: 'normal' }); return true; }
    catch (error) {
      const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
      if (statusCode === 404 || statusCode === 410) await removeExpiredBySession(sessionToken, subscription.endpoint).catch(() => undefined);
      return false;
    }
  }));
  const sent = results.filter(Boolean).length;
  sendJson(res, sent > 0 ? 200 : 502, {
    success: sent > 0, sent_count: sent, total_count: subscriptions.length,
    message: sent > 0 ? 'Test bildirimi Push sağlayıcısına gönderildi.' : 'Test bildirimi gönderilemedi. Cihaz aboneliğini yeniden oluşturun.',
  });
}

async function handleWebhook(req: Request, res: Response, body: JsonRecord): Promise<void> {
  const expectedSecret = String(process.env.PUSH_WEBHOOK_SECRET || '').trim();
  const receivedSecret = header(req.headers['x-webhook-secret']);
  if (!constantTimeEqual(receivedSecret, expectedSecret)) {
    sendJson(res, 401, { success: false, message: 'Yetkisiz webhook.' }); return;
  }
  if (body.type !== 'INSERT' || body.schema !== 'public' || !['sales', 'customer_payments'].includes(String(body.table))) {
    sendJson(res, 400, { success: false, message: 'Desteklenmeyen veritabanı olayı.' }); return;
  }
  const record = body.record && typeof body.record === 'object' && !Array.isArray(body.record) ? body.record as JsonRecord : null;
  const eventId = String(record?.id || '');
  if (!record || !UUID_RE.test(eventId)) {
    sendJson(res, 400, { success: false, message: 'Veritabanı olay kaydı geçersiz.' }); return;
  }
  if (!configureVapid()) {
    sendJson(res, 503, { success: false, message: 'Push sunucu anahtarları hazır değil.' }); return;
  }

  const eventType = String(body.table);
  const prepared = await edgeCall(EDGE_LIST, {
    action: 'prepare_event', webhook_secret: expectedSecret, event_type: eventType, event_id: eventId,
  });
  if (!prepared.ok || prepared.data.success !== true) {
    sendJson(res, prepared.status || 502, { success: false, message: prepared.data.message || 'Veresiye olayı doğrulanamadı.' }); return;
  }
  if (prepared.data.skipped || prepared.data.duplicate || prepared.data.no_subscribers) {
    sendJson(res, 200, {
      success: true, skipped: prepared.data.skipped || null,
      duplicate: Boolean(prepared.data.duplicate), no_subscribers: Boolean(prepared.data.no_subscribers),
    }); return;
  }

  const subscriptions = Array.isArray(prepared.data.subscriptions) ? prepared.data.subscriptions as Subscription[] : [];
  const customerId = String(prepared.data.customer_id || '');
  const businessId = String(prepared.data.business_id || '');
  const eventKey = String(prepared.data.event_key || `${eventType}:${eventId}`);
  if (!subscriptions.length || !customerId || !businessId) {
    sendJson(res, 200, { success: true, skipped: 'Abonelik veya müşteri bulunamadı.' }); return;
  }

  const title = String(prepared.data.title || 'SD Veresiye').slice(0, 80);
  const message = String(prepared.data.body || 'Hesabınızda yeni bir hareket var. Ayrıntılar için uygulamayı açın.').slice(0, 180);
  const payload = notificationPayload(title, message, `sd-veresiye-${eventId}`);
  const results = await Promise.all(subscriptions.map(async (subscription) => {
    try { await webpush.sendNotification(subscription, payload, { TTL: 86400, urgency: 'normal' }); return { sent: true, error: '' }; }
    catch (error) {
      const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
      if (statusCode === 404 || statusCode === 410) {
        await removeExpiredByWebhook(expectedSecret, customerId, businessId, subscription.endpoint).catch(() => undefined);
      }
      return { sent: false, error: statusCode ? `Push sağlayıcı HTTP ${statusCode}` : 'Push gönderim hatası' };
    }
  }));

  const sent = results.filter((item) => item.sent).length;
  const lastError = results.find((item) => item.error)?.error || '';
  const status = sent === subscriptions.length ? 'sent' : sent > 0 ? 'partial_failed' : 'failed';
  const completed = await edgeCall(EDGE_LIST, {
    action: 'complete_event', webhook_secret: expectedSecret, event_key: eventKey,
    status, sent_count: sent, total_count: subscriptions.length, last_error: lastError,
  });
  if (!completed.ok || completed.data.success !== true) console.error('[sd-veresiye-push] Event result could not be recorded.');

  sendJson(res, sent > 0 ? 200 : 502, { success: sent > 0, sent_count: sent, total_count: subscriptions.length, status });
}

export default async function handler(req: Request, res: Response): Promise<void> {
  const method = String(req.method || 'GET').toUpperCase();
  const rawFn = req.query?.fn;
  const fn = Array.isArray(rawFn) ? (rawFn.length === 1 ? rawFn[0] : '') : rawFn || '';

  if (method === 'OPTIONS') { res.setHeader('Allow', 'GET, POST, OPTIONS'); res.status(204).end(); return; }

  if (fn === 'config') {
    if (method !== 'GET') { sendJson(res, 405, { success: false, message: 'Bu adres GET kabul eder.' }); return; }
    const config = vapidConfig();
    const vapidReady = configureVapid();
    const webhookReady = await verifyWebhookSecret(String(process.env.PUSH_WEBHOOK_SECRET || '').trim());
    sendJson(res, 200, { success: true, publicKey: vapidReady ? config.publicKey : null, vapidReady, webhookReady });
    return;
  }

  if (!['subscribe', 'test', 'webhook'].includes(fn)) { sendJson(res, 404, { success: false, message: 'Bilinmeyen Push API adresi.' }); return; }
  if (method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); sendJson(res, 405, { success: false, message: 'Method not allowed.' }); return; }

  const body = parseBody(req.body);
  if (!body) { sendJson(res, 400, { success: false, message: 'Geçersiz veya çok büyük JSON isteği.' }); return; }

  try {
    if (fn === 'subscribe') {
      const token = String(body.session_token || '');
      const subscription = body.subscription as Subscription | undefined;
      if (!token || token.length > 4096 || !subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
        sendJson(res, 400, { success: false, message: 'Müşteri oturumu veya cihaz aboneliği eksik.' }); return;
      }
      const result = await edgeCall(EDGE_SUBSCRIBE, { session_token: token, subscription });
      sendJson(res, result.status, result.data); return;
    }
    if (fn === 'test') { await handleTest(String(body.session_token || ''), res); return; }
    await handleWebhook(req, res, body);
  } catch (error) {
    console.error('[sd-veresiye-push-api]', error);
    sendJson(res, 502, { success: false, message: 'Push sunucusuna şu anda ulaşılamıyor.' });
  }
}
