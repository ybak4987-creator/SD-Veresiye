import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowUpRight,
  Bell,
  BellRing,
  CheckCircle2,
  AlertCircle,
  CalendarDays,
  ChevronRight,
  Clock3,
  KeyRound,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  ShoppingBag,
  Store,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import {
  customerLogin,
  resumeCustomerSession,
  checkPortalHealth,
  type Customer,
  type Purchase,
} from '@/services/veresiyeApi';
import { collectDiagnostics, sendTestPush, subscribeToPush, type PushDiagnostic } from '@/notifications';

type View = 'customer-login' | 'customer';
type PortalHealthState = { status: 'idle' | 'checking' | 'ok' | 'error'; message: string };
const CUSTOMER_SESSION_KEY = 'silopidijital-veresiye-session-v1';

const formatMoney = (amount: number) => new Intl.NumberFormat('tr-TR', {
  style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(amount);


function BrandMark({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return <img src="/icon-192.png" alt="Silopi Dijital" className="brand-mark" width={38} height={38} decoding="async" />;
  }

  return (
    <div className="brand-lockup brand-lockup-official">
      <img
        src="/silopi-dijital-logo.png"
        alt="Silopi Dijital"
        className="brand-logo-wordmark"
        width={224}
        height={64}
        fetchPriority="high"
        decoding="async"
      />
      <div className="brand-product-label"><strong>VERESİYE</strong><small>FERHAT BÜFE</small></div>
    </div>
  );
}

function App() {
  const [view, setView] = useState<View>('customer-login');
  const [code, setCode] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [sessionToken, setSessionToken] = useState('');
  const [customerPurchases, setCustomerPurchases] = useState<Purchase[]>([]);
  const [portalHealth, setPortalHealth] = useState<PortalHealthState>({ status: 'idle', message: '' });

  useEffect(() => {
    let cancelled = false;
    let savedToken = '';
    try { savedToken = window.localStorage.getItem(CUSTOMER_SESSION_KEY) || ''; } catch { savedToken = ''; }
    if (!savedToken) return;

    setIsLoading(true);
    void resumeCustomerSession(savedToken).then((result) => {
      if (cancelled) return;
      setSelectedCustomer(result.customer);
      setSessionToken(result.sessionToken);
      setCustomerPurchases(result.purchases);
      // Rotate the signed 30-day token after every successful restore.
      try { window.localStorage.setItem(CUSTOMER_SESSION_KEY, result.sessionToken); } catch { /* Login remains valid for this visit if storage is disabled. */ }
      setView('customer');
    }).catch(() => {
      try { window.localStorage.removeItem(CUSTOMER_SESSION_KEY); } catch { /* storage may be disabled */ }
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  const handlePortalHealthCheck = async () => {
    setPortalHealth({ status: 'checking', message: 'Bağlantı kontrol ediliyor…' });
    try {
      const health = await checkPortalHealth();
      setPortalHealth({ status: 'ok', message: `Bağlantı hazır · ${health.platform} · Supabase erişilebilir` });
    } catch (error) {
      setPortalHealth({ status: 'error', message: error instanceof Error ? error.message : 'Bağlantı kontrol edilemedi.' });
    }
  };

  const handleCustomerLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setLoginError('');
    try {
      const result = await customerLogin(code);
      try {
        if (rememberMe) window.localStorage.setItem(CUSTOMER_SESSION_KEY, result.sessionToken);
        else window.localStorage.removeItem(CUSTOMER_SESSION_KEY);
      } catch { /* Browser storage may be disabled; login still works for this visit. */ }
      setSelectedCustomer(result.customer);
      setSessionToken(result.sessionToken);
      setCustomerPurchases(result.purchases);
      setCode('');
      setView('customer');
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Giriş yapılamadı. Lütfen tekrar deneyin.');
    } finally {
      setIsLoading(false);
    }
  };

  const logoutCustomer = () => {
    try { window.localStorage.removeItem(CUSTOMER_SESSION_KEY); } catch { /* storage may be disabled */ }
    setSelectedCustomer(null);
    setSessionToken('');
    setCustomerPurchases([]);
    setView('customer-login');
  };

  if (view === 'customer' && selectedCustomer) {
    return <CustomerDashboard customer={selectedCustomer} purchases={customerPurchases} sessionToken={sessionToken} onLogout={logoutCustomer} />;
  }

  return <LoginScreen mode="customer" code={code} setCode={setCode} error={loginError} onSubmit={handleCustomerLogin} loading={isLoading} onHealthCheck={handlePortalHealthCheck} healthState={portalHealth} rememberMe={rememberMe} setRememberMe={setRememberMe} />;
}

type LoginScreenProps = {
  mode: 'customer';
  code: string;
  setCode: (value: string) => void;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  loading: boolean;
  onHealthCheck: () => void;
  healthState: PortalHealthState;
  rememberMe: boolean;
  setRememberMe: (value: boolean) => void;
};

function LoginScreen(props: LoginScreenProps) {
  return <div className="login-page"><div className="login-glow glow-one" /><div className="login-glow glow-two" /><div className="login-container">
    <div className="login-brand"><div className="login-brand-main"><BrandMark /></div><div className="login-store"><Store size={18} /> Ferhat Büfe</div></div>
    <div className="login-card"><div className="login-icon"><BrandMark compact /></div><span className="eyebrow">MÜŞTERİ GİRİŞİ</span><h1>Hesabına güvenle ulaş</h1><p>Size verilen 6 haneli giriş kodunu girerek hesabınızı görüntüleyin.</p>
      <form onSubmit={props.onSubmit} className="login-form">
        <label>6 haneli giriş kodu<div className="input-wrap"><KeyRound size={18} /><input autoFocus type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={props.code} onChange={(event) => props.setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" required /></div></label>
        <label className="remember-row"><input type="checkbox" checked={props.rememberMe} onChange={(event) => props.setRememberMe(event.target.checked)} /> Beni hatırla</label>
        {props.error && <div className="form-error"><X size={15} />{props.error}</div>}
        <button className="button button-primary login-submit" type="submit" disabled={props.loading}>{props.loading ? 'Kontrol ediliyor...' : 'Hesabıma giriş yap'}<ArrowUpRight size={17} /></button>
        <div className="portal-health-area">
          <button type="button" className="portal-health-button" onClick={props.onHealthCheck} disabled={props.healthState.status === 'checking'}>{props.healthState.status === 'checking' ? 'Bağlantı kontrol ediliyor…' : 'Bağlantıyı kontrol et'}</button>
          {props.healthState.message && <p className={`portal-health-result portal-health-${props.healthState.status}`} role="status">{props.healthState.message}</p>}
        </div>
      </form>
    </div>
    <div className="login-footer"><span><ShieldCheck size={13} /> Güvenli erişim</span></div>
  </div></div>;
}

function CustomerDashboard({ customer, purchases, sessionToken, onLogout }: { customer: Customer; purchases: Purchase[]; sessionToken: string; onLogout: () => void }) {
  const [expandedPurchase, setExpandedPurchase] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  // "Acik hesap" = henuz odenmemis alisverisler.
  // Mantik: en yeniden en eskiye dogru islem tutarlarini topla; guncel borc
  // kadarini "acik" say, kalani odendi kabul et. Boylece odeme yapildiginda
  // eski alisverisler kendiliginden gecmise duser ve liste sifirlanir.
  // Sunucu ek bir alan dondurmuyor; hesap tamamen bakiye + islemlerden yapilir.
  const debt = Math.max(0, customer.balance);
  let remaining = debt;
  const openPurchases: Purchase[] = [];
  for (const purchase of purchases) {
    const net = Math.max(0, purchase.total - (purchase.refund || 0));
    // Borc kalmadiysa dongu durur: sonraki (daha eski) alisverisler gecmise gider.
    if (remaining <= 0.009) break;
    openPurchases.push(purchase);
    remaining = Math.max(0, remaining - net);
    // Iade alisverisi borcu kapatmis olabilir; bu durumda da dur.
    if (remaining <= 0.009) break;
  }
  // "Gecmis" = kapanmis donemlerin alisverisleri.
  // Kural: en yeni alisveristen geriye yururken acik hesabi olusturanlar
  // haric TUM eski alisverisler gecmise gider. Boylece hesap sifirlandiginda
  // (borc 0) butun eski alisverisler gecmise duser, yeni alisveris ise
  // tek basina "Acik Hesap" bolumunde gorunur.
  const closedPurchases = purchases.filter((purchase) => !openPurchases.includes(purchase));

  const visiblePurchases = showAll ? closedPurchases : closedPurchases.slice(0, 10);
  const openTotal = openPurchases.reduce((sum, purchase) => sum + Math.max(0, purchase.total - (purchase.refund || 0)), 0);

  const renderPurchase = (purchase: Purchase) => {
    const summary = purchase.items.slice(0, 2).map((line) => `${line.product} (${line.quantity} adet)`).join(' + ');
    const hiddenCount = Math.max(0, purchase.items.length - 2);
    const isExpanded = expandedPurchase === purchase.id;
    return <article className={`purchase-item ${isExpanded ? 'purchase-item-expanded' : ''}`} key={purchase.id}>
      <button className="purchase-summary" onClick={() => setExpandedPurchase(isExpanded ? null : purchase.id)} aria-expanded={isExpanded}>
        <div className="purchase-icon"><ShoppingBag size={21} /></div><div className="purchase-info"><strong>{summary || 'Ürün ayrıntısı bulunamadı'}{hiddenCount > 0 && ` + ${hiddenCount} diğer ürün`}</strong><span><CalendarDays size={14} /> {purchase.date} · {purchase.time}</span></div><div className="purchase-amount"><strong>{formatMoney(purchase.total)}</strong><ChevronRight size={19} className={isExpanded ? 'purchase-arrow-open' : ''} /></div>
      </button>
      {isExpanded && <div className="purchase-detail"><div className="detail-heading"><span>ÜRÜN</span><span>MİKTAR</span><span>BİRİM</span><span>TOPLAM</span></div>{purchase.items.map((line, index) => <div className="detail-row" key={`${purchase.id}-${index}`}><strong>{line.product}</strong><span>{line.quantity} adet</span><span>{formatMoney(line.unitPrice)}</span><strong>{formatMoney(line.lineTotal)}</strong></div>)}<div className="detail-total"><span>İşlem toplamı</span><strong>{formatMoney(purchase.total)}</strong></div></div>}
    </article>;
  };

  return <div className="customer-page">
    <header className="customer-header">
      <div className="store-identity"><Store size={19} /><span>Ferhat Büfe</span></div>
      <img src="/silopi-dijital-logo.png" alt="Silopi Dijital" className="header-logo" width={168} height={48} decoding="async" />
      <button className="header-logout" onClick={onLogout}><LogOut size={16} /> Çıkış</button>
    </header>
    <main className="customer-main">
      <section className="customer-profile">
        <div className="customer-avatar"><UserRound size={24} /></div>
        <div className="profile-text"><h1>{customer.name}</h1><p>Veresiye Hesabım</p></div>
        <img src="/silopi-dijital-logo.png" alt="Silopi Dijital" className="profile-logo" width={140} height={40} decoding="async" />
      </section>
      <PushNotificationPanel sessionToken={sessionToken} />
      <section className="balance-card"><div className="balance-top"><span><WalletCards size={18} /> {customer.balance < -0.009 ? 'Mağazadaki Avansınız' : customer.balance > 0.009 ? 'Güncel Toplam Borç' : 'Güncel Bakiye'}</span><ShieldCheck size={18} /></div><strong>{formatMoney(Math.abs(customer.balance))}{customer.balance < -0.009 ? ' alacak' : ''}</strong><div className="balance-bottom"><span><Clock3 size={14} /> Son hareket: {customer.lastActivity}</span><span className="balance-status"><i /> Hesap aktif</span></div></section>

      <div className="section-title"><div className="section-title-label"><ShoppingBag size={22} /><div><h2>Açık Hesap</h2><p>Henüz ödemediğiniz alışverişler</p></div></div>{openPurchases.length > 0 && <span className="open-total-pill">{formatMoney(openTotal)}</span>}</div>
      <div className="purchase-list open-account-list">
        {openPurchases.length > 0
          ? openPurchases.map(renderPurchase)
          : <div className="empty-row customer-empty-row open-account-empty">Ödenmemiş alışverişiniz yok. Hesabınız temiz.</div>}
      </div>

      <div className="section-title"><div className="section-title-label"><CalendarDays size={22} /><div><h2>Geçmiş Alışverişler</h2><p>Ödenmiş veresiye alışverişleriniz</p></div></div>{closedPurchases.length > 10 && <button className="history-button" onClick={() => setShowAll((current) => !current)}>{showAll ? 'Daha az göster' : 'Tümünü gör'} <ChevronRight size={18} /></button>}</div>
      <div className="purchase-list">
        {visiblePurchases.map(renderPurchase)}
        {closedPurchases.length === 0 && <div className="empty-row customer-empty-row">Henüz ödenmiş alışveriş bulunmuyor.</div>}
      </div>

      <div className="customer-note"><div className="note-icon"><ShieldCheck size={21} /></div><div><strong>Bilgileriniz güvende</strong><p>Ödeme hareketleri bu ekranda gösterilmez. Ödemeler toplam borçtan düşülür; borç kapandığında alışverişler geçmişe taşınır.</p></div><ShieldCheck className="note-check" size={25} /></div>
    </main>
    <footer className="customer-footer"><span>SD Veresiye · Ferhat Büfe</span><span><LockKeyhole size={13} /> Güvenli bağlantı</span></footer>
  </div>;
}


function PushNotificationPanel({ sessionToken }: { sessionToken: string }) {
  const [busy, setBusy] = useState<'subscribe' | 'test' | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [diagnostics, setDiagnostics] = useState<PushDiagnostic[]>([]);
  const [checking, setChecking] = useState(true);
  const [enabledAfterClick, setEnabledAfterClick] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void collectDiagnostics(sessionToken).then((items) => {
      if (cancelled) return;
      setDiagnostics(items);
      setChecking(false);
    }).catch(() => {
      if (cancelled) return;
      setDiagnostics([]);
      setChecking(false);
    });
    return () => { cancelled = true; };
  }, [sessionToken]);

  const refresh = async () => {
    const items = await collectDiagnostics(sessionToken);
    setDiagnostics(items);
    return items;
  };

  const subscriptionReady = enabledAfterClick
    || diagnostics.some((item) => item.key === 'subscription' && item.status === 'ok');

  const handleSubscribe = async () => {
    setBusy('subscribe');
    setMessage('');
    try {
      const result = await subscribeToPush(sessionToken);
      setEnabledAfterClick(true);
      setMessageType('success');
      setMessage(result.message);
      setExpanded(false);
      await refresh();
    } catch (error) {
      setMessageType('error');
      setMessage(error instanceof Error ? error.message : 'Bildirim aboneliği oluşturulamadı.');
      await refresh().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setBusy('test');
    setMessage('');
    try {
      setMessageType('success');
      setMessage(await sendTestPush(sessionToken));
      setExpanded(true);
      await refresh();
    } catch (error) {
      setMessageType('error');
      setMessage(error instanceof Error ? error.message : 'Test bildirimi gönderilemedi.');
      setExpanded(true);
      await refresh().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };

  if (checking) {
    return <div className="notify-checking" role="status">Bildirim durumu kontrol ediliyor…</div>;
  }

  if (subscriptionReady) {
    return (
      <section className="notify-enabled" aria-label="Bildirim durumu">
        <div className="notify-enabled-summary">
          <span className="notify-enabled-icon"><CheckCircle2 size={17} /></span>
          <span className="notify-enabled-copy">
            <strong>Bildirimler açık</strong>
            <small>Bu cihaz yeni alışveriş ve ödeme hareketlerini alacak.</small>
          </span>
          <button
            type="button"
            className="notify-enabled-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Bildirim seçeneklerini gizle' : 'Bildirim seçeneklerini göster'}
          >
            {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        </div>
        {expanded && (
          <div className="notify-enabled-details">
            <div className="notify-test-row">
              <span>Bildirim bağlantısını kontrol etmek için test gönderin.</span>
              <button type="button" className="notify-test-button" onClick={() => void handleTest()} disabled={busy !== null}>
                <Bell size={15} /> {busy === 'test' ? 'Gönderiliyor…' : 'Test et'}
              </button>
            </div>
            {message && <p className={`notify-message notify-message-${messageType}`} role="status">{message}</p>}
            <details className="push-diagnostics">
              <summary>Bağlantı ayrıntıları</summary>
              <div className="push-diagnostics-list">
                {diagnostics.map((item) => (
                  <div className="push-diagnostic-row" key={item.key}>
                    <span className={`push-diagnostic-indicator push-diagnostic-${item.status}`} aria-hidden="true">
                      {item.status === 'ok' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                    </span>
                    <span className="push-diagnostic-label">{item.label}</span>
                    <small>{item.detail}</small>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </section>
    );
  }

  const denied = diagnostics.some((item) => item.key === 'permission' && item.status === 'error');
  if (denied) {
    return (
      <div className="notify-note" role="status">
        <Bell size={15} />
        <span>Bildirim izni tarayıcı ayarlarında kapalı. İzinleri açtıktan sonra bu ekrandan tekrar deneyebilirsiniz.</span>
      </div>
    );
  }

  return (
    <div className="notify-prompt-wrap">
      <button type="button" className="notify-prompt" onClick={() => void handleSubscribe()} disabled={busy !== null || !sessionToken}>
        <Bell size={18} />
        <span>
          <strong>{busy === 'subscribe' ? 'Bildirimler açılıyor…' : 'Bildirimleri aç'}</strong>
          Yeni alışveriş ve ödeme olduğunda haber verelim.
        </span>
        <ChevronRight size={18} />
      </button>
      {message && <p className={`notify-message notify-message-${messageType}`} role="alert">{message}</p>}
    </div>
  );
}
export default App;
