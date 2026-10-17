/*
 * Translations for framebop.com.
 *
 * English is written directly in index.html, so the page reads well without
 * JavaScript and for search engines. Every element with data-i18n="key"
 * (and every attribute named in data-i18n-attr="attr:key") takes its text
 * from the dictionary below when another language is chosen; a missing key
 * falls back to English. Values may contain the same simple markup as the
 * English original (strong, code, links with data-repo).
 *
 * To add a language: copy the "tr" block under a new code (for example
 * "de"), translate every value, and add a button with data-lang="de" to the
 * language switch in index.html.
 */
window.FRAMEBOP_I18N = {
  tr: {
    "meta.title":
      "Framebop Studio: kendi bilgisayarınızda yapay zekâyla animasyonlu videolar",
    "meta.description":
      "Framebop Studio, kendi bilgisayarınızda çalışan yapay zekâyla animasyonlu videolar yapmanızı sağlayan ücretsiz ve açık kaynak bir uygulamadır. Hesap yok, abonelik yok, bulut yok.",

    skip: "İçeriğe geç",
    "brand.home": "Framebop Studio, ana sayfa",
    "nav.label": "Bölümler",
    "nav.how": "Nasıl çalışır",
    "nav.features": "Özellikler",
    "nav.showcase": "Videolar",
    "nav.privacy": "Gizlilik",
    "nav.faq": "SSS",
    "lang.label": "Dil",
    "github.label": "GitHub'da Framebop Studio",

    "art.script": "Senaryo",
    "art.voice": "Ses",

    "hero.badge": "Ücretsiz ve açık kaynak · Alfa",
    "hero.title":
      "Kendi bilgisayarınızda çalışan yapay zekâyla animasyonlu videolar yapın.",
    "hero.lede":
      "Fikirden bitmiş bir MP4'e: senaryo, sahneler, resimler, ses ve render, tek bir uygulamada.",
    "hero.noAccount": "Hesap yok",
    "hero.noSubscription": "Abonelik yok",
    "hero.noCloud": "Bulut yok",

    "cta.github": "GitHub'da incele",
    "cta.download": "Mac için indir",
    "cta.soon": "Yakında",
    "cta.note": `Henüz bir kurulum dosyası yok. Bugün Apple silicon'lu bir Mac'te
      <a href="#" data-repo="blob/main/README.md#quick-start">kaynak koddan derleyebilirsiniz</a>.`,

    "pipe.label": "Fikirden bitmiş videoya",
    "pipe.idea": "Fikir",
    "pipe.script": "Senaryo",
    "pipe.scenes": "Sahneler",
    "pipe.pictures": "Resimler",
    "pipe.animation": "Animasyon",
    "pipe.narration": "Anlatım",
    "pipe.timeline": "Zaman çizelgesi",
    "pipe.mp4": "Son MP4",

    "how.eyebrow": "Nasıl çalışır",
    "how.title": "Fikirden videoya üç adım.",
    "how.lede":
      "Senaryo, Sahneler, Video. Her yapay zekâ parçası tek bir düğmeyle hazırlanır ve indirme boyutunu önceden görürsünüz.",
    "how.chip": "AI taslağı",
    "how.s1.title": "Senaryo",
    "how.s1.text":
      "Hikâyenizi yazın ya da yapıştırın; isterseniz yapay zekâ projenizin dilinde bir taslak yazsın. Siz seçmedikçe senaryonuza hiçbir şey girmez.",
    "how.s2.title": "Sahneler",
    "how.s2.text":
      "Senaryoyu sahnelere bölün. Her sahneye yapay zekâyla yapılmış ya da sizin seçtiğiniz bir resim ve onu sesli okuyan bir ses gelir. Sırayı sürükleyerek değiştirin; düzenlemeler kendiliğinden kaydedilir.",
    "how.s3.title": "Video",
    "how.s3.text":
      "1080p ya da 720p bitmiş bir MP4 alın: yavaş kamera hareketleri, yazılar, altyazılar ve müzikle. Her dosya listelenmeden önce kontrol edilir.",

    "features.eyebrow": "Özellikler",
    "features.title": "Gerçek yapay zekâ motorları, kendi makinenizde.",
    "features.lede":
      "Framebop kendi motorlarını siz onay verince kurar ve her birini belirli bir sürüme sabitler. Hiçbir yapay zekâ modeli olmadan da başlayabilirsiniz.",
    "f.pictures.title": "Resimler",
    "f.pictures.text":
      "<strong>AI ile yap</strong>, Framebop'un kendi <span class='nowrap'>stable-diffusion.cpp</span> motoruyla sahneye bir resim çizer: Apple M4 Pro'da Stable Diffusion 1.5 ile 512 × 512 bir resim yaklaşık 24 saniye sürer. Daha büyük, daha yeni modeller ekleyebilir ya da kendi resminizi yükleyebilirsiniz.",
    "f.voice.title": "Ses",
    "f.voice.text":
      "<strong>AI ile oku</strong>, her sahneyi sherpa-onnx ses motoruyla seslendirir. Arayüzün her dili için bir ses var: İngilizce için Kokoro; Türkçe, Almanca, İspanyolca ve Brezilya Portekizcesi için Piper. Hiçbir sahne, anlatımı bitmeden kesilmez.",
    "f.script.title": "Senaryo taslakları",
    "f.script.text":
      "<strong>AI ile yaz</strong>, tek bir onayla llama.cpp ve Qwen3 4B'yi (2,5 GB) kurar ve projenizin dilinde bir senaryo taslağı yazar. Taslak, siz seçmedikçe senaryonuza girmez.",
    "f.render.title": "Render ve kontrol",
    "f.render.text":
      "Son videoyu Remotion 1080p ya da 720p olarak render eder (H.264, AAC ses). Ardından FFmpeg her dosyayı kontrol eder: süre, kare hızı, kodekler, her karenin açıldığı ve her anlatımın yerleştirildiği yerde duyulduğu. Aynı düzenleme her seferinde bayt bayt aynı dosyayı verir.",
    "f.models.title": "Modeller, sizin seçiminiz",
    "f.models.text":
      "Küçük ve gözden geçirilmiş bir katalog: her dosya boyutuna ve SHA-256 değerine sabitlenir, lisansı indirmeden önce gösterilir. Ya da ayrı ağırlık dosyaları olan herhangi bir Hugging Face deposunu getirin (ComfyUI tarzı ya da GGUF): parçaları siz onaylarsınız, yalnızca onlar indirilip kontrol edilir. Yarıda kalan indirmeler kaldığı yerden devam eder.",
    "f.models.tag": "Katalog + Hugging Face",
    "f.lab.title": "Video DNA Laboratuvarı",
    "f.lab.text":
      "Kendi YouTube Data API anahtarınızla örnek videoları inceleyin: herkese açık bilgiler, yorumlar ve kullanma hakkınız olan bir transkript; her bulgu dayandığı veriyi gösterir. Hikâye Mimarı bir fikri, düzenleyip onaylayacağınız bir taslağa ve sahnelere dönüştürür.",
    "f.lab.tag": "Araştırma · yerel dil modeli",
    "f.workshop": "Hâlâ atölyede",
    "f.clips.title": "Hareketli klipler",
    "f.experimental": "Deneysel",
    "f.clips.text":
      "<strong>Hareketlendir</strong>, sahnenin resmini Wan 2.2 TI2V 5B ile kısa bir klibe dönüştürür. Örnekleme Apple silicon'da çalışıyor, ama karelerin çözülmesi henüz işe yaramayacak kadar yavaş. Kendi kliplerinizi yüklemek bugün de çalışıyor.",
    "f.anim.title": "2D animasyon",
    "f.prototype": "Prototip",
    "f.anim.text":
      "Vektör ya da sprite karakterler ve kamera hareketleri için yerleşik bir motor; SVG ya da PixiJS ile çizilir. Şimdilik yalnızca test çizimli demo sahneler var.",

    "showcase.eyebrow": "Vitrin",
    "showcase.title": "Framebop ile yapılan videolar.",
    "showcase.lede":
      "Her biri yapanın kendi bilgisayarında yapıldı. Her videonun altında neyle yapıldığı yazıyor.",
    "showcase.emptyTitle": "Videonuz burada olabilir.",
    "showcase.emptyText":
      "Framebop Studio yeni, bu yüzden vitrin henüz boş. Framebop ile bir video mu yaptınız? GitHub Discussions'ta paylaşın; burada göstermeyi çok isteriz.",
    "showcase.note": `Framebop ile bir şey mi yaptınız? <a href="#" data-repo="discussions/categories/show-and-tell">GitHub Discussions'ta paylaşın</a>.`,
    "showcase.first": "İlk siz olun",
    "showcase.share": "Videonu paylaş",
    "showcase.madeWith": "Kullanılanlar",
    "showcase.by": "Yapan:",
    "gallery.seeAll": "Tüm videolar",
    "gallery.title": "Framebop ile yapılan videolar",
    "gallery.lede":
      "Hikâyeler, dersler ve denemeler; her biri yapanın kendi bilgisayarında yapıldı. Her videonun altında neyle yapıldığı yazıyor.",
    "gallery.share": "Videonu paylaş",
    "gallery.searchLabel": "Videolarda ara",
    "gallery.searchPlaceholder": "Başlık, yapan ya da konuyla ara",
    "gallery.narration": "Anlatım dili",
    "gallery.anyLanguage": "Tüm diller",
    "gallery.sort": "Sırala",
    "gallery.sortFeatured": "Öne çıkanlar",
    "gallery.sortNewest": "En yeni",
    "gallery.topics": "Konular",
    "gallery.allTopics": "Tümü",
    "gallery.count.one": "{n} video",
    "gallery.count.other": "{n} video",
    "gallery.none": "Aramanıza uyan video yok.",
    "gallery.clear": "Filtreleri temizle",
    "gallery.more": "Daha fazla göster",
    "gallery.featured": "Öne çıkan",
    "gallery.close": "Kapat",
    "gallery.copy": "Bağlantıyı kopyala",
    "gallery.copied": "Kopyalandı",
    "videos.meta.title": "Framebop Studio ile yapılan videolar",
    "videos.meta.description":
      "Framebop Studio ile, her biri yapanın kendi bilgisayarında yapılmış animasyonlu videolar ve her birinde kullanılan yapay zekâ modelleri.",

    // Topic names for the tags in showcase.js; a tag without one is shown
    // as written, with a capital first letter.
    "tag.story": "Hikâye",
    "tag.kids": "Çocuklar",
    "tag.education": "Eğitim",
    "tag.science": "Bilim",
    "tag.history": "Tarih",
    "tag.nature": "Doğa",
    "tag.music": "Müzik",
    "tag.fairy-tale": "Masal",
    "tag.experiment": "Deneme",

    "player.play": "Oynat",
    "player.seek": "Konum",
    "player.captions": "Altyazılar",
    "player.mute": "Sesi kapat",
    "player.fullscreen": "Tam ekran",

    "privacy.eyebrow": "Gizlilik",
    "privacy.title": "Hikâyeleriniz bilgisayarınızda kalır.",
    "privacy.lede":
      "Projeleriniz, promptlarınız ve medyanız makinenizden hiç çıkmaz; kurulumdan sonra Framebop internetsiz çalışır.",
    "privacy.local.title": "Her şey yerel",
    "privacy.local.text":
      "Uygulama, yapay zekâ motorları ve kütüphaneniz bilgisayarınızda durur. Render sırasında hiçbir ağ isteği yapılmaz.",
    "privacy.telemetry.title": "Telemetri yok",
    "privacy.telemetry.text":
      "Analiz yok, çökme raporu yok, hesap yok. Bu web sitesinde de izleyici ya da çerez yok.",
    "privacy.consent.title": "İndirme yalnızca onayınızla",
    "privacy.consent.text":
      "Motorlar ve modeller Hugging Face ve GitHub'dan yalnızca siz onayladıktan sonra, boyutları önceden gösterilerek iner. Hesap ya da token gerekmez.",
    "privacy.hash.title": "SHA-256 ile kontrol",
    "privacy.hash.text":
      "Her motor ve model belirli bir sürüme sabitlenir ve kullanılmadan önce yayımlanmış SHA-256 değeriyle karşılaştırılır.",
    "privacy.note":
      "Onayladığınız indirmeler dışında internete çıkan tek bölüm Video DNA Laboratuvarı'dır, o da yalnızca siz kullandığınızda: sisteminizin güvenli deposunda tutulan kendi anahtarınızla YouTube Data API'ye bağlanır.",

    "status.eyebrow": "Dürüst durum",
    "status.title": "Henüz erken aşamada; bunu saklamıyoruz.",
    "status.lede":
      "Framebop Studio alfa aşamasında. Yalnızca Apple silicon'lu macOS'ta geliştirilip test ediliyor; Windows ve Linux henüz test edilmedi.",
    "status.platforms": "Platformlar",
    "status.tested": "Test edildi",
    "status.appleNote":
      "Burada geliştirilip test ediliyor. Framebop'un kendi motorları bunun için sabitlendi.",
    "status.partly": "Kısmen",
    "status.intelNote":
      "Uygulamanın çalışması bekleniyor; Framebop'un kendi motorları henüz değil.",
    "status.windows": "Windows 10 ve 11",
    "status.notYet": "Henüz değil",
    "status.plannedNote":
      "Bunun için tasarlandı; henüz derlenmedi ve test edilmedi.",
    "status.alpha": "Burada alfa ne demek",
    "status.a1":
      "Henüz kurulum dosyası yok. Framebop'u Node.js, pnpm ve Rust ile kaynak koddan çalıştırırsınız.",
    "status.a2":
      "Render ve yapay zekâ yardımcıları geliştirme sürümünde çalışıyor; kurulan uygulamada render motoru henüz yok.",
    "status.a3":
      "Yapay zekâyla yapılan hareketli klipler henüz kullanılabilir değil; 2D animasyon bir prototip.",
    "status.a4":
      "macOS, Windows ve Linux için imzalı kurulum dosyaları planlanıyor.",
    "status.roadmap": "Yol haritasını okuyun",

    "open.eyebrow": "Açık kaynak",
    "open.title": "Apache 2.0 ile ücretsiz ve açık.",
    "open.p1":
      "Kodu okuyun, değiştirin, paylaşın. Motorlar küçük adaptörlerin arkasında durur; böylece yeni modeller ve altyapılar geri kalanına dokunmadan eklenebilir.",
    "open.p2":
      "Her boyutta katkıya açığız: gerçek kullanımdan hata bildirimleri, katalog için modeller, çeviriler, kod.",
    "open.contribute": "Nasıl katkı verilir",
    "open.engines": "Birlikte çalıştığı motorlar",
    "open.ffmpeg": "Sisteminizdeki kopya",
    "open.remotion": "Kendi lisansı, açık kaynak değil",
    "open.note":
      "Bunlar deponun parçası değildir ve kendi lisanslarını korur. Framebop onları yalnızca siz seçtiğinizde indirir ya da kullanır.",

    "faq.eyebrow": "SSS",
    "faq.title": "Sık sorulan sorular.",
    "faq.q1": "Ücretsiz mi?",
    "faq.a1": `Evet. Framebop Studio, Apache License 2.0 ile ücretsiz ve açık kaynaktır: hesap yok, abonelik yok.
      İndirdiğiniz yapay zekâ modellerinin her birinin kendi lisansı vardır ve her indirmeden önce gösterilir; bazıları
      ticari kullanımı kısıtlar. Son render <a href="https://www.remotion.dev/docs/license" rel="noopener">Remotion</a>
      ile yapılır ve Remotion açık kaynak değildir: bireyler, kâr amacı gütmeyen kuruluşlar, en fazla üç kişilik şirketler
      ve deneme için ücretsizdir; daha büyük şirketlerin Remotion şirket lisansı alması gerekir.`,
    "faq.q2": "Hangi bilgisayarlarda çalışır?",
    "faq.a2":
      "Bugün Apple silicon'lu Mac'lerde: geliştirme ve testler 24 GB belleğe sahip bir M4 Pro'da yapılıyor. Intel Mac'lerde uygulamanın çalışması bekleniyor, ama Framebop'un kendi yapay zekâ motorları orada henüz hazır değil. Windows 10, 11 ve Linux planlanıyor, ancak henüz derlenmedi ve test edilmedi.",
    "faq.q3": "Hangi yapay zekâ modellerini kullanıyor?",
    "faq.a3":
      "Resimler için stable-diffusion.cpp üzerinden Stable Diffusion 1.5; katalogdan ya da Hugging Face'ten daha büyük, daha yeni modeller de eklenebilir. Ses için sherpa-onnx üzerinden Kokoro ve Piper sesleri. Senaryo taslakları için llama.cpp üzerinden Qwen3 4B. Hareketli klipler için hâlâ deneysel olan Wan 2.2 TI2V 5B. Her modelin lisansı, indirmeden önce gösterilir.",
    "faq.q4": "İnternet gerekiyor mu?",
    "faq.a4":
      "Yalnızca seçtiğiniz motorları ve modelleri Hugging Face ve GitHub'dan indirmek için. Sonrasında <strong>AI ile yap</strong> ve <strong>AI ile oku</strong> internetsiz çalışır. İnternete çıkan tek bölüm Video DNA Laboratuvarı'dır; kendi anahtarınızla YouTube Data API'ye bağlanır.",
    "faq.q5": "Şimdi indirebilir miyim?",
    "faq.a5": `Henüz kurulum dosyası olarak değil; imzalı kurulum dosyaları planlanıyor. Bugün Apple silicon'lu bir Mac'te
      Node.js, pnpm ve Rust ile kaynak koddan derleyebilirsiniz:
      <a href="#" data-repo="blob/main/README.md#quick-start">hızlı başlangıç</a> adım adım anlatıyor.`,
    "faq.q6": "Dosyalarım nerede tutulur?",
    "faq.a6": `Bilgisayarınızdaki tek bir kütüphane klasöründe; Mac'te
      <code>~/Library/Application&nbsp;Support/com.framebop.studio</code>. İçe aktarılan dosyalar kopyalanır, asla
      taşınmaz; bitmiş videoların üzerine yazılmaz ve uygulama onları silmez.`,

    "closing.title":
      "Araçlarla uğraşmak değil, hikâye anlatmak isteyenler için.",
    "closing.build": "Kaynak koddan derle",

    "footer.tagline":
      "Kendi bilgisayarınızda, yapay zekâyla animasyonlu videolar.",
    "footer.label": "Proje bağlantıları",
    "footer.licence": "Lisans (Apache 2.0)",
    "footer.roadmap": "Yol haritası",
    "footer.contributing": "Katkı",
    "footer.security": "Güvenlik",
    "footer.legal":
      "Framebop Studio, Apache License 2.0 ile lisanslanmıştır. Son render için kullanılan Remotion, kendi lisansına sahip üçüncü taraf bir yazılımdır ve açık kaynak değildir.",
    "footer.copyright": "© 2026 Framebop Studio yazarları",
  },
};
