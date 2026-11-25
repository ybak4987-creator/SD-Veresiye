# SD Veresiye — yeni özellikler

Bu paket **repoyu baştan doldurmak için** hazırlandı. 32 dosya, hepsi gerekli.

## Bu sürümde yeni ne var

### 1. Açık Hesap / Geçmiş Alışverişler ayrımı

Müşteri ekranı ikiye ayrıldı:

- **Açık Hesap** — henüz ödenmemiş veresiye alışverişleri. Yeni alışveriş anında burada görünür.
- **Geçmiş Alışverişler** — ödenmiş olanlar. "Tümünü gör" ile hepsi açılır.

**Nasıl çalışıyor:** Borç ödendiğinde `balance` düşüyor, alışverişler kendiliğinden geçmişe kayıyor. Ek veritabanı alanı, ek API çağrısı yok.

**Sınır:** ProPOS ödemeyi tek toplam olarak düşürür, hangi alışverişin ödendiğini söylemez. Bu yüzden "en yeniden geriye doğru kapat" varsayımı kullanılıyor. Kısmi ödemede en yeni alışverişler açık görünür. Genelde doğru sonuç verir, garanti değildir.

### 2. Yönetim paneli yazıları okunur hâle geldi

Sayılar `DM Mono` yerine **Inter** ile, daha büyük ve kalın. Bakiye sütunu 11 px → 14 px, özet kart sayıları 22 px → 30 px.

### 3. Açılışta yükleme ekranı

Boş ekran yerine SD logosu + "Yükleniyor…" görünüyor, uygulama gelince kayboluyor.

### 4. Vercel proxy düzeltmesi

`api/veresiye/[function].ts` → `api/veresiye.ts` (sabit ad) + `vercel.json` içinde üç rewrite. Vercel köşeli parantezli dosya adını kabul etmiyordu.

---

## GitHub'a nasıl yüklersin

Repodaki **her şeyi sildiğini** söyledin. Bu paketi olduğu gibi yükle:

1. ZIP'i indir, sağ tık **"Tümünü ayıkla"**
2. GitHub'da reponu aç → **Add file** → **Upload files**
3. Ayıklanan klasörün **içindeki** her şeyi sürükle (32 dosya)
4. Commit mesajı: `SD Veresiye: acik hesap ozelligi, yazi tipi ve Vercel duzeltmesi`
5. **Commit changes**

> `.gitignore` ve `.env.example` gibi nokta ile başlayan dosyalar Windows'ta gizli görünebilir.
> Sürüklerken "Gizli öğeler" açık olsun. Yoksa sorun değil — Vercel `.env.example`
> olmadan da çalışır, `.gitignore` sadece düzen içindir.

### Dosya adında köşeli parantez var — dikkat

```
functions/api/veresiye/[name].js
```

Bu dosya **Cloudflare** sürümü. Vercel onu görmez, zararı yok. Yüklerken sorun çıkmaz;
sadece Windows'ta bazı sürükleme araçları `[ ]` karakterinde takılabilir. Takılırsa
bu tek dosyayı atla — Vercel için gerekli değil.

---

## Vercel ayarları

| Ayar | Değer |
|---|---|
| Framework | Vite (otomatik algılanır) |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm ci` |
| Region | `fra1` (vercel.json içinde) |

Ortam değişkeni **gerekmiyor**. `VITE_API_BASE_URL` boş kalsın, `VITE_DEMO_MODE` tanımlanmasın.

---

## Deploy sonrası kontrol

```
https://<domain>/api/veresiye/health
```

Beklenen:

```json
{ "success": true, "platform": "vercel", "proxy": "ready",
  "supabase_edge_function": "reachable" }
```

Sonra müşteri girişini dene: kod gir → **Açık Hesap** bölümünde ödenmemiş alışverişleri,
altında **Geçmiş Alışverişler**'i görmelisin.

---

## Doğrulama

| Kontrol | Sonuç |
|---|---|
| `tsc --noEmit -p tsconfig.app.json` | ✅ 0 hata |
| `tsc --noEmit -p tsconfig.api.json` | ✅ 0 hata |
| `vite build` | ✅ 205,49 kB JS / 50,18 kB CSS |
| `dist/` anahtar taraması | ✅ TEMİZ |
| Açık hesap mantığı | ✅ 8 senaryo, 8 doğru |
| `vercel.json` JSON | ✅ geçerli |

---

## Açık kalan iş — unutma

Veritabanı izinleri **hâlâ açık**. `customers`, `sales`, `sale_items`,
`customer_payments`, `sale_returns` tabloları publishable anahtarla okunabiliyor.
QR kodları dağıtmadan önce kapatılmalı.

ProPOS'un hangi rolle bağlandığı doğrulanmadan dokunmuyoruz — yanlış SQL kasayı durdurur.
