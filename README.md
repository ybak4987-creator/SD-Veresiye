# SD Veresiye

Ferhat Büfe müşterileri için **sadece okuma** veresiye portalı. Müşteri 6 haneli kodla girer, kendi bakiyesini ve alışverişlerini görür.

> **Bu sürümde yönetim paneli YOK.** Yönetici işlemleri (müşteri kodu oluşturma, kod gösterme, erişim açma/kapama) ProPOS uygulamasından yapılır. Portalın tek işi müşteriye hesabını göstermek.

---

## Hızlı başlangıç

```bash
npm install
cp .env.example .env       # VITE_DEMO_MODE=false bırak
npm run dev                # http://localhost:5173
npm run build              # dist/ üretir
npm run check              # tip kontrolü + build
```

Node 22.x gerekir.

---

## 1. Ne var

| Dosya | İş |
|---|---|
| `src/App.tsx` | Giriş ekranı + müşteri hesap ekranı (Açık Hesap / Geçmiş ayrımı) |
| `src/index.css` | Arayüz stilleri |
| `src/services/veresiyeApi.ts` | Veri katmanı — 3 fonksiyon, hata sınıfı, zaman aşımı, demo modu |
| `api/veresiye.ts` | Vercel sunucu fonksiyonu — Supabase'e giden tek yol |
| `vercel.json` | Rotalar + güvenlik başlıkları (CSP) |
| `public/` | İkonlar, manifest, service worker, robots |

### Bilinçli olarak YOK

- Yönetim paneli, admin girişi, `/admin` rotası
- `veresiye-portal-admin` çağrısı — sunucuda da kapalı (`ALLOWED_FUNCTIONS` içinde değil)
- Tarayıcıdan Supabase bağlantısı, `@supabase/supabase-js`
- Tarayıcı kodunda Supabase URL / anahtar / `service_role`
- IBAN, ödeme, tahsilat ekranı

---

## 2. Açık Hesap / Geçmiş Alışverişler

Sunucu "hangi alışveriş ödendi" bilgisini **vermiyor**. Ayrım tamamen bakiye + işlem tutarlarından yapılır:

```
borç = max(0, müşteri bakiyesi)
en yeni alışverişten geriye yürü
  borç kalmadıysa → dur
  alışverişi "Açık Hesap"a koy
  borç -= (tutar - iade)
  borç kalmadıysa → dur
kalan bütün alışverişler → "Geçmiş"
```

**Sonuç:** Hesap sıfırlandığında bütün eski alışverişler geçmişe düşer. Yeni bir alışveriş yapıldığında **yalnızca o alışveriş** Açık Hesap'ta görünür.

### Test sonuçları — 12/12 PASS

| Senaryo | Açık | Geçmiş |
|---|---|---|
| Sıfırlandı, sonra 1 yeni alışveriş (120) | yeni | 2 eski |
| Sıfırlandı, hiç alışveriş yok | — | 2 eski |
| Borçlu, tek alışveriş | 1 | — |
| Borçlu, kısmi ödeme (borç 100, işlemler 80+90) | 2 | — |
| Kısmi ödeme (borç 40, işlemler 80+90) | 1 | 1 |
| Tam ödeme | — | 2 |
| İadeli alışveriş (borç 50, 80-30 iade + 40) | 1 | 1 |
| İade borcu tamamen kapatır | — | 2 |
| Avans / negatif bakiye | — | 2 |
| Hiç alışveriş yok | — | — |
| Sıfırlandı + yeni + avans | — | 2 |
| Çok alışveriş, borç ortada (75, 50+50+50) | 2 | 1 |

> **Bilinmesi gereken:** Bu bir tahmindir. Kısmi ödemede hangi alışverişin kapandığı ProPOS'ta tutulmuyor; en yeniden geriye mantığı en tutarlı yaklaşımdır. İade (`refund`) alanı işlemden düşülür.

---

## 3. API sözleşmesi

Tarayıcı **yalnızca** kendi alan adına konuşur. Supabase'e giden tek yol `api/veresiye.ts`.

### `GET /api/veresiye/health`
```
200 { "success": true, "platform": "vercel", "proxy": "ready",
      "supabase_edge_function": "reachable" }
```

### `POST /api/veresiye/veresiye-portal-login`

```jsonc
// Kodla giriş
→ { "code": "123456" }
← 200 { "success": true, "session_token": "...", "expires_in": 2592000,
        "customer": { "id": "...", "name": "...", "balance": 245.00 },
        "transactions": [ { "id": "...", "date": "18.11.2026", "time": "19:42",
                            "total": 186.5, "refund": 0,
                            "items": [ { "product": "...", "quantity": 2,
                                         "unitPrice": 45, "lineTotal": 90 } ] } ] }

// Kayıtlı oturumla giriş (sayfa yenilendiğinde)
→ { "session_token": "..." }
← 200  (aynı yapı; yeni token döner, her açılışta yenilenir)
```

### Hata yanıtları — canlı test edildi

| Gönderilen | HTTP | Mesaj |
|---|---|---|
| `{}` | 401 | `Giriş kodu geçersiz veya erişim şu anda kapalı.` |
| `{"code":"000000"}` | 401 | `Giriş kodu geçersiz veya erişim şu anda kapalı.` |
| `{"code":"123"}` | 401 | `Giriş kodu geçersiz veya erişim şu anda kapalı.` |
| `{"code":"' OR 1=1--"}` | 401 | `Giriş kodu geçersiz veya erişim şu anda kapalı.` |
| `{"session_token":"sahte"}` | 401 | `Kayıtlı oturumun süresi dolmuş. Lütfen giriş kodunuzu yeniden girin.` |
| `{"fn":"veresiye-portal-admin"}` | **404** | `Bilinmeyen Veresiye API adresi.` |
| `GET .../veresiye-portal-login` | 405 | `Method not allowed.` |
| Aynı IP'den 5+ hatalı deneme | 429 | `Çok fazla hatalı deneme yapıldı. Lütfen 15 dakika sonra tekrar deneyin.` |

---

## 4. `veresiyeApi.ts` — dışa açılan sözleşme

```ts
checkPortalHealth(): Promise<PortalHealth>
customerLogin(code: string): Promise<CustomerLoginResult>
resumeCustomerSession(sessionToken: string): Promise<CustomerLoginResult>

class VeresiyeApiError extends Error {
  status: number; code?: string; retryAfterSeconds?: number;
  isRateLimited: boolean;      // 429
  isSessionInvalid: boolean;   // 401
}
```

---

## 5. Güvenlik

1. **Yönetim yüzeyi yok.** Admin rotası istemciden kaldırıldı, sunucuda da 404 döner. Saldırganın deneyecek bir yönetici girişi kalmadı.
2. **Müşteri `session_token`'ı imzalı ve 30 günlük.** `localStorage` anahtarı: `silopidijital-veresiye-session-v1`. "Beni hatırla" kapalıysa yazılmaz.
3. **Sunucu anahtarı ortam değişkeninden.** `SUPABASE_PUBLISHABLE_KEY` tanımlıysa kod içindeki varsayılan hiç kullanılmaz. `service_role` bu dosyaya asla yazılmaz.
4. **`VITE_API_BASE_URL` yalnızca boş veya `/` ile başlayan göreli yol.** Dış alan adı reddedilir — oturum belirteci üçüncü tarafa gitmesin, CSP'de `connect-src` istisnası açılmasın diye.
5. **CSP:** `default-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'`.
6. **`VITE_DEMO_MODE` production'da `false` olmalı.**

---

## 6. Demo modu

```bash
VITE_DEMO_MODE=true
```

- Hiçbir ağ isteği gitmez, herhangi 6 haneli kod çalışır
- `checkPortalHealth()` → `platform: 'demo'`
- Veriler `DEMO_LOGIN` sabitinden — **tamamı uydurma**

> 🔴 Demo modu açıkken gerçek müşteriye link verme.

---

## 7. Vercel'e yayın

1. GitHub'a yükle (`main` dalı)
2. Vercel → Add New → Project → depoyu seç
3. Framework: **Vite** · Build: `npm run build` · Output: `dist`
4. (İsteğe bağlı) Settings → Environment Variables → `SUPABASE_PUBLISHABLE_KEY`
5. Deploy sonrası kontrol: `https://<adres>/api/veresiye/health` → `200`

---

## 8. Veritabanı güvenliği — ayrı iş, hâlâ açık

Bu paket **veritabanı izinlerine dokunmuyor.** `customers`, `sales`, `sale_items`, `customer_payments`, `sale_returns` tablolarındaki anon erişimi hâlâ açık. `staff` tablosunda PIN'ler düz metin okunabiliyor.

Sıra: **ProPOS imzalı oturuma geçmeden tablo izinleri daraltılmamalı** — aksi hâlde kasa satış yapamaz (canlı testte doğrulandı).
