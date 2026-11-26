# SD Veresiye

Ferhat Büfe müşterileri için veresiye hesap portalı. Arayüz **SilopiDijital Veresiye 0.2.9**'dan taşındı; veri katmanı `src/services/veresiyeApi.ts`.

---

## Hızlı başlangıç

```bash
npm install
cp .env.example .env     # VITE_DEMO_MODE=false bırak
npm run dev              # http://localhost:5173        (müşteri)
                         # http://localhost:5173/admin  (yönetici)
npm run build            # dist/ üretir
```

Node 22.x gerekir.

---

## Ne değişti — 0.2.9 → SD Veresiye

### Arayüz birebir taşındı

`src/App.tsx` ve `src/index.css` 0.2.9'dan **aynen** alındı: aynı giriş ekranı, aynı müşteri hesap ekranı, aynı yönetici paneli, aynı QR modalı, aynı renkler ve tipografi. `tailwind.config.js` ve `postcss.config.js` de taşındı (`index.css` Tailwind direktifleri kullanıyor).

Taşınan tek bağımlılık: `qrcode` + `@types/qrcode` (QR modalı için).

### Değişen tek satır:import yolu

```diff
- } from '@/lib/veresiye';
+ } from '@/services/veresiyeApi';
```

Sebep: `veresiyeApi.ts`, 0.2.9'un `src/lib/veresiye.ts` dosyasının **genişletilmiş ve güvenlik açısından sıkılaştırılmış** sürümü. Fonksiyon imzaları birebir aynı, bu yüzden arayüzde başka hiçbir değişiklik gerekmedi.

### İsim: SilopiDijital Veresiye → SD Veresiye

| Yer | Değer |
|---|---|
| `index.html` `<title>` | `SD Veresiye · Ferhat Büfe` |
| `apple-mobile-web-app-title`, `og:title` | `SD Veresiye` |
| `manifest.webmanifest` `name` / `short_name` | `SD Veresiye` |
| Müşteri sayfası alt bilgi | `SD Veresiye · Ferhat Büfe` |
| QR modal başlığı | `SD Veresiye` |
| İndirilen QR dosyası | `sd-veresiye-qr.png` |
| `/admin` sekme başlığı | `SD Veresiye · Yönetim` |
| `package.json` `name` | `sd-veresiye` |

### Düzeltilen derleme hatası — görüntü sorununun asıl nedeni

**Belirti:** Build çıktısı 33 KB kalıyordu ve arayüz metinleri JS içinde **hiç yoktu**. Yani uygulama açıldığında boş sayfa görünüyordu.

**Kök neden:** `vite.config.ts` içindeki `optimizeDeps: { exclude: ['lucide-react'] }`. Bu ayar lucide-react'in önceden paketlenmesini engelliyor; production build'de ağaç sallama (tree-shaking) tüm bileşen ağacını "kullanılmıyor" sayıp atıyordu.

**Düzeltme:** `exclude` kaldırıldı, `build.commonjsOptions.transformMixedEsModules: true` eklendi.

| | Önce | Sonra |
|---|---|---|
| JS boyutu | 33,67 kB | **204,63 kB** |
| `dist` içinde "QR indir" | ❌ yok | ✅ var |
| `dist` içinde "Erişimi kapat" | ❌ yok | ✅ var |
| `dist` içinde "Yönetici girişi" | ❌ yok | ✅ var |

### `React.StrictMode` kaldırıldı

`<StrictMode><App /></StrictMode>` biçimi, sarmalayıcı bir `Root` bileşeniyle birlikte kullanıldığında tree-shaking'i yine bozuyordu (204 kB → 33 kB). Artık `createRoot(...).render(<Root />)` doğrudan çağrılıyor. Üretim davranışı aynı; sadece StrictMode'un geliştirme uyarıları yok.

---

## 1. Ne var, ne yok

### ✅ Hazır ve doğrulanmış

| Dosya | Durum |
|---|---|
| `src/App.tsx` | 0.2.9 arayüzü, `SD Veresiye` adıyla |
| `src/index.css` | 0.2.9 stilleri (44 kB) |
| `src/services/veresiyeApi.ts` | Veri katmanı: 3 rota, 5 yönetici işlemi, hata sınıfı, timeout, demo modu |
| `public/_headers` | Cloudflare Pages CSP + güvenlik başlıkları |
| `api/veresiye/[function].ts` | Vercel proxy (0.2.9'dan aynen) |
| `functions/api/veresiye/[name].js` | Cloudflare proxy (0.2.9'dan aynen) |
| `vercel.json`, `wrangler.toml` | Yayın yapılandırması |

### 🔒 Bilinçli olarak YOK

- Supabase tablolarına doğrudan bağlantı
- `@supabase/supabase-js` ile doğrudan sorgu
- Supabase URL / publishable key / service_role tarayıcı kodunda
- Veritabanı izinlerine müdahale

---

## 2. API sözleşmesi (canlı test sonuçlarıyla)

Aşağıdaki davranışlar ilgili Supabase fonksiyonları üzerinde **gerçekten test edildi**:

### `GET /api/veresiye/health`
```
200 { "success": true, "platform": "cloudflare-pages", "proxy": "ready",
      "supabase_edge_function": "reachable" }
```

### `POST /api/veresiye/veresiye-portal-login`

**Kodla giriş:**
```
→ { "code": "123456" }
← 200 { "success": true, "session_token": "...", "expires_in": 2592000,
       "customer": { "id": "...", "name": "...", "balance": 245.00 },
       "transactions": [ { "id": "...", "date": "18.11.2026", "time": "19:42",
                           "total": 186.5,
                           "items": [ { "product": "...", "quantity": 2,
                                        "unitPrice": 45, "lineTotal": 90 } ] } ] }
```

**Kayıtlı oturumla giriş:**
```
→ { "session_token": "..." }
← 200 (aynı yapı, yeni session_token döner — token her başarılı açılışta yenilenir)
```

**Gerçek hata yanıtları (test edildi):**

| Gönderilen | HTTP | Mesaj |
|---|---|---|
| `{}` (boş) | 401 | `Giriş kodu geçersiz veya erişim şu anda kapalı.` |
| `{"code":"000000"}` | 401 | `Giriş kodu geçersiz veya erişim şu anda kapalı.` |
| `{"code":"12345"}` (5 hane) | 401 | `Giriş kodu geçersiz veya erişim şu anda kapalı.` |
| `{"session_token":"a.b.c"}` | 401 | `Kayıtlı oturumun süresi dolmuş. Lütfen giriş kodunuzu yeniden girin.` |
| Aynı IP'den 5+ hatalı deneme | 429 | `Çok fazla hatalı deneme yapıldı. Lütfen 15 dakika sonra tekrar deneyin.` |

> ⚠️ **Bulgu:** 5 haneli kod bile "geçersiz kod" mesajı alıyor — format kontrolü yalnızca istemcide. `veresiyeApi.ts` bunu `^\d{6}$` ile kapatıyor; yoksa hatalı deneme sayacı boşa şişer.

### `POST /api/veresiye/veresiye-portal-admin`

| `action` | Gönderilecek | Dönen |
|---|---|---|
| `login` | `{ admin_pin }` | `{ admin_token, admin_name, expires_in: 1800 }` |
| `list_customers` | `{ admin_token }` | `{ customers: [{ id, name, balance, last_activity, is_active, has_code, last_login_at }] }` |
| `set_active` | `{ admin_token, customer_id, active }` | `{ is_active, has_code }` |
| `reveal_code` | `{ admin_token, customer_id }` | `{ code: "123456" }` |
| `rotate_code` | `{ admin_token, customer_id }` | `{ success: true }` |

**Hata yanıtları (test edildi):** PIN'siz, token'sız ve bilinmeyen `action` — üçü de `401 Yönetici doğrulaması başarısız.`

> ✅ `list_customers` token olmadan **çalışmıyor**. Bilinmeyen `action` reddediliyor.

---

## 3. `veresiyeApi.ts` — dışa açılan sözleşme

```ts
checkPortalHealth(): Promise<PortalHealth>
customerLogin(code: string): Promise<CustomerLoginResult>
resumeCustomerSession(sessionToken: string): Promise<CustomerLoginResult>
signInAdmin(pin: string): Promise<AdminSession>
loadAdminCustomers(token: string): Promise<Customer[]>
setCustomerActive(token: string, id: string, active: boolean): Promise<Customer>
revealCustomerCode(token: string, id: string): Promise<string>
rotateCustomerCode(token: string, id: string): Promise<void>
signOutAdmin(): Promise<void>

class VeresiyeApiError extends Error {
  status: number; code?: string; retryAfterSeconds?: number;
  isRateLimited: boolean;      // 429
  isSessionInvalid: boolean;   // 401
}
```

---

## 4. Güvenlik kuralları

1. **Yönetici token'ı yalnızca bellekte.** `localStorage` / `sessionStorage` / cookie — hiçbirine yazılmaz. Sayfa yenilenirse PIN yeniden girilir.
2. **Müşteri `session_token`'ı kalıcı olabilir** (30 gün, imzalı). `localStorage` anahtarı: `silopidijital-veresiye-session-v1`.
3. `reveal_code` sonucu bellekte tutulur, sayfa kapanınca atılır.
4. `service_role` hiçbir koşulda istemciye inmez.
5. `VITE_DEMO_MODE` production'da **false** olmalı.

### `VITE_API_BASE_URL` — sadece iki değer kabul edilir

| Değer | Sonuç |
|---|---|
| boş / tanımsız | ✅ same-origin (önerilen) |
| `/proxy`, `/api` | ✅ göreli yol, aynı kökende |
| `//kotu.com` | ❌ reddedilir |
| `http://example.com` | ❌ reddedilir |
| `https://api.baska.com` | ❌ reddedilir (dış alan adı) |
| `https://<proje-ref>.supabase.co` | ❌ reddedilir |
| `https://user:pass@host` | ❌ reddedilir |
| `kotu.com` (şemasız) | ❌ reddedilir |

**Dış alan adı bilinçli olarak reddediliyor:** dış adres hem oturum belirteçlerini üçüncü tarafa göndermeyi hem de CSP'de `connect-src` istisnası açmayı gerektirir. Ayrı bir API alan adı gerekiyorsa önce ters vekil ile `/api/veresiye/*` aynı köken altına alınmalı.

**Test:** 10 senaryo, 10 geçti.

### Yönetici çıkışı — bilinen sınır

`signOutAdmin()` sunucudaki token'ı **iptal etmez.** `admin_token` HMAC imzalı ve 30 dakikalık; sunucuda iptal listesi yok.

- Çıkış → sadece arayüz state'i temizlenir
- Token'ı ele geçiren biri, 30 dakika dolana kadar kullanabilir
- Gerçek anlık iptal gerekirse Edge Function'a `action: 'logout'` + `staff.token_version` eklenmeli — ayrı iş

---

## 5. Cloudflare Pages başlıkları — `public/_headers`

**Kritik:** `vercel.json` içindeki başlıklar **Cloudflare Pages'e taşınmaz.** Cloudflare'in mekanizması `public/_headers`; Vite build sırasında `dist/_headers` içine kopyalar.

### Doğrulama (gerçek build çıktısı)

| Kontrol | Sonuç |
|---|---|
| `dist/_headers` üretildi mi | ✅ 1108 bayt |
| `connect-src 'self'` var mı | ✅ |
| `_headers` içinde anahtar sızıntısı | ✅ yok |

### Sınır

`_headers` **Pages Functions yanıtlarını kapsamaz.** Bu projede `/api/veresiye/*` yanıtları JSON ve güvenlik başlıklarını fonksiyon kendisi ayarlıyor (`Cache-Control: no-store`, `nosniff`). HTML/CSS/JS döndüren bir Function yok. İleride eklenirse CSP'yi o `Response`'a elle koymak zorunlu.

---

## 6. Demo modu

```bash
VITE_DEMO_MODE=true
```

- Hiçbir ağ isteği gitmez
- Herhangi 6 haneli kod çalışır
- `checkPortalHealth()` `platform: 'demo'` döner
- Veriler `DEMO_*` sabitlerinden gelir — **tamamı uydurma**

> 🔴 Demo modu açıkken gerçek müşteriye link verme.

> Not: Taşınan 0.2.9 arayüzünde demo rozeti yok (arayüz değiştirilmedi). Demo modunu yalnızca kendi testinde kullan.

---

## 7. Doğrulanamayanlar (dürüst not)

- `/api/veresiye/*` proxy rotalarının canlı deploy'daki davranışı test edilmedi — ZIP'teki kaynak ile canlı sürümün aynı olduğu varsayıldı.
- Gerçek müşteri kodu ile uçtan uca giriş yapılmadı.
- Yönetici PIN'i ile başarılı `login` senaryosu test edilmedi.

---

## 8. Veritabanı güvenlik işi — ayrı iş

Bu paket **veritabanı izinlerine dokunmuyor.** `customers`, `sales`, `sale_items`, `customer_payments`, `sale_returns` tablolarındaki anon okuma erişimi **hâlâ açık**; portal yayına alınmadan önce kapatılmalı.

`USING(false)` ile yeni bir permissive politika eklemek eski izinleri kapatmaz (permissive = OR, restrictive = AND). Doğru yaklaşım:

```sql
-- 1) Önce mevcut politikaları OKU (hiçbir şeyi değiştirme)
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('customers','sales','sale_items','customer_payments','sale_returns')
ORDER BY tablename, policyname;

-- 2) ProPOS'un hangi rolle bağlandığını gör
SELECT usename, count(*) FROM pg_stat_activity GROUP BY usename;
```

Bu iki sorgunun çıktısı görülmeden **hiçbir izin değiştirilmemeli.** Aksi hâlde kasa durur.
