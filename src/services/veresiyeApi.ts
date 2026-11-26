/**
 * Veresiye veri katmani — SilopiDijital Veresiye 0.2.9 API sozlesmesi.
 *
 * KURALLAR (degistirilmemeli):
 *  - Tarayicidan Supabase tablolarina dogrudan baglanti YOK.
 *  - @supabase/supabase-js ile dogrudan sorgu YOK.
 *  - Tum istekler ayni alan adindaki sunucu rotalarina gider:
 *      GET  /api/veresiye/health
 *      POST /api/veresiye/veresiye-portal-login
 *  - Supabase URL / publishable key / service_role bu dosyada YOK, olmayacak.
 *  - Musteri oturumu: sunucunun dondurdugu session_token.
 *  - Bu surumde YONETIM PANELI YOK. Yonetim ProPOS uzerinden yapilir.
 *  - Yonetici rotasi (/api/veresiye/veresiye-portal-admin) cagrilmaz.
 */

// ---------------------------------------------------------------------------
// Yapilandirma
// ---------------------------------------------------------------------------

/**
 * Isteklerin gidecegi kok adres.
 *
 * VARSAYILAN: bos dize = ayni koken (same-origin). Tek guvenli ve tek kabul edilen mod.
 *
 * VITE_API_BASE_URL yalnizca:
 *   - bos birakilabilir            → same-origin
 *   - "/" ile baslayan goreli yol → ornegin "/proxy" (yine ayni koken)
 * Baska her deger (http, https dis alan adi, protokol-bagimsiz //adres) REDDEDILIR.
 * Gerekce: oturum belirtecleri yalnizca ayni kokene gonderilir ve CSP'de
 * connect-src 'self' disinda istisna acilmaz.
 */
const API_BASE = resolveApiBase((import.meta.env?.VITE_API_BASE_URL) as string | undefined);

function resolveApiBase(raw: string | undefined): string {
  const value = (raw || '').trim().replace(/\/+$/, '');
  if (!value) return '';

  // Goreli yol (ornegin "/proxy") guvenli: ayni koken icinde kalir.
  if (value.startsWith('/') && !value.startsWith('//')) return value;

  // DIS ALAN ADI REDDEDILIR.
  // API mimarisi ayni koken (same-origin) uzerine kurulu. Baska bir alan adina
  // yonlendirmek CSP'de connect-src istisnasi acmayi ve oturum belirteclerini
  // ucuncu bir tarafa gondermeyi gerektirir. Ikisi de istenmiyor.
  // Ayni site alt alan adi (api.alan.com) gerekiyorsa once bir ters vekil
  // (reverse proxy) ile /api/veresiye/* ayni koken altina alinmali.
  throw new Error(
    'VITE_API_BASE_URL yalnizca bos birakilabilir veya "/" ile baslayan goreli bir yol olabilir. ' +
    'Dis alan adi (ornegin https://api.baska-adres.com) kabul edilmez: oturum belirtecleri yalnizca ayni kokene gonderilir.',
  );
}

/**
 * Demo modu: API'ye hic ulasilmadan sahte veriyle calisir.
 * Gercek veriyle ASLA karismaz — demo verisi ayri bir sabitte tutulur ve
 * her yanit `demo: true` bayragiyla isaretlenir.
 *
 * Acmak icin: .env dosyasina VITE_DEMO_MODE=true
 * Kapatmak icin: VITE_DEMO_MODE=false (veya satiri sil)
 */
export const isDemoMode = String(import.meta.env?.VITE_DEMO_MODE ?? '').toLowerCase() === 'true';

const REQUEST_TIMEOUT_MS = 25_000;

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export type PurchaseItem = {
  product: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type Purchase = {
  id: string;
  items: PurchaseItem[];
  total: number;
  date: string;
  time: string;
  /** Sunucu iade bilgisi dondurduyse; gosterimde toplamdan dusulmus gelir. */
  refund?: number;
};

export type Customer = {
  id: string;
  name: string;
  code: string;
  balance: number;
  lastActivity: string;
  active: boolean;
  hasCode?: boolean;
  lastLoginAt?: string | null;
};


export type PortalHealth = {
  platform: string;
  proxy: string;
  supabaseEdgeFunction: string;
};

export type CustomerLoginResult = {
  customer: Customer;
  purchases: Purchase[];
  sessionToken: string;
  expiresIn: number;
};

/** API kaynakli hata. `status` HTTP kodu, `code` sunucunun dondurdugu makine kodu. */
export class VeresiyeApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, code?: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'VeresiyeApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** Cok fazla hatali deneme (429) — arayuz buna gore geri sayim gosterebilir. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** Oturum gecersiz / erisim kapatilmis — arayuz giris ekranina donmeli. */
  get isSessionInvalid(): boolean {
    return this.status === 401;
  }
}

// ---------------------------------------------------------------------------
// Ortak istek katmani
// ---------------------------------------------------------------------------

type RequestOptions = {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
};

type ServerResponse = {
  success?: boolean;
  message?: string;
  [key: string]: unknown;
};

/** Agir istekleri tek yerden yonetir: timeout, JSON parse, Turkce hata mesaji. */
async function request<T extends ServerResponse>({ method, path, body }: RequestOptions): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new VeresiyeApiError('Sunucu 25 saniye icinde yanit vermedi. Lutfen tekrar deneyin.', 0);
    }
    throw new VeresiyeApiError('Veresiye sunucusuna ulasilamadi. Internet baglantinizi kontrol edip tekrar deneyin.', 0);
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text().catch(() => '');
  let data: T | null = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText) as T;
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    // Cloudflare/Vercel 502/503 HTML dondurebilir; o durumda okunabilir mesaj yaz.
    const fallback =
      response.status === 429
        ? 'Cok fazla hatali deneme yapildi. Lutfen 15 dakika sonra tekrar deneyin.'
        : response.status === 502 || response.status === 503
          ? 'Veresiye sunucusuna su anda ulasilamiyor. Lutfen birkac dakika sonra tekrar deneyin.'
          : response.status === 404
            ? 'Veresiye API adresi bulunamadi. Yayin yapilandirmasi (proxy rotalari) kontrol edilmeli.'
            : response.status === 415
              ? 'Istek bicimi sunucu tarafindan reddedildi (JSON bekleniyor).'
              : 'Veresiye istegi tamamlanamadi. Lutfen tekrar deneyin.';

    const message = data?.message || fallback;
    const code = typeof data?.code === 'string' ? data.code : undefined;
    const retry =
      typeof data?.retry_after_seconds === 'number' ? (data.retry_after_seconds as number) : undefined;
    throw new VeresiyeApiError(message, response.status, code, retry);
  }

  if (!data) {
    throw new VeresiyeApiError('Sunucu gecersiz yanit dondurdu (JSON bekleniyordu).', response.status);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Normalize ediciler — sunucu alanlari eksik/farkli tipte gelse de UI bozulmasin
// ---------------------------------------------------------------------------

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatLastActivity(value: string | null | undefined): string {
  if (!value) return 'Henuz islem yok';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Henuz islem yok';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  }).format(date);
}

// ---------------------------------------------------------------------------
// 1) Saglik kontrolu
// ---------------------------------------------------------------------------

export async function checkPortalHealth(): Promise<PortalHealth> {
  if (isDemoMode) {
    return { platform: 'demo', proxy: 'demo', supabaseEdgeFunction: 'demo' };
  }

  const data = await request<ServerResponse & {
    platform?: string;
    proxy?: string;
    supabase_edge_function?: string;
  }>({ method: 'GET', path: '/api/veresiye/health' });

  return {
    platform: data.platform || 'unknown',
    proxy: data.proxy || 'ready',
    supabaseEdgeFunction: data.supabase_edge_function || 'reachable',
  };
}

// ---------------------------------------------------------------------------
// Demo verisi — YALNIZCA VITE_DEMO_MODE=true iken kullanilir.
// ---------------------------------------------------------------------------

const DEMO_LOGIN: CustomerLoginResult = {
  sessionToken: 'demo-session',
  expiresIn: 60 * 60,
  customer: {
    id: 'demo-customer',
    name: 'Demo Müşteri',
    balance: 145,
    lastActivity: '12.11.2026 18:40',
    active: true,
    hasCode: true,
    code: '',
  },
  purchases: [
    { id: 'd1', date: '12.11.2026', time: '18:40', total: 95, refund: 0, items: [
      { product: 'Süt 1 L', quantity: 2, unitPrice: 22.5, lineTotal: 45 },
      { product: 'Ekmek', quantity: 2, unitPrice: 12.5, lineTotal: 25 },
      { product: 'Çikolata', quantity: 1, unitPrice: 25, lineTotal: 25 },
    ] },
    { id: 'd2', date: '09.11.2026', time: '11:15', total: 50, refund: 0, items: [
      { product: 'Su 5 L', quantity: 1, unitPrice: 30, lineTotal: 30 },
      { product: 'Cips', quantity: 1, unitPrice: 20, lineTotal: 20 },
    ] },
  ],
};

function demoCustomerLogin(_code: string): CustomerLoginResult {
  return DEMO_LOGIN;
}

// ---------------------------------------------------------------------------
// 2) Musteri girisi
// ---------------------------------------------------------------------------

type CustomerLoginResponse = ServerResponse & {
  session_token?: string;
  expires_in?: number;
  customer?: { id: string; name: string; balance: number | string };
  transactions?: Array<{
    id: string;
    date: string;
    time: string;
    total: number | string;
    refund?: number | string;
    items?: Array<{
      product: string;
      quantity: number | string;
      unitPrice: number | string;
      lineTotal?: number | string;
    }>;
  }>;
};

function normalizeLoginResponse(data: CustomerLoginResponse): CustomerLoginResult {
  if (!data.success || !data.customer || !data.session_token) {
    throw new VeresiyeApiError(
      data.message || 'Giris kodu hatali veya web erisiminiz kapali.',
      401,
    );
  }

  const transactions = Array.isArray(data.transactions) ? data.transactions : [];

  const purchases: Purchase[] = transactions.map((transaction) => {
    const items: PurchaseItem[] = (transaction.items || []).map((item) => {
      const quantity = toNumber(item.quantity);
      const unitPrice = toNumber(item.unitPrice);
      return {
        product: item.product,
        quantity,
        unitPrice,
        lineTotal: toNumber(item.lineTotal, quantity * unitPrice),
      };
    });

    return {
      id: transaction.id,
      date: transaction.date,
      time: transaction.time,
      total: toNumber(transaction.total),
      refund: transaction.refund !== undefined ? toNumber(transaction.refund) : undefined,
      items,
    };
  });

  const lastActivity = purchases[0] ? `${purchases[0].date} ${purchases[0].time}` : 'Henuz islem yok';

  return {
    customer: {
      id: data.customer.id,
      name: data.customer.name,
      code: '',
      balance: toNumber(data.customer.balance),
      lastActivity,
      active: true,
    },
    purchases,
    sessionToken: data.session_token,
    expiresIn: toNumber(data.expires_in, 30 * 24 * 60 * 60),
  };
}

/** 6 haneli kodla musteri girisi. */
export async function customerLogin(code: string): Promise<CustomerLoginResult> {
  if (isDemoMode) return demoCustomerLogin(code);

  const normalized = String(code || '').replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(normalized)) {
    throw new VeresiyeApiError('Lutfen 6 haneli giris kodunuzu kontrol edin.', 400);
  }

  const data = await request<CustomerLoginResponse>({
    method: 'POST',
    path: '/api/veresiye/veresiye-portal-login',
    body: { code: normalized },
  });

  return normalizeLoginResponse(data);
}

/** Kayitli oturum belirteciyle girisi surdurur (sayfa yenilendiginde). */
export async function resumeCustomerSession(sessionToken: string): Promise<CustomerLoginResult> {
  if (isDemoMode) return demoCustomerLogin('');

  const token = String(sessionToken || '').trim();
  if (!token) throw new VeresiyeApiError('Kayitli oturum bulunamadi.', 401);
  if (token.length > 4096) throw new VeresiyeApiError('Kayitli oturum gecersiz.', 400);

  const data = await request<CustomerLoginResponse>({
    method: 'POST',
    path: '/api/veresiye/veresiye-portal-login',
    body: { session_token: token },
  });

  return normalizeLoginResponse(data);
}

// ---------------------------------------------------------------------------
// 3) Yonetici islemleri
// ---------------------------------------------------------------------------
