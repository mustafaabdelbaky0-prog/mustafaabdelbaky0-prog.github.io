/* مولّد موقع المحل.

   البرنامج هو لوحة التحكم: صاحب المحل بيكتب ويحط الصور، والملف ده
   بيحوّل كلامه لموقع كامل (صفحة واحدة ثابتة) بيتنشر على النت.

   ليه صفحة ثابتة مكتوبة بالكامل مش صفحة بتقرا بياناتها وقت الفتح؟
   عشان فيسبوك وجوجل بيقروا الـ HTML نفسه — لو الكلام مش مكتوب جواه
   الشير على الفيسبوك بيطلع فاضي من غير صورة ولا عنوان.

   الطلب: الزبون بيملا اسمه وتليفونه وعنوانه ويدوس "إتمام الشراء"
   فالطلب بيتبعت في الخلفية وبيشوف "تم" في نفس الصفحة — من غير ما
   تفتحله أي تطبيق تاني. */
const SiteGen = (() => {

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const money = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const digits = s => String(s || '').replace(/[^\d+]/g, '');

  // ---------- اللي بيتحط أول مرة عشان ما يبدأش من صفحة بيضا ----------
  function defaults(company) {
    const c = company || {};
    return {
      enabled: false,
      brand: {
        name: c.name || 'مؤسسة المصطفى للأدوات الكهربائية والحدايد',
        tagline: 'كل اللي البيت والورشة محتاجينه — كهرباء وحدايد ومفاتيح',
        phone: c.phone || '', phone2: '', whatsapp: c.phone || '',
        address: c.address || '', mapUrl: '', facebook: '',
        hours: 'السبت – الخميس: ٩ ص – ١٠ م   |   الجمعة: ٢ م – ١٠ م'
      },
      banner: '',
      hero: {
        title: 'أدوات كهربائية وحدايد — بسعر التاجر',
        subtitle: 'لمبات، أسلاك، مفاتيح وبرايز، عدد وأدوات، ومفاتيح شقق وسيارات. بضاعة أصلية وأسعار جملة للأسطوات.',
        image: ''
      },
      features: [
        { icon: '🚚', title: 'توصيل للمنطقة', text: 'اطلب وإحنا نوصّلك — كلّمنا نتفق على الميعاد' },
        { icon: '🏷️', title: 'أسعار جملة للأسطوات', text: 'بنتعامل مع الفنيين والمقاولين بأسعار خاصة' },
        { icon: '🔑', title: 'مفاتيح فوري', text: 'نسخ مفاتيح شقق وسيارات وكمبيوتر في دقايق' },
        { icon: '✅', title: 'بضاعة مضمونة', text: 'ماركات معروفة، ولو فيها عيب بنستبدلها' }
      ],
      about: 'محل متخصص في الأدوات الكهربائية والحدايد، بنخدم البيوت والورش والفنيين. عندنا كل المستلزمات من اللمبة لحد لوحة الكهرباء، وبنساعدك تختار الصح لشغلك.',
      products: [],
      offers: [],
      order: {
        relayUrl: '',
        note: 'هنكلّمك على التليفون نأكد الطلب والتوصيل.',
        areas: ''
      },
      seo: { title: '', description: '' }
    };
  }

  // البيانات اللي البرنامج حافظها ممكن تكون ناقصة خانة اتضافت بعدين
  function normalize(site, company) {
    const d = defaults(company);
    const s = Object.assign({}, d, site || {});
    s.brand = Object.assign({}, d.brand, (site && site.brand) || {});
    s.hero = Object.assign({}, d.hero, (site && site.hero) || {});
    s.order = Object.assign({}, d.order, (site && site.order) || {});
    s.seo = Object.assign({}, d.seo, (site && site.seo) || {});
    s.features = (site && site.features) || d.features;
    s.products = (site && site.products) || [];
    s.offers = (site && site.offers) || [];
    return s;
  }

  // ---------- أجزاء الصفحة ----------
  function productCard(p) {
    const price = Number(p.price || 0);
    return `
      <article class="card" data-name="${esc(p.name)}" data-price="${price}">
        <div class="card-img">${p.image
          ? `<img src="img/${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`
          : `<div class="noimg">📦</div>`}</div>
        <div class="card-body">
          <h3>${esc(p.name)}</h3>
          ${p.desc ? `<p class="card-desc">${esc(p.desc)}</p>` : ''}
          <div class="card-foot">
            <span class="price">${money(price)} <small>ج.م${p.unit ? ' / ' + esc(p.unit) : ''}</small></span>
            <button type="button" class="add" data-name="${esc(p.name)}" data-price="${price}">أضف للطلب</button>
          </div>
        </div>
      </article>`;
  }

  function offerCard(o) {
    const price = Number(o.price || 0), old = Number(o.oldPrice || 0);
    const off = (old > price && price > 0) ? Math.round((1 - price / old) * 100) : 0;
    return `
      <article class="offer">
        ${off > 0 ? `<span class="badge-off">خصم ${off}%</span>` : ''}
        <div class="offer-img">${o.image
          ? `<img src="img/${esc(o.image)}" alt="${esc(o.title)}" loading="lazy">`
          : `<div class="noimg">🏷️</div>`}</div>
        <div class="offer-body">
          <h3>${esc(o.title)}</h3>
          ${o.desc ? `<p>${esc(o.desc)}</p>` : ''}
          <div class="offer-foot">
            ${price > 0 ? `<span class="price">${money(price)} <small>ج.م</small></span>` : ''}
            ${old > price && price > 0 ? `<span class="old">${money(old)}</span>` : ''}
            ${price > 0 ? `<button type="button" class="add" data-name="${esc(o.title)}" data-price="${price}">أضف للطلب</button>` : ''}
          </div>
          ${o.until ? `<div class="until">العرض لحد ${esc(o.until)}</div>` : ''}
        </div>
      </article>`;
  }

  function build(siteRaw, company) {
    const s = normalize(siteRaw, company);
    const b = s.brand;
    const cats = [...new Set(s.products.map(p => String(p.category || '').trim()).filter(Boolean))];
    const tel = digits(b.phone), tel2 = digits(b.phone2), wa = digits(b.whatsapp || b.phone);
    const title = s.seo.title || (b.name + (b.tagline ? ' — ' + b.tagline : ''));
    const desc = s.seo.description || s.hero.subtitle || b.tagline;
    const ogImg = s.hero.image || (s.products.find(p => p.image) || {}).image || '';

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${ogImg ? `<meta property="og:image" content="img/${esc(ogImg)}">` : ''}
<meta name="theme-color" content="#0F2438">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="site.css">
<script type="application/ld+json">
${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'HardwareStore',
  name: b.name, description: desc,
  telephone: b.phone || undefined,
  address: b.address ? { '@type': 'PostalAddress', streetAddress: b.address } : undefined,
  openingHours: b.hours || undefined
}, null, 1)}
</script>
</head>
<body>

${s.banner ? `<div class="topnote">${esc(s.banner)}</div>` : ''}

<header class="bar">
  <div class="wrap bar-in">
    <a class="logo" href="#">
      <span class="mark">⚡</span>
      <span class="logo-txt"><strong>${esc(b.name)}</strong>${b.tagline ? `<small>${esc(b.tagline)}</small>` : ''}</span>
    </a>
    <nav class="menu">
      <a href="#products">المنتجات</a>
      ${s.offers.length ? '<a href="#offers">العروض</a>' : ''}
      <a href="#about">من إحنا</a>
      <a href="#contact">اتصل بنا</a>
    </nav>
    <button type="button" id="cartBtn" class="cart-btn">🛒 <span id="cartCount">0</span></button>
  </div>
</header>

<section class="hero"${s.hero.image ? ` style="background-image:linear-gradient(90deg,rgba(15,36,56,.93),rgba(15,36,56,.72)),url('img/${esc(s.hero.image)}')"` : ''}>
  <div class="wrap hero-in">
    <h1>${esc(s.hero.title)}</h1>
    <p>${esc(s.hero.subtitle)}</p>
    <div class="hero-cta">
      <a class="btn btn-amber" href="#products">شوف المنتجات</a>
      ${tel ? `<a class="btn btn-ghost" href="tel:${esc(tel)}">📞 ${esc(b.phone)}</a>` : ''}
    </div>
  </div>
</section>

${s.features.length ? `
<section class="feats"><div class="wrap feats-in">
  ${s.features.map(f => `
  <div class="feat">
    <span class="fi">${esc(f.icon)}</span>
    <div><strong>${esc(f.title)}</strong><span>${esc(f.text)}</span></div>
  </div>`).join('')}
</div></section>` : ''}

${s.offers.length ? `
<section id="offers" class="sec sec-warm">
  <div class="wrap">
    <div class="sec-head"><h2>🏷️ عروض النهاردة</h2><p>أسعار خاصة لفترة محدودة</p></div>
    <div class="offers">${s.offers.map(offerCard).join('')}</div>
  </div>
</section>` : ''}

<section id="products" class="sec">
  <div class="wrap">
    <div class="sec-head"><h2>المنتجات</h2><p>اختار اللي محتاجه وضيفه للطلب — وإحنا نكلمك نأكد</p></div>
    ${cats.length > 1 ? `
    <div class="cats">
      <button type="button" class="cat on" data-cat="">الكل</button>
      ${cats.map(c => `<button type="button" class="cat" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>` : ''}
    ${s.products.length
      ? `<div class="grid" id="grid">${s.products.map(p =>
          `<div class="cell" data-cat="${esc(p.category || '')}">${productCard(p)}</div>`).join('')}</div>`
      : `<p class="empty">لسه بنجهّز المنتجات — كلّمنا وإحنا نقولك على كل اللي عندنا.</p>`}
  </div>
</section>

<section id="about" class="sec sec-dark">
  <div class="wrap about-in">
    <div>
      <h2>من إحنا</h2>
      <p>${esc(s.about)}</p>
      ${b.hours ? `<p class="hours">🕘 ${esc(b.hours)}</p>` : ''}
    </div>
    <div class="about-box">
      ${b.address ? `<div class="ab"><span>📍</span><div><strong>العنوان</strong>${esc(b.address)}</div></div>` : ''}
      ${b.phone ? `<div class="ab"><span>📞</span><div><strong>تليفون</strong><a href="tel:${esc(tel)}">${esc(b.phone)}</a></div></div>` : ''}
      ${b.phone2 ? `<div class="ab"><span>📱</span><div><strong>تليفون تاني</strong><a href="tel:${esc(tel2)}">${esc(b.phone2)}</a></div></div>` : ''}
      ${b.mapUrl ? `<a class="btn btn-amber sm" href="${esc(b.mapUrl)}" target="_blank" rel="noopener">افتح الخريطة</a>` : ''}
    </div>
  </div>
</section>

<section id="contact" class="sec">
  <div class="wrap contact-in">
    <h2>عايز تطلب أو تسأل؟</h2>
    <p>ضيف اللي محتاجه من المنتجات فوق ودوس 🛒، أو كلّمنا على طول.</p>
    <div class="hero-cta">
      ${tel ? `<a class="btn btn-navy" href="tel:${esc(tel)}">📞 اتصل بنا</a>` : ''}
      ${wa ? `<a class="btn btn-ghost dark" href="https://wa.me/${esc(wa.replace(/^0/, '20'))}" target="_blank" rel="noopener">واتساب</a>` : ''}
      ${b.facebook ? `<a class="btn btn-ghost dark" href="${esc(b.facebook)}" target="_blank" rel="noopener">صفحتنا على فيسبوك</a>` : ''}
    </div>
  </div>
</section>

<footer class="foot">
  <div class="wrap">
    <strong>${esc(b.name)}</strong>
    ${b.address ? `<span>${esc(b.address)}</span>` : ''}
    ${b.phone ? `<span>${esc(b.phone)}</span>` : ''}
  </div>
</footer>

<!-- سلة الطلب -->
<div id="drawer" class="drawer" hidden>
  <div class="drawer-bg" data-close></div>
  <aside class="drawer-box">
    <div class="drawer-head"><h3>طلبك</h3><button type="button" class="x" data-close>&times;</button></div>
    <div id="cartList" class="drawer-body"></div>
    <div class="drawer-foot">
      <div class="sum">الإجمالي <strong id="cartTotal">0.00 ج.م</strong></div>
      <button type="button" id="goOrder" class="btn btn-amber block">إتمام الشراء</button>
    </div>
  </aside>
</div>

<!-- بيانات الزبون -->
<div id="orderBox" class="drawer" hidden>
  <div class="drawer-bg" data-close></div>
  <aside class="drawer-box">
    <div class="drawer-head"><h3>بياناتك</h3><button type="button" class="x" data-close>&times;</button></div>
    <form id="orderForm" class="drawer-body" novalidate>
      <label>الاسم<input name="name" required autocomplete="name"></label>
      <label>رقم التليفون<input name="phone" required inputmode="tel" autocomplete="tel"></label>
      <label>العنوان بالتفصيل<textarea name="address" rows="3" required autocomplete="street-address"></textarea></label>
      <label>ملاحظات (اختياري)<textarea name="notes" rows="2"></textarea></label>
      ${s.order.areas ? `<p class="hint">مناطق التوصيل: ${esc(s.order.areas)}</p>` : ''}
      ${s.order.note ? `<p class="hint">${esc(s.order.note)}</p>` : ''}
      <div class="sum">الإجمالي <strong id="orderTotal">0.00 ج.م</strong></div>
      <button type="submit" class="btn btn-amber block" id="sendBtn">إتمام الشراء</button>
      <p id="orderMsg" class="msg" hidden></p>
    </form>
  </aside>
</div>

<div id="done" class="done" hidden>
  <div class="done-box">
    <div class="tick">✅</div>
    <h3>تم استلام طلبك</h3>
    <p>هنكلمك على التليفون نأكد الطلب والتوصيل.</p>
    <p class="ref">رقم الطلب: <strong id="doneRef"></strong></p>
    <button type="button" class="btn btn-navy" data-close>تمام</button>
  </div>
</div>

${tel ? `<a class="fab" href="tel:${esc(tel)}" aria-label="اتصل بنا">📞</a>` : ''}

<script>window.SITE = ${JSON.stringify({
  relay: s.order.relayUrl || '',
  shop: b.name,
  phone: b.phone || ''
})};</script>
<script src="site.js"></script>
</body>
</html>`;

    return [
      { path: 'index.html', text: html },
      { path: 'site.css', text: CSS },
      { path: 'site.js', text: JS },
      { path: 'content.json', text: JSON.stringify(s, null, 1) }
    ];
  }

  // ---------- الشكل ----------
  const CSS = `
:root{
  --navy:#0F2438; --navy-2:#16324B; --amber:#F2A93B; --amber-dark:#C97F10;
  --ink:#1B2A38; --soft:#5D6B78; --line:#E3E8ED; --bg:#F7F8FA; --white:#fff;
  --ok:#1D6B3D; --danger:#B3261E; --radius:14px;
}
*{box-sizing:border-box;}
/* السلة ونافذة الطلب ورسالة "تم" مخفيين لحد ما الزبون يفتحهم.
   من غير !important الـ display اللي تحت بيتغلّب على الإخفاء
   وكل النوافذ بتفضل مفتوحة أول ما الصفحة تفتح. */
[hidden]{display:none !important;}
html{scroll-behavior:smooth;}
body{margin:0;font-family:Cairo,system-ui,sans-serif;color:var(--ink);background:var(--bg);line-height:1.8;}
img{max-width:100%;display:block;}
a{color:inherit;}
.wrap{max-width:1180px;margin:0 auto;padding:0 18px;}
h1,h2,h3{margin:0 0 10px;line-height:1.35;text-wrap:balance;}

.topnote{background:var(--amber);color:#3B2A05;text-align:center;padding:8px 14px;font-weight:800;font-size:14px;}

.bar{background:var(--navy);color:#fff;position:sticky;top:0;z-index:40;box-shadow:0 2px 14px rgba(0,0,0,.18);}
.bar-in{display:flex;align-items:center;gap:16px;min-height:68px;}
.logo{display:flex;align-items:center;gap:10px;text-decoration:none;flex:1;min-width:0;}
.mark{width:40px;height:40px;flex:none;border-radius:11px;background:var(--amber);color:var(--navy);
  display:grid;place-items:center;font-size:20px;}
.logo-txt{display:flex;flex-direction:column;min-width:0;}
.logo-txt strong{font-size:16px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.logo-txt small{font-size:11.5px;color:#9FB3C6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.menu{display:flex;gap:18px;font-weight:700;font-size:14.5px;}
.menu a{text-decoration:none;color:#D7E2EC;padding:6px 0;border-bottom:2px solid transparent;}
.menu a:hover{color:#fff;border-color:var(--amber);}
.cart-btn{background:var(--amber);color:var(--navy);border:none;border-radius:11px;padding:9px 15px;
  font:inherit;font-weight:900;font-size:15px;cursor:pointer;white-space:nowrap;}

.hero{background:var(--navy) center/cover no-repeat;color:#fff;}
.hero-in{padding:74px 18px 80px;max-width:820px;margin:0;}
.hero h1{font-size:clamp(27px,4.6vw,46px);font-weight:900;}
.hero p{font-size:clamp(15px,1.8vw,18.5px);color:#C9D7E4;margin:0 0 26px;max-width:62ch;}
.hero-cta{display:flex;gap:12px;flex-wrap:wrap;}
.btn{display:inline-block;border:none;border-radius:11px;padding:13px 26px;font:inherit;font-weight:800;
  font-size:15.5px;cursor:pointer;text-decoration:none;transition:transform .08s, filter .15s;}
.btn:active{transform:translateY(1px);}
.btn-amber{background:var(--amber);color:var(--navy);}
.btn-amber:hover{filter:brightness(1.06);}
.btn-navy{background:var(--navy);color:#fff;}
.btn-ghost{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.55);}
.btn-ghost.dark{color:var(--navy);border-color:var(--navy);}
.btn.sm{padding:9px 18px;font-size:14px;}
.btn.block{width:100%;text-align:center;}

.feats{background:var(--white);border-bottom:1px solid var(--line);}
.feats-in{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:10px;padding:20px 18px;}
.feat{display:flex;gap:11px;align-items:flex-start;}
.fi{font-size:24px;line-height:1.2;}
.feat strong{display:block;font-size:14.5px;}
.feat span{font-size:12.5px;color:var(--soft);line-height:1.7;}

.sec{padding:56px 0;}
.sec-warm{background:#FFF8EC;}
.sec-dark{background:var(--navy);color:#fff;}
.sec-head{margin-bottom:26px;}
.sec-head h2{font-size:clamp(21px,3vw,29px);font-weight:900;}
.sec-head p{margin:0;color:var(--soft);font-size:14.5px;}
.sec-dark .sec-head p{color:#A9BDCF;}

.cats{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:22px;}
.cat{background:#fff;border:1.5px solid var(--line);border-radius:999px;padding:8px 18px;
  font:inherit;font-size:14px;font-weight:700;cursor:pointer;}
.cat:hover{border-color:var(--amber);}
.cat.on{background:var(--navy);color:#fff;border-color:var(--navy);}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:16px;}
.card{background:#fff;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;
  display:flex;flex-direction:column;height:100%;transition:box-shadow .15s, transform .15s;}
.card:hover{box-shadow:0 8px 24px rgba(15,36,56,.10);transform:translateY(-2px);}
.card-img{aspect-ratio:4/3;background:#EEF2F6;overflow:hidden;}
.card-img img{width:100%;height:100%;object-fit:cover;}
.noimg{width:100%;height:100%;display:grid;place-items:center;font-size:40px;opacity:.35;}
.card-body{padding:12px 14px 14px;display:flex;flex-direction:column;flex:1;gap:6px;}
.card-body h3{font-size:15.5px;font-weight:800;margin:0;}
.card-desc{margin:0;font-size:12.5px;color:var(--soft);line-height:1.7;}
.card-foot{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:8px;}
.price{font-weight:900;font-size:17px;color:var(--navy);font-variant-numeric:tabular-nums;}
.price small{font-size:11.5px;font-weight:700;color:var(--soft);}
.add{background:var(--navy);color:#fff;border:none;border-radius:9px;padding:8px 14px;
  font:inherit;font-weight:800;font-size:13px;cursor:pointer;white-space:nowrap;}
.add:hover{background:var(--navy-2);}
.add.in{background:var(--ok);}
.empty{color:var(--soft);font-size:15px;}

.offers{display:grid;grid-template-columns:repeat(auto-fill,minmax(285px,1fr));gap:16px;}
.offer{position:relative;background:#fff;border:1.5px solid #F2D9A8;border-radius:var(--radius);
  overflow:hidden;display:flex;flex-direction:column;}
.badge-off{position:absolute;inset-inline-start:12px;top:12px;z-index:2;background:var(--danger);color:#fff;
  border-radius:999px;padding:4px 12px;font-size:12.5px;font-weight:900;}
.offer-img{aspect-ratio:16/9;background:#F3EADA;overflow:hidden;}
.offer-img img{width:100%;height:100%;object-fit:cover;}
.offer-body{padding:14px 16px 16px;display:flex;flex-direction:column;flex:1;gap:6px;}
.offer-body h3{font-size:17px;font-weight:900;margin:0;}
.offer-body p{margin:0;font-size:13.5px;color:var(--soft);}
.offer-foot{margin-top:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:8px;}
.old{text-decoration:line-through;color:var(--soft);font-size:14px;font-variant-numeric:tabular-nums;}
.offer-foot .add{margin-inline-start:auto;}
.until{font-size:12px;color:#8A5A12;font-weight:700;}

.about-in{display:grid;grid-template-columns:1.4fr 1fr;gap:34px;align-items:start;}
.about-in h2{font-size:clamp(21px,3vw,29px);font-weight:900;}
.about-in p{color:#C9D7E4;font-size:15px;margin:0 0 12px;max-width:62ch;}
.hours{font-weight:700;color:#fff !important;}
.about-box{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);
  border-radius:var(--radius);padding:18px;display:flex;flex-direction:column;gap:14px;}
.ab{display:flex;gap:11px;align-items:flex-start;font-size:14px;}
.ab span{font-size:19px;}
.ab strong{display:block;font-size:12.5px;color:#9FB3C6;font-weight:700;}
.ab a{text-decoration:none;}

.contact-in{text-align:center;}
.contact-in h2{font-size:clamp(21px,3vw,29px);font-weight:900;}
.contact-in p{color:var(--soft);margin:0 0 20px;}
.contact-in .hero-cta{justify-content:center;}

.foot{background:#091724;color:#8FA4B7;padding:22px 0;font-size:13px;}
.foot .wrap{display:flex;gap:16px;flex-wrap:wrap;align-items:center;}
.foot strong{color:#fff;font-size:14px;}

.fab{position:fixed;inset-inline-end:18px;bottom:18px;z-index:45;width:54px;height:54px;border-radius:50%;
  background:var(--amber);color:var(--navy);display:grid;place-items:center;font-size:23px;
  text-decoration:none;box-shadow:0 6px 20px rgba(0,0,0,.28);}

.drawer{position:fixed;inset:0;z-index:60;}
.drawer-bg{position:absolute;inset:0;background:rgba(9,23,36,.55);}
.drawer-box{position:absolute;inset-inline-start:0;top:0;bottom:0;width:min(420px,100%);background:#fff;
  display:flex;flex-direction:column;box-shadow:0 0 40px rgba(0,0,0,.3);}
.drawer-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;
  border-bottom:1px solid var(--line);}
.drawer-head h3{margin:0;font-size:18px;font-weight:900;}
.x{background:none;border:none;font-size:26px;line-height:1;cursor:pointer;color:var(--soft);}
.drawer-body{padding:16px 18px;overflow:auto;flex:1;}
.drawer-foot{padding:16px 18px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:12px;}
.sum{display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:15px;}
.sum strong{font-size:19px;color:var(--navy);font-variant-numeric:tabular-nums;}
.line{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px dashed var(--line);}
.line-n{flex:1;font-weight:700;font-size:14.5px;}
.line-n small{display:block;color:var(--soft);font-weight:600;font-size:12px;}
.qty{display:flex;align-items:center;gap:6px;}
.qty button{width:29px;height:29px;border:1.5px solid var(--line);background:#fff;border-radius:8px;
  font:inherit;font-size:16px;font-weight:800;cursor:pointer;line-height:1;}
.qty span{min-width:26px;text-align:center;font-weight:800;font-variant-numeric:tabular-nums;}
.drawer-body label{display:block;margin-bottom:13px;font-weight:700;font-size:13.5px;}
.drawer-body input,.drawer-body textarea{width:100%;margin-top:5px;padding:11px 13px;border:1.5px solid var(--line);
  border-radius:10px;font:inherit;font-size:15px;background:#fff;color:var(--ink);}
.drawer-body input:focus,.drawer-body textarea:focus{outline:none;border-color:var(--amber);
  box-shadow:0 0 0 3px rgba(242,169,59,.22);}
.hint{font-size:12.5px;color:var(--soft);background:#F3F6F9;border-radius:9px;padding:9px 12px;margin:0 0 13px;}
.msg{margin:10px 0 0;font-size:13.5px;font-weight:700;color:var(--danger);}
.empty-cart{color:var(--soft);text-align:center;padding:30px 0;}

.done{position:fixed;inset:0;z-index:70;background:rgba(9,23,36,.6);display:grid;place-items:center;padding:18px;}
.done-box{background:#fff;border-radius:18px;padding:32px 26px;text-align:center;max-width:380px;}
.tick{font-size:48px;}
.done-box h3{font-size:21px;font-weight:900;margin:8px 0;}
.done-box p{color:var(--soft);margin:0 0 6px;font-size:14.5px;}
.ref{font-size:13px !important;}
.ref strong{color:var(--navy);font-variant-numeric:tabular-nums;}
.done-box .btn{margin-top:16px;}

@media (max-width:820px){
  .menu{display:none;}
  .about-in{grid-template-columns:1fr;gap:22px;}
  .hero-in{padding:52px 18px 56px;}
  .sec{padding:42px 0;}
  .grid{grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:12px;}
  .logo-txt small{display:none;}
}
`;

  // ---------- شغل الصفحة: السلة والطلب ----------
  const JS = `
(function(){
  var KEY='mostafaCart';
  var cart={};
  try{ cart=JSON.parse(localStorage.getItem(KEY)||'{}')||{}; }catch(e){ cart={}; }

  var money=function(n){ return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); };
  var $=function(id){ return document.getElementById(id); };
  function save(){ try{ localStorage.setItem(KEY,JSON.stringify(cart)); }catch(e){} }
  function count(){ var n=0; for(var k in cart) n+=cart[k].qty; return n; }
  function total(){ var t=0; for(var k in cart) t+=cart[k].qty*cart[k].price; return Math.round(t*100)/100; }

  function paint(){
    $('cartCount').textContent=count();
    var box=$('cartList');
    var keys=Object.keys(cart);
    if(!keys.length){ box.innerHTML='<p class="empty-cart">السلة فاضية — ضيف اللي محتاجه من المنتجات.</p>'; }
    else{
      box.innerHTML=keys.map(function(k){
        var it=cart[k];
        return '<div class="line" data-k="'+k.replace(/"/g,'&quot;')+'">'+
          '<div class="line-n">'+it.name+'<small>'+money(it.price)+' ج.م</small></div>'+
          '<div class="qty"><button type="button" data-d="-1">−</button><span>'+it.qty+'</span>'+
          '<button type="button" data-d="1">+</button></div></div>';
      }).join('');
    }
    var t=money(total())+' ج.م';
    $('cartTotal').textContent=t; $('orderTotal').textContent=t;
    document.querySelectorAll('.add').forEach(function(b){
      b.classList.toggle('in', !!cart[b.dataset.name]);
      b.textContent = cart[b.dataset.name] ? ('في الطلب ('+cart[b.dataset.name].qty+')') : 'أضف للطلب';
    });
  }

  function add(name,price){
    if(!cart[name]) cart[name]={name:name,price:Number(price)||0,qty:0};
    cart[name].qty++; save(); paint();
  }

  document.addEventListener('click',function(e){
    var a=e.target.closest('.add');
    if(a){ add(a.dataset.name, a.dataset.price); open('drawer'); return; }
    if(e.target.closest('[data-close]')){ closeAll(); return; }
    var q=e.target.closest('.qty button');
    if(q){
      var k=q.closest('.line').dataset.k;
      if(cart[k]){ cart[k].qty+=Number(q.dataset.d); if(cart[k].qty<=0) delete cart[k]; save(); paint(); }
      return;
    }
    var c=e.target.closest('.cat');
    if(c){
      document.querySelectorAll('.cat').forEach(function(x){ x.classList.toggle('on', x===c); });
      var want=c.dataset.cat;
      document.querySelectorAll('.cell').forEach(function(cell){
        cell.hidden = !!want && cell.dataset.cat!==want;
      });
    }
  });

  function open(id){ $(id).hidden=false; document.body.style.overflow='hidden'; }
  function closeAll(){
    ['drawer','orderBox','done'].forEach(function(i){ $(i).hidden=true; });
    document.body.style.overflow='';
  }
  $('cartBtn').addEventListener('click',function(){ open('drawer'); });
  $('goOrder').addEventListener('click',function(){
    if(!count()){ return; }
    $('drawer').hidden=true; open('orderBox');
  });

  /* إرسال الطلب: بيتبعت في الخلفية والزبون بيفضل في نفس الصفحة.
     بنبعت نص عادي عشان المتصفح ما يسألش السيرفر إذن الأول (preflight)
     — اللي بيفشل مع سكربت جوجل. */
  $('orderForm').addEventListener('submit',function(e){
    e.preventDefault();
    var f=e.target, msg=$('orderMsg'), btn=$('sendBtn');
    var name=f.name.value.trim(), phone=f.phone.value.trim(), addr=f.address.value.trim();
    msg.hidden=true;
    if(!name||!phone||!addr){ msg.textContent='اكتب الاسم والتليفون والعنوان'; msg.hidden=false; return; }
    if(phone.replace(/\\D/g,'').length<10){ msg.textContent='رقم التليفون مش مظبوط'; msg.hidden=false; return; }
    if(!count()){ msg.textContent='السلة فاضية'; msg.hidden=false; return; }

    var ref=String(Date.now()).slice(-6);
    var items=Object.keys(cart).map(function(k){ return {name:cart[k].name,qty:cart[k].qty,price:cart[k].price}; });
    var order={ref:ref,name:name,phone:phone,address:addr,notes:f.notes.value.trim(),
                items:items,total:total(),at:new Date().toISOString(),shop:(window.SITE||{}).shop||''};

    btn.disabled=true; btn.textContent='بيتبعت...';
    function finish(){
      cart={}; save(); paint();
      btn.disabled=false; btn.textContent='إتمام الشراء'; f.reset();
      closeAll(); $('doneRef').textContent=ref; open('done');
    }
    var relay=(window.SITE||{}).relay;
    if(!relay){ finish(); return; }
    /* no-cors: إحنا مش محتاجين نقرا الرد، وده بيمنع المتصفح إنه
       يعتبر الطلب "فشل" وهو وصل فعلاً — وإلا كنا هنبعت الطلب تاني
       بعدين ويوصله مرتين. */
    fetch(relay,{method:'POST',mode:'no-cors',body:JSON.stringify(order),
                 headers:{'Content-Type':'text/plain;charset=utf-8'}})
      .then(function(){ finish(); })
      .catch(function(){
        // النت اتقطع وهو بيبعت — بنحفظ الطلب ونبعته أول ما يرجع
        try{ var q=JSON.parse(localStorage.getItem('mostafaPending')||'[]'); q.push(order);
             localStorage.setItem('mostafaPending',JSON.stringify(q)); }catch(e){}
        finish();
      });
  });

  // طلبات اتقطع بيها النت قبل كده
  (function(){
    var relay=(window.SITE||{}).relay; if(!relay) return;
    var q=[]; try{ q=JSON.parse(localStorage.getItem('mostafaPending')||'[]'); }catch(e){}
    if(!q.length) return;
    localStorage.removeItem('mostafaPending');
    q.forEach(function(o){
      fetch(relay,{method:'POST',mode:'no-cors',body:JSON.stringify(o),
                   headers:{'Content-Type':'text/plain;charset=utf-8'}}).catch(function(){});
    });
  })();

  paint();
})();
`;

  return { build, defaults, normalize, _css: CSS, _js: JS };
})();
