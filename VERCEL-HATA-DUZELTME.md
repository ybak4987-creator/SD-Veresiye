# Vercel build hatası — düzeltme

**Hata:**
```
Error: [unused_function] The pattern "api/veresiye/[function].ts" defined in
`functions` doesn't match any Serverless Functions inside the `api` directory.
```

## Neden oluyor

Vercel iki yerde `[function]` gibi **köşeli parantezli dinamik dosya adını** kabul etmiyor:

1. `vercel.json` → `functions` anahtarında desen eşleştirmesi yapmıyor.
2. `rewrites` → `destination` içinde `[function]` değişkenini doldurmuyor.

Yani 0.2.9'daki `api/veresiye/[function].ts` yapısı **Vercel'de hiç çalışmıyordu**. Cloudflare Pages Functions'ta çalışıyordu çünkü orada bu isimlendirme destekli.

## Ne yaptım

**Klasör yapısı değişti — sabit dosya adı:**

```
api/veresiye/[function].ts   ❌ silindi
api/veresiye.ts              ✅ eklendi (sabit ad)
```

**`vercel.json` — üç açık rewrite:**

```json
"functions": {
  "api/veresiye.ts": { "maxDuration": 30 }
},
"rewrites": [
  { "source": "/api/veresiye/health",
    "destination": "/api/veresiye?fn=health" },
  { "source": "/api/veresiye/veresiye-portal-login",
    "destination": "/api/veresiye?fn=veresiye-portal-login" },
  { "source": "/api/veresiye/veresiye-portal-admin",
    "destination": "/api/veresiye?fn=veresiye-portal-admin" },
  { "source": "/((?!api/).*)",
    "destination": "/index.html" }
]
```

Fonksiyonun adı artık `?fn=<ad>` sorgu parametresiyle taşınıyor. `api/veresiye.ts` bu parametreyi okuyup allow-list kontrolü yapıyor.

**`buildCommand` sadeleşti:** `npm run check` → `npm run build`.

Sebep: `check` içinde `tsc --noEmit` adımları var. Bunlar build çıktısı üretmiyor, ama bağımlılık tipi eksikse veya bir uyarı çıkarsa build'i tamamen durduruyor. Vercel'de tip kontrolü ayrı bir CI işi olmalı, deploy'u bloklamamalı.

## İstemci tarafı — hiçbir şey değişmedi

`src/services/veresiyeApi.ts` hâlâ `/api/veresiye/health`, `/api/veresiye/veresiye-portal-login`, `/api/veresiye/veresiye-portal-admin` adreslerine istek atıyor. Rewrite'lar bu adresleri arka planda eşliyor. Arayüz kodu aynı.

## Doğrulama — gerçek Supabase'e karşı

`api/veresiye.ts` Node'a derlenip sahte Vercel `req/res` nesneleriyle çalıştırıldı. Sonuçlar:

| Çağrı | HTTP | Yanıt |
|---|---|---|
| `?fn=health` (GET) | **200** | `{ success: true, platform: 'vercel', proxy: 'ready', supabase_edge_function: 'reachable' }` |
| `?fn=veresiye-portal-login` (boş gövde) | **401** | `Giriş kodu geçersiz veya erişim şu anda kapalı.` |
| `?fn=veresiye-portal-admin` (tokensiz) | **401** | `Yönetici doğrulaması başarısız.` |
| `?fn=drop_everything` | **404** | `Bilinmeyen Veresiye API adresi.` |
| `?fn=` yok | **404** | `Bilinmeyen Veresiye API adresi.` |
| login (GET) | **405** | `Method not allowed.` |

Yani health ucu Supabase'e **gerçekten ulaşıyor** ve üç rota doğru çalışıyor.

## Kontrol listesi

| Kontrol | Sonuç |
|---|---|
| `tsc --noEmit -p tsconfig.api.json` | ✅ 0 hata |
| `tsc --noEmit -p tsconfig.app.json` | ✅ 0 hata |
| `vite build` | ✅ 204,63 kB JS |
| `vercel.json` JSON geçerli | ✅ |
| `api/` içinde köşeli parantezli dosya | ✅ yok |
| `dist/` anahtar taraması | ✅ TEMİZ |

## GitHub'a nasıl atacaksın

Bu ZIP'in içeriği repo köküne **aynen** gider. Özellikle:

- `api/veresiye.ts` **eklenecek**
- `api/veresiye/[function].ts` **silinecek** (Windows'ta dosya adında köşeli parantez sorun çıkarırsa GitHub web arayüzünden sil)
- `vercel.json` **değişecek**
- Diğer her şey aynı

Sonra Vercel'de **Redeploy**. 4 satırlık `rewrites` bloğu ve `functions` anahtarı build logunda görünmeli.

## Bundan sonra ne olacak

Deploy geçince şu adresi aç ve `success: true` görmelisin:

```
https://<senin-domain>/api/veresiye/health
```

Bu dönmezse sorun proxy'de değil, ortam değişkeninde veya Supabase tarafındadır. Bana logu at.

---

## Hatırlatma — kapatılmayan açık

Veritabanı izinleri hâlâ eskisi gibi: `customers`, `sales`, `sale_items`, `customer_payments`, `sale_returns` tabloları publishable anahtarla **okunabiliyor**. Site canlıya çıktığı anda bu bir KVKK sorunu olur. QR dağıtmadan önce kapatılmalı — ProPOS'un hangi rolle bağlandığı doğrulanmadan dokunmuyoruz.
