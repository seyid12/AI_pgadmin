# 🐘🧠 pgAdmin AI Pro (v1.0)

### Hibrit Yapay Zeka Destekli (Local + Cloud) Veri Analiz Platformu

![Docker](https://img.shields.io/badge/Docker-Container-blue?logo=docker) ![Python](https://img.shields.io/badge/Python-3.11-yellow?logo=python) ![Ollama](https://img.shields.io/badge/AI-Ollama%20Local-orange) ![Gemini](https://img.shields.io/badge/AI-Google%20Gemini-blue?logo=google) ![Status](https://img.shields.io/badge/Status-Experimental-red)

> **⚠️ UYARI (DISCLAIMER)**
> Bu proje, veritabanı yönetim araçlarına LLM entegrasyonunu test etmek amacıyla geliştirilmiş **deneysel (experimental)** bir Ar-Ge çalışmasıdır. `exec()` fonksiyonu kullanımı ve opsiyonel internet erişimi (Gemini modu için) nedeniyle güvenlik riskleri barındırabilir. **Production (Canlı/Kurumsal) ortamda kullanılması önerilmez.** Sadece geliştirme ve test ortamları içindir.

---

## 📖 Proje Hakkında

**pgAdmin AI Pro**, standart PostgreSQL yönetim aracı olan pgAdmin 4'ün, **Yapay Zeka** yetenekleri ile güçlendirilmiş özel bir versiyonudur.

Kullanıcılarına **Hibrit Bir Yapı** sunar:
1.  🔒 **Tam Gizlilik (Ollama):** Verileriniz bilgisayarınızdan çıkmadan, yerel `qwen2.5-coder` modeli ile analiz yapılır.
2.  ⚡ **Hız ve Performans (Google Gemini):** Daha karmaşık analizler veya anlık sonuçlar için Google'ın Gemini 2.5 Flash modelleri devreye girer.

Veri analistleri ve geliştiriciler, SQL bilmeseler dahi bu araçla veritabanlarıyla sohbet edebilir, grafikler çizebilir ve sorgu optimizasyonu yapabilirler.

---

## ✨ Temel Özellikler

### 1. 🤖 Hibrit AI Motoru (Seçim Sizin)
Sistemi başlatırken (veya kod içinden) hangi beyni kullanacağınızı seçebilirsiniz:
* **Local Mode:** İnternet gerekmez. Veri dışarı çıkmaz. Tamamen ücretsiz. (Ollama)
* **Cloud Mode:** Google Gemini API kullanır. Çok daha hızlıdır.

### 2. 📊 Otomatik Görselleştirme (`ciz:`)
SQL editörü içinde çalışan özel "Interceptor" mekanizması sayesinde:
* **Komut:** `ciz: satışların aylara göre dağılımını gösteren renkli bir pasta grafik yap.`
* **Sonuç:** Python (Matplotlib/Pandas) arka planda çalışır, veriyi çeker ve görseli üretir.

### 3. 🗣️ Text-to-SQL (Doğal Dil ile Sorgulama)
Karmaşık `JOIN` tablolarını ezberlemenize gerek yok.
* **Soru:** *"Hangi kategorideki filmler en uzun süreye sahip?"*
* **Sonuç:** AI şemayı okur ve çalışan doğru SQL kodunu yazar.

### 4. 🛠️ Akıllı SQL Düzeltici (`duzelt:`)
Hata veren sorguları analiz eder ve düzeltilmiş halini sunar.
* **Komut:** `duzelt: SELECT * FORMSAQ users` 
* **Çıktı:** `SELECT * FROM users`

### 5. 🚀 Performans Optimizasyonu (`hizlandir:`)
Yavaş çalışan sorgularınız için "Index" önerileri ve performans iyileştirmeleri sunar.

---

## 🛠️ Kurulum ve Çalıştırma

### Gereksinimler
* Docker Desktop
* (Opsiyonel) Google Gemini API Key

### Adım 1: İmajı Oluşturma (Build)

```bash
docker build -t pgadmin-ai-pro:v1.0 .
```
### Adım 2: Çalıştırma

```bash
docker run -d \
  --name pgadmin-ai-service \
  -p 8080:80 \
  -e "PGADMIN_DEFAULT_EMAIL=admin@admin.com" \
  -e "PGADMIN_DEFAULT_PASSWORD=admin" \
  -v pgadmin_ai_data:/var/lib/pgadmin \
  --restart always \
  pgadmin-ai-pro:v1.0
```

---

## 🖥️ Kullanım Rehberi

Tarayıcınızdan `http://localhost:8080` adresine gidin.  
**Giriş Bilgileri:** - **Email:** `admin@admin.com`  
- **Şifre:** `admin`

### 💡 Örnek Senaryolar

| Özellik | Komut Örneği |
| :--- | :--- |
| **SQL Üretme** | `Son 3 ayda en çok sipariş veren 5 müşteriyi listele` |
| **Grafik Çizme** | `ciz: Ürün kategorilerine göre stok miktarlarını gösteren bar grafik.` |
| **Hata Düzeltme** | `duzelt: SELECT name form customer wher id=5` |
| **Hızlandırma** | `hizlandir: SELECT * FROM logs WHERE log_date > '2023-01-01'` |

---

## 🏗️ Teknik Mimari

Proje, **Dockerize Edilmiş Monolitik** bir yapı kullanır ancak iç mimarisi modülerdir:

1.  **Request Interceptor:** pgAdmin'in `sqleditor/__init__.py` dosyası modifiye edilmiştir. SQL sorgusu çalışmadan önce araya girer ve komutu analiz eder.
2.  **AI Router:** `AI_PROVIDER` ortam değişkenine göre isteği ya **Google Gemini API**'ye ya da lokal **Ollama** servisine yönlendirir.
3.  **Code Execution Sandbox:** AI tarafından üretilen Python kodu, sistemdeki geçici bir alanda çalıştırılır. `Matplotlib` ve `Pandas` kullanılarak grafik çizilir ve sonuç bir HTML linki olarak kullanıcıya döner.



---

## 🔮 Gelecek Planları (Roadmap)

- [ ] **Sandbox Güvenliği:** `exec()` yerine izole edilmiş, kısıtlı yetkilere sahip güvenli Python ortamına geçilmesi.
- [ ] **Dashboard Modu:** Grafiklerin sorgu geçmişi yerine, kullanıcıya özel bir panelde (Dashboard) toplanması.
- [ ] **Mikroservis Mimarisi:** AI motorunun pgAdmin'den tamamen ayrılarak bağımsız bir API servisi haline getirilmesi.

---

## 👨‍💻 Geliştirici Notu

Bu proje, **"Chat with your Data"** (Verinizle Sohbet Edin) konseptinin yerel ve hibrit yöntemlerle nasıl uygulanabileceğini gösteren bir kavram kanıtıdır (PoC). Geliştirme sürecinde açık kaynak kodlu pgAdmin 4 altyapısı özelleştirilerek yapay zeka entegrasyonu sağlanmıştır.

- **Lisans:** MIT / pgAdmin License  
- **Sürüm:** v1.0 (Experimental)
