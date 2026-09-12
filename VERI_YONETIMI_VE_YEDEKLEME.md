# 🛡️ Veri Güvenliği, Kalıcılık & Yedekleme Rehberi

Bu sistemde hiçbir ders, öğrenci kaydı veya sistem ayarı **asla kaybolmaz**. Aşağıda verilerinizin nasıl güvence altında tutulduğu ve yönetildiği açıklanmıştır:

---

### 1. 📂 Veriler Nerede ve Nasıl Saklanıyor?
Tüm uygulama verileri projenin data/ dizininde JSON formatında kalıcı olarak saklanır:
- **data/blocks.json**: Takvimde kapalı olan saatler, öğrenciye rezerve edilen dersler ve geçmiş/gelecek tüm ders seansları.
- **data/requests.json**: Öğrencilerin web sitesinden gönderdiği tüm ders talepleri (onaylananlar, bekleyenler, reddedilenler).
- **data/config.json**: Haftalık çalışma saatleri, varsayılan ders süresi ve yönetici şifresi.
- **data/archive.json**: **Çöp Kutusu & Arşiv.** Takvimden silinen veya iptal edilen hiçbir ders kaydı kalıcı olarak yok edilmez; tarih, saat ve silinme nedeni ile buraya arşivlenir.

---

### 2. ⚡ Bozulmaz Atomik Yazma (Atomic Write Protection)
- Elektrik kesintisi, sunucu yeniden başlatılması veya sistem çökmesi durumunda dosyaların 0 bayta düşmesini ya da bozulmasını önlemek için **Atomik Yazma Teknolojisi** kullanılır.
- Veri önce geçici bir dosyaya (.tmp) yazılır, eksiksiz yazıldığı doğrulandıktan sonra anında asıl dosyanın üzerine geçirilir.
- Ayrıca her yazma öncesinde son çalışan halin acil durum yedeği (.bak) korunur.

---

### 3. ⏰ Otomatik Günlük Snapshot Yedekler (Auto-Backups)
- Sunucu her çalıştığında ve her 12 saatte bir data/backups/ klasörüne snapshot-YYYY-MM-DD.json adıyla tam sistem anlık görüntüsü alır.
- Son 30 günün yedekleri diskte otomatik olarak saklanır.

---

### 4. 🎛️ Yönetici Panelinden Tek Tıkla Yedekleme & Geri Yükleme
Admin panelinde (dmin.html) yeni eklenen **💾 Veri & Yedek** sekmesi üzerinden:
1. **📥 Tam Yedeği İndir (JSON):** Tek bir tıkla tüm takvim geçmişinizi, öğrenci kayıtlarınızı ve ayarlarınızı bilgisayarınıza .json dosyası olarak indirebilirsiniz.
2. **📤 Yedekten Geri Yükle:** Bilgisayarınızdaki herhangi bir yedeği sisteme yükleyerek takvimi o tarihteki haline saniyeler içinde döndürebilirsiniz.
3. **🗄️ Arşiv & Geri Yükleme:** Yanlışlıkla sildiğiniz herhangi bir dersi tek tıkla (**"🔄 Geri Yükle"**) butonuna basarak çakışma kontrolüyle takvime geri getirebilirsiniz.

---

### 5. 🌐 Canlıya (Hosting / Sunucuya) Geçerken Dikkat Edilmesi Gerekenler
- **Kendi VPS / Sunucunuz (Ubuntu, DigitalOcean, Hetzner, AWS EC2, cPanel Node.js):** Veriler doğrudan diskte saklandığı için hiçbir ek ayara gerek yoktur, verileriniz kalıcı olarak korunur.
- **Sunucusuz / Geçici Diskli Platformlar (Vercel, Render Free, Netlify):** Bu tür geçici disk kullanan platformlarda konteyner yeniden başladığında yerel disk sıfırlanabilir. Eğer Vercel veya Render'da barındıracaksanız; **Persistent Disk (Kalıcı Disk)** veya **MongoDB Atlas / Supabase** gibi ücretsiz bir bulut veritabanına bağlanması önerilir. Kendi sunucunuzda veya Node.js hostinginizde ise verileriniz doğrudan güvendedir.
