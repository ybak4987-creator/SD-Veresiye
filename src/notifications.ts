export type PushDiagnostic = {
  key: string;
  label: string;
  status: 'ok' | 'warning' | 'error';
  detail: string;
};

type PushConfig = {
  success: boolean;
  publicKey?: string;
  vapidReady?: boolean;
  webhookReady?: boolean;
};

type ApiResult = {
  success?: boolean;
  message?: string;
  sent_count?: number;
  total_count?: number;
  [key: string]: unknown;
};

async function apiRequest<T extends ApiResult>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  let data: T | null = null;
  try { data = raw ? JSON.parse(raw) as T : null; } catch { data = null; }
  if (!response.ok || !data?.success) {
    throw new Error(data?.message || `Bildirim isteği başarısız (HTTP ${response.status}).`);
  }
  return data;
}


async function checkServerSubscription(sessionToken: string, endpoint: string): Promise<boolean> {
  if (!sessionToken || !endpoint) return false;
  const result = await apiRequest<ApiResult & { subscribed?: boolean }>(
    '/api/veresiye/push-status',
    { session_token: sessionToken, endpoint },
  );
  return result.subscribed === true;
}

async function getPushConfig(): Promise<PushConfig> {
  return apiRequest<PushConfig & ApiResult>('/api/veresiye/push-config');
}

function decodeApplicationServerKey(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

function isIosDevice(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isInstalledPwa(): boolean {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || standaloneNavigator.standalone === true;
}

/** Called directly from the button click; iOS requires this user gesture. */
export async function subscribeToPush(sessionToken: string): Promise<{ message: string }> {
  if (!sessionToken) throw new Error('Müşteri oturumu bulunamadı. Yeniden giriş yapın.');
  if (!window.isSecureContext) throw new Error('Bildirimler için HTTPS bağlantısı gereklidir.');
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Bu tarayıcı Web Push bildirimlerini desteklemiyor.');
  }
  if (isIosDevice() && !isInstalledPwa()) {
    throw new Error('iPhone’da önce Safari → Paylaş → Ana Ekrana Ekle yapın. Sonra SD Veresiye ikonundan açıp tekrar deneyin.');
  }

  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Bildirim izni tarayıcı ayarlarından kapalı. Ayarlardan SD Veresiye bildirimlerine izin verin.'
      : 'Bildirim izni verilmedi.');
  }

  const config = await getPushConfig();
  if (!config.vapidReady || !config.webhookReady || !config.publicKey) {
    throw new Error('Sunucu bildirim ayarları henüz hazır değil. Lütfen biraz sonra tekrar deneyin.');
  }

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(config.publicKey),
    });
  }

  const saved = await apiRequest<ApiResult>('/api/veresiye/push-subscribe', {
    session_token: sessionToken,
    subscription: subscription.toJSON(),
  });
  return { message: saved.message || 'Bu cihaz SD Veresiye bildirimlerine kaydedildi.' };
}

export async function sendTestPush(sessionToken: string): Promise<string> {
  if (!sessionToken) throw new Error('Müşteri oturumu bulunamadı. Yeniden giriş yapın.');
  const result = await apiRequest<ApiResult>('/api/veresiye/push-test', { session_token: sessionToken });
  const sent = Number(result.sent_count || 0);
  const total = Number(result.total_count || 0);
  return sent > 0
    ? `Test bildirimi sunucudan gönderildi (${sent}/${total}). Telefonun bildirimlerini kontrol edin.`
    : 'Bu hesap için kayıtlı bildirim cihazı bulunamadı.';
}

export async function collectDiagnostics(sessionToken: string): Promise<PushDiagnostic[]> {
  const secure = window.isSecureContext && window.location.protocol === 'https:';
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let registration: ServiceWorkerRegistration | undefined;
  let hasSubscription = false;
  let serverHasSubscription = false;
  let currentEndpoint = '';
  let config: PushConfig | null = null;
  let diagnosticsError = '';

  if (secure && 'serviceWorker' in navigator) {
    try {
      registration = await navigator.serviceWorker.getRegistration('/sw.js');
      if (!registration) registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const browserSubscription = await registration.pushManager.getSubscription();
      hasSubscription = Boolean(browserSubscription);
      currentEndpoint = browserSubscription?.endpoint || '';
      if (hasSubscription && currentEndpoint && sessionToken) {
        serverHasSubscription = await checkServerSubscription(sessionToken, currentEndpoint);
      }
    } catch (error) {
      diagnosticsError = error instanceof Error ? error.message : 'Service Worker kaydı başarısız.';
    }
  }
  try {
    config = await getPushConfig();
  } catch (error) {
    diagnosticsError = error instanceof Error ? error.message : 'Sunucu kontrol edilemedi.';
  }

  const permission = 'Notification' in window ? Notification.permission : 'unsupported';
  const iosInstallRequired = isIosDevice() && !isInstalledPwa();

  return [
    { key: 'https', label: 'Güvenli HTTPS bağlantısı', status: secure ? 'ok' : 'error', detail: secure ? 'HTTPS hazır' : 'HTTPS bağlantısı gerekli' },
    { key: 'service-worker', label: 'Service Worker', status: registration?.active ? 'ok' : diagnosticsError ? 'error' : 'warning', detail: registration?.active ? 'Kayıtlı ve aktif' : diagnosticsError || 'Kayıt bekleniyor' },
    { key: 'push-api', label: 'Push API desteği', status: supported ? 'ok' : 'error', detail: supported ? 'Tarayıcı destekliyor' : 'Tarayıcı Web Push desteklemiyor' },
    { key: 'permission', label: 'Bildirim izni', status: permission === 'granted' ? 'ok' : permission === 'denied' ? 'error' : 'warning', detail: permission === 'granted' ? 'İzin verildi' : permission === 'denied' ? 'Tarayıcı ayarlarından engellenmiş' : 'Henüz izin verilmedi' },
    { key: 'vapid', label: 'VAPID sunucu anahtarları', status: config?.vapidReady && Boolean(config.publicKey) ? 'ok' : 'error', detail: config?.vapidReady ? 'Sunucuda yapılandırılmış' : diagnosticsError || 'Sunucu anahtarları eksik' },
    { key: 'webhook', label: 'Supabase webhook bağlantısı', status: config?.webhookReady ? 'ok' : 'error', detail: config?.webhookReady ? 'Gizli anahtar eşleşiyor' : 'Webhook gizli anahtarı doğrulanamadı' },
    {
      key: 'subscription',
      label: 'Müşteri ve cihaz aboneliği',
      status: !sessionToken ? 'error' : hasSubscription && serverHasSubscription && permission === 'granted' ? 'ok' : 'warning',
      detail: !sessionToken
        ? 'Müşteri oturumu yok'
        : hasSubscription && serverHasSubscription && permission === 'granted'
          ? 'Bu cihaz sunucuya kayıtlı'
          : hasSubscription && !serverHasSubscription
            ? 'Cihaz kaydı sunucuda doğrulanamadı'
            : iosInstallRequired
              ? 'iPhone’da önce Ana Ekrana ekleyin'
              : 'Bildirimleri etkinleştirmeniz bekleniyor',
    },
  ];
}
