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
  // بصمة قصيرة لمحتوى نصي — بنعلّم بيها نسخة الستايل والسكربت
  function hash(t) {
    let h = 5381;
    for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

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
      /* الأقسام شجرة: القسم الرئيسي parent = null، واللي جواه
         parent = رقم اللي فوقه. أي عمق مسموح. */
      sections: [],
      products: [],
      offers: [],
      bundles: [],
      seq: 1,
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
    s.sections = (site && site.sections) || [];
    s.products = (site && site.products) || [];
    s.offers = (site && site.offers) || [];
    s.bundles = (site && site.bundles) || [];
    s.seq = Number((site && site.seq) || 0) || 1;
    // أسماء الصور عنده: { اسم الملف: الاسم اللي سمّاه } — للبحث عندنا، مش بيتنشر
    s.imgNames = (site && site.imgNames) || {};
    return s;
  }

  // ---------- شجرة الأقسام ----------
  const secId = v => (v == null || v === '' ? null : Number(v));
  function children(s, parent) {
    return (s.sections || []).filter(x => secId(x.parent) === secId(parent));
  }
  function findSec(s, id) {
    return (s.sections || []).find(x => Number(x.id) === Number(id)) || null;
  }
  // سلسلة الأقسام من فوق لتحت: كهرباء ← اي لوك
  function secChain(s, id) {
    const out = [];
    let cur = findSec(s, id), guard = 0;
    while (cur && guard++ < 20) { out.unshift(cur); cur = findSec(s, cur.parent); }
    return out;
  }
  // "|1|2|" — عشان لو دوس على "كهرباء" يشوف كمان اللي جوه "اي لوك"
  function secPath(s, id) {
    const c = secChain(s, id);
    return c.length ? '|' + c.map(x => x.id).join('|') + '|' : '';
  }
  function descendants(s, id) {
    const out = [];
    const walk = p => children(s, p).forEach(c => { out.push(c); walk(c.id); });
    walk(id);
    return out;
  }
  // كل الأقسام مرتبة زي الشجرة مع العمق — للقوايم في البرنامج
  function flatSections(s) {
    const out = [];
    const walk = (parent, depth) => {
      children(s, parent)
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
        .forEach(c => { out.push({ sec: c, depth }); walk(c.id, depth + 1); });
    };
    walk(null, 0);
    return out;
  }
  function countIn(s, id) {
    const ids = [Number(id)].concat(descendants(s, id).map(x => Number(x.id)));
    return (s.products || []).filter(p => ids.indexOf(Number(p.sectionId)) >= 0).length;
  }

  /* لوجو المحل: البيت اللي جواه عربية السوق — نفس اللي على الكارت
     واللافتة، بس مرسوم بالكود عشان يطلع حاف على أي شاشة. */
  const LOGO = `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="4.4"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M6 29 L32 9 L58 29"/>
    <path d="M48 13 v6"/>
    <path d="M18 34 h5 l5 15 h13 l4-11 H25"/>
    <circle cx="30" cy="54" r="2.6" fill="currentColor" stroke="none"/>
    <circle cx="41" cy="54" r="2.6" fill="currentColor" stroke="none"/>
  </svg>`;

  // ---------- أجزاء الصفحة ----------
  /* كارت المنتج، وجواه تفاصيله كاملة مستخبية.
     لما الزبون يدوس على الكارت، النافذة بتاخد التفاصيل دي وتعرضها —
     فالكلام مكتوب في الصفحة نفسها (جوجل بيقراه) من غير ملفات زيادة. */
  function productCard(p, s) {
    const price = Number(p.price || 0);
    const specs = (p.specs || []).filter(x => (x.k || '').trim() || (x.v || '').trim());
    const feats = (p.features || []).map(x => String(x || '').trim()).filter(Boolean);
    const chain = secChain(s, p.sectionId);
    const gallery = [p.image].concat(p.images || []).filter(Boolean);
    const brand = String(p.brand || '').trim();
    // فوق اسم المنتج: الماركة لو كاتبها، وإلا القسم
    const tag = brand || (chain.length ? chain[chain.length - 1].name : '');
    const hasMore = specs.length || feats.length || p.about || gallery.length > 1;
    return `
      <article class="card" data-name="${esc(p.name)}" data-price="${price}" data-brand="${esc(brand)}">
        <button type="button" class="card-open" aria-label="تفاصيل ${esc(p.name)}">
          <div class="card-img${p.image ? '' : ' is-empty'}">${p.image
            ? `<img src="img/${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`
            : `<div class="noimg">${LOGO}</div>`}</div>
          <div class="card-body">
            ${tag ? `<span class="card-sec${brand ? ' is-brand' : ''}">${esc(tag)}</span>` : ''}
            <h3>${esc(p.name)}</h3>
            ${p.desc ? `<p class="card-desc">${esc(p.desc)}</p>` : ''}
            ${hasMore ? `<span class="more">اعرف أكتر ←</span>` : ''}
          </div>
        </button>
        <div class="card-foot">
          <span class="price">${money(price)} <small>ج.م${p.unit ? ' / ' + esc(p.unit) : ''}</small></span>
          <button type="button" class="add" data-name="${esc(p.name)}" data-price="${price}">أضف للطلب</button>
        </div>
        <div class="pdet" hidden>
          ${brand ? `<div class="pd-brand">${esc(brand)}</div>` : ''}
          ${chain.length ? `<div class="pd-path">${chain.map(c => esc(c.name)).join(' ← ')}</div>` : ''}
          <h3>${esc(p.name)}</h3>
          <div class="pd-price">${money(price)} <small>ج.م${p.unit ? ' / ' + esc(p.unit) : ''}</small></div>
          ${gallery.length ? `
          <div class="pd-gal">
            <div class="pd-main">
              <img src="img/${esc(gallery[0])}" alt="${esc(p.name)}">
              ${gallery.length > 1 ? `
              <button type="button" class="pd-nav pd-prev" data-d="-1" aria-label="الصورة اللي قبلها">‹</button>
              <button type="button" class="pd-nav pd-next" data-d="1" aria-label="الصورة اللي بعدها">›</button>
              <span class="pd-count"><b>1</b>/${gallery.length}</span>` : ''}
            </div>
            ${gallery.length > 1 ? `<div class="pd-thumbs">${gallery.map((g, k) =>
              `<button type="button" class="pd-th${k ? '' : ' on'}" data-src="img/${esc(g)}"
                       aria-label="صورة ${k + 1}"><img src="img/${esc(g)}" alt="" loading="lazy"></button>`
              ).join('')}</div>` : ''}
          </div>` : ''}
          ${p.desc ? `<p class="pd-lead">${esc(p.desc)}</p>` : ''}
          ${feats.length ? `<div class="pd-blk"><h4>المميزات</h4>
            <ul class="pd-feats">${feats.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
          ${specs.length ? `<div class="pd-blk"><h4>المواصفات</h4>
            <table class="pd-specs">${specs.map(x =>
              `<tr><th>${esc(x.k)}</th><td>${esc(x.v)}</td></tr>`).join('')}</table></div>` : ''}
          ${p.about ? `<div class="pd-blk"><h4>الوصف</h4>
            <p class="pd-about">${esc(p.about)}</p></div>` : ''}
        </div>
      </article>`;
  }

  /* الباكدچ: كذا منتج مع بعض بسعر أقل من مجموعهم */
  function bundleCard(bn) {
    const price = Number(bn.price || 0);
    const lines = (bn.lines || []).filter(l => (l.name || '').trim());
    const full = lines.reduce((t, l) => t + Number(l.qty || 1) * Number(l.price || 0), 0);
    const save = full > price && price > 0 ? Math.round((full - price) * 100) / 100 : 0;
    return `
      <article class="bundle">
        ${save > 0 ? `<span class="badge-off">توفير ${money(save)} ج.م</span>` : ''}
        <div class="offer-img">${bn.image
          ? `<img src="img/${esc(bn.image)}" alt="${esc(bn.title)}" loading="lazy">`
          : `<div class="noimg">🎁</div>`}</div>
        <div class="offer-body">
          <h3>${esc(bn.title)}</h3>
          ${bn.desc ? `<p>${esc(bn.desc)}</p>` : ''}
          ${lines.length ? `<ul class="bn-list">${lines.map(l =>
            `<li><span>${esc(l.name)}</span><b>×${Number(l.qty || 1)}</b></li>`).join('')}</ul>` : ''}
          <div class="offer-foot">
            ${price > 0 ? `<span class="price">${money(price)} <small>ج.م</small></span>` : ''}
            ${save > 0 ? `<span class="old">${money(full)}</span>` : ''}
            ${price > 0 ? `<button type="button" class="add" data-name="${esc(bn.title)} (باكدچ)" data-price="${price}">أضف للطلب</button>` : ''}
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
    const tops = children(s, null).sort((a, b2) => Number(a.order || 0) - Number(b2.order || 0));
    /* الأصناف اللي لسه ما اتحطتش في قسم بتظهر تحت "باقي الأصناف"
       بدل ما تختفي — عشان ما يضيعش منه حاجة وهو بيرتّب. */
    const loose = s.products.filter(p => !findSec(s, p.sectionId)).length;
    const tel = digits(b.phone), tel2 = digits(b.phone2), wa = digits(b.whatsapp || b.phone);
    const title = s.seo.title || (b.name + (b.tagline ? ' — ' + b.tagline : ''));
    const desc = s.seo.description || s.hero.subtitle || b.tagline;
    const ogImg = s.hero.image || (s.products.find(p => p.image) || {}).image || '';

    let html = `<!DOCTYPE html>
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
      <span class="mark">${LOGO}</span>
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

${s.bundles.length ? `
<section id="bundles" class="sec">
  <div class="wrap">
    <div class="sec-head"><h2>🎁 باكدچات</h2><p>كذا حاجة مع بعض بسعر أقل من ما تشتريهم فرادى</p></div>
    <div class="offers">${s.bundles.map(bundleCard).join('')}</div>
  </div>
</section>` : ''}

<section id="products" class="sec sec-grey">
  <div class="wrap">
    <div class="sec-head"><h2>المنتجات</h2><p>دوّر على اللي محتاجه أو اتفرّج على الأقسام — وضيفه للطلب</p></div>

    <div class="find">
      <input type="search" id="q" placeholder="دوّر على أي حاجة… مثلاً: مشترك" autocomplete="off">
      <button type="button" id="qClear" hidden aria-label="امسح البحث">&times;</button>
    </div>

    ${tops.length ? `
    <div class="cats" id="topCats">
      <button type="button" class="cat on" data-sec="">كل الأقسام</button>
      ${/* القسم الفاضي مبيظهرش للزبون — مفيش فايدة من قسم يدوس عليه يلاقيه فاضي */''}
      ${tops.filter(t => countIn(s, t.id) > 0).map(t => `<button type="button" class="cat" data-sec="${t.id}">${esc(t.name)}
        <i>${countIn(s, t.id)}</i></button>`).join('')}
      ${loose ? `<button type="button" class="cat" data-sec="0">باقي الأصناف <i>${loose}</i></button>` : ''}
    </div>
    <div class="secs" id="secGrid" data-tree="${esc(JSON.stringify(
      (() => {
        const m = {};
        const put = (parent) => {
          const kids = children(s, parent)
            .sort((a, b2) => Number(a.order || 0) - Number(b2.order || 0))
            .filter(k => countIn(s, k.id) > 0);
          if (kids.length) {
            m[parent == null ? '' : String(parent)] =
              kids.map(k => ({ id: k.id, name: k.name, n: countIn(s, k.id), img: k.image || '' }));
          }
          kids.forEach(k => put(k.id));
        };
        put(null);
        return m;
      })()))}"></div>` : ''}

    <div class="find-info" id="qInfo" hidden></div>

    ${s.products.length
      ? `<div class="grid" id="grid">${s.products.map(p =>
          `<div class="cell" data-path="${esc(secPath(s, p.sectionId) || '|0|')}"
                data-find="${esc([p.name, p.brand, p.desc, p.about,
                                  (p.features || []).join(' '),
                                  (p.specs || []).map(x => x.k + ' ' + x.v).join(' '),
                                  secChain(s, p.sectionId).map(c => c.name).join(' ')].join(' '))}"
           >${productCard(p, s)}</div>`).join('')}</div>
         <p class="empty" id="noHit" hidden>مفيش حاجة بالاسم ده — جرّب كلمة تانية أو كلّمنا وإحنا نشوفهالك.</p>`
      : `<p class="empty">لسه بنجهّز المنتجات — كلّمنا وإحنا نقولك على كل اللي عندنا.</p>`}
  </div>
</section>

<!-- تفاصيل المنتج -->
<div id="pmodal" class="drawer" hidden>
  <div class="drawer-bg" data-close></div>
  <aside class="pm-box">
    <button type="button" class="x pm-x" data-close>&times;</button>
    <div class="pm-body" id="pmBody"></div>
    <div class="pm-foot">
      <div class="pm-qty">
        <span>الكمية</span>
        <button type="button" id="pmMinus" aria-label="أقل">&minus;</button>
        <b id="pmQ">1</b>
        <button type="button" id="pmPlus" aria-label="أكتر">+</button>
      </div>
      <button type="button" class="btn btn-amber block" id="pmAdd">أضف للطلب</button>
    </div>
  </aside>
</div>

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

    /* رقم نسخة للستايل والسكربت.

       من غيره المتصفح بيفضل شغّال على نسخة قديمة محفوظة عنده: ينزّل
       الصفحة الجديدة ويستعمل معاها ستايل قديم — فالشكل بيطلع مكسور
       (الصور الصغيرة بتطلع بحجمها الكامل مثلاً). الرقم بيتحسب من
       محتوى الملفين نفسهم، فمبيتغيّرش غير لما يتغيّروا فعلاً. */
    const stamp = hash(CSS + JS);
    html = html.replace('href="site.css"', 'href="site.css?v=' + stamp + '"')
               .replace('src="site.js"', 'src="site.js?v=' + stamp + '"');

    return [
      { path: 'index.html', text: html },
      { path: 'site.css', text: CSS },
      { path: 'site.js', text: JS },
      /* مفيش ملف بيانات بيتنشر مع الموقع عن قصد: إعدادات الطلبات فيها
         توكن البوت، وأي حاجة بتتحط على الموقع بيقدر أي حد يفتحها. */
    ];
  }

  // ---------- الشكل ----------
  const CSS = `
/* ألوان المحل — مأخوذة من الكارت واللافتة:
   البرتقالي #F04E05، والأسود والأبيض. */
:root{
  --orange:#F04E05; --orange-d:#C93F03; --orange-soft:#FFF0E8; --orange-line:#F8C9AE;
  --navy:#141414; --navy-2:#262626;
  --ink:#1A1A1A; --soft:#6E6A67; --line:#E7E2DE; --bg:#FAF8F7; --white:#fff;
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

.topnote{background:var(--orange);color:#fff;text-align:center;padding:8px 14px;font-weight:800;font-size:14px;}

/* الهيدر أبيض زي وش الكارت */
.bar{background:#fff;color:var(--ink);position:sticky;top:0;z-index:40;
  border-bottom:1px solid var(--line);box-shadow:0 2px 14px rgba(0,0,0,.06);}
.bar-in{display:flex;align-items:center;gap:16px;min-height:72px;}
.logo{display:flex;align-items:center;gap:11px;text-decoration:none;flex:1;min-width:0;}
.mark{width:46px;height:46px;flex:none;color:var(--orange);}
.mark svg{width:100%;height:100%;display:block;}
.logo-txt{display:flex;flex-direction:column;min-width:0;}
.logo-txt strong{font-size:17px;font-weight:900;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.logo-txt small{font-size:11.5px;color:var(--orange);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.menu{display:flex;gap:18px;font-weight:700;font-size:14.5px;}
.menu a{text-decoration:none;color:var(--soft);padding:6px 0;border-bottom:2px solid transparent;}
.menu a:hover{color:var(--orange);border-color:var(--orange);}
.cart-btn{background:var(--orange);color:#fff;border:none;border-radius:11px;padding:10px 16px;
  font:inherit;font-weight:900;font-size:15px;cursor:pointer;white-space:nowrap;}
.cart-btn:hover{background:var(--orange-d);}

/* الواجهة سودا زي ضهر الكارت */
.hero{background:var(--navy) center/cover no-repeat;color:#fff;position:relative;overflow:hidden;}
/* لمسة برتقالي خفيفة في الركن — من غير حدود حادة */
.hero::after{content:"";position:absolute;inset-inline-start:-20%;top:-60%;width:75%;height:210%;
  background:radial-gradient(closest-side, rgba(240,78,5,.55), rgba(240,78,5,0) 70%);
  pointer-events:none;}
.hero-in{padding:74px 18px 80px;max-width:820px;margin:0;position:relative;z-index:1;}
.hero h1{font-size:clamp(27px,4.6vw,46px);font-weight:900;}
.hero h1 b{color:var(--orange);font-weight:900;}
.hero p{font-size:clamp(15px,1.8vw,18.5px);color:#CFC9C5;margin:0 0 26px;max-width:62ch;}
.hero-cta{display:flex;gap:12px;flex-wrap:wrap;}
.btn{display:inline-block;border:none;border-radius:11px;padding:13px 26px;font:inherit;font-weight:800;
  font-size:15.5px;cursor:pointer;text-decoration:none;transition:transform .08s, filter .15s;}
.btn:active{transform:translateY(1px);}
.btn-amber{background:var(--orange);color:#fff;}
.btn-amber:hover{background:var(--orange-d);}
.btn-navy{background:var(--navy);color:#fff;}
.btn-ghost{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.5);}
.btn-ghost:hover{border-color:var(--orange);color:var(--orange);}
.btn-ghost.dark{color:var(--ink);border-color:var(--ink);}
.btn-ghost.dark:hover{color:var(--orange);border-color:var(--orange);}
.btn.sm{padding:9px 18px;font-size:14px;}
.btn.block{width:100%;text-align:center;}

/* الخدمات — دواير برتقالي زي اللي على الكارت */
.feats{background:var(--white);border-bottom:1px solid var(--line);}
.feats-in{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:14px;padding:22px 18px;}
.feat{display:flex;gap:12px;align-items:center;}
.fi{width:46px;height:46px;flex:none;border-radius:50%;background:var(--orange-soft);
  border:1.5px solid var(--orange-line);display:grid;place-items:center;font-size:22px;line-height:1;}
.feat strong{display:block;font-size:14.5px;}
.feat span{font-size:12.5px;color:var(--soft);line-height:1.7;}

.sec{padding:56px 0;}
.sec-warm{background:var(--orange-soft);}
.sec-dark{background:var(--navy);color:#fff;}
.sec-head{margin-bottom:26px;position:relative;padding-inline-start:0;}
.sec-head h2{font-size:clamp(21px,3vw,29px);font-weight:900;}
.sec-head h2::after{content:"";display:block;width:54px;height:4px;border-radius:3px;
  background:var(--orange);margin-top:9px;}
.sec-head p{margin:0;color:var(--soft);font-size:14.5px;}
.sec-dark .sec-head p{color:#B9B3AF;}

.cats{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:22px;}
.cat{background:#fff;border:1.5px solid var(--line);border-radius:999px;padding:8px 18px;
  font:inherit;font-size:14px;font-weight:700;cursor:pointer;}
.cat:hover{border-color:var(--orange);color:var(--orange);}
.cat.on{background:var(--orange);color:#fff;border-color:var(--orange);}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:16px;}
.card{background:#fff;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;
  display:flex;flex-direction:column;height:100%;transition:box-shadow .15s, transform .15s;}
.card:hover{box-shadow:0 8px 24px rgba(240,78,5,.16);border-color:var(--orange-line);transform:translateY(-2px);}
/* خلفية بيضا للصورة و«احتواء» مش «قص»: المنتج بيبان كامل زي ما هو
   في الصورة، مش مقصوص من الجنب. */
.card-img{aspect-ratio:4/3;background:#fff;overflow:hidden;border-bottom:1px solid var(--line);}
.card-img img{width:100%;height:100%;object-fit:contain;padding:10px;}
.card-img.is-empty{background:linear-gradient(135deg,#FBFAF9,#F1EFEC);}
.noimg{width:100%;height:100%;display:grid;place-items:center;color:var(--orange);opacity:.18;}
.noimg svg{width:54px;height:54px;}
.card-body{padding:12px 14px 8px;display:flex;flex-direction:column;flex:1;gap:5px;align-items:flex-start;}
.card-body h3{font-size:15.5px;font-weight:800;margin:0;}
.card-desc{margin:0;font-size:12.5px;color:var(--soft);line-height:1.7;}
/* السعر في سطر لوحده والزرار تحته على العرض — أسهل في الدوس على الموبايل */
.card-foot{margin-top:auto;display:flex;flex-direction:column;align-items:stretch;gap:9px;padding-top:9px;}
.card-foot .add{width:100%;padding:10px 14px;font-size:13.5px;}
.price{font-weight:900;font-size:17px;color:var(--orange);font-variant-numeric:tabular-nums;}
.price small{font-size:11.5px;font-weight:700;color:var(--soft);}
/* زرار الطلب بلون المحل — هو أهم زرار في الصفحة */
.add{background:var(--orange);color:#fff;border:none;border-radius:10px;padding:8px 14px;
  font:inherit;font-weight:800;font-size:13px;cursor:pointer;white-space:nowrap;
  box-shadow:0 2px 7px rgba(240,78,5,.26);transition:background .15s, box-shadow .15s;}
.add:hover{background:var(--orange-d);box-shadow:0 4px 13px rgba(240,78,5,.34);}
.add.in{background:var(--ok);box-shadow:0 2px 7px rgba(29,107,61,.26);}
.empty{color:var(--soft);font-size:15px;}

.offers{display:grid;grid-template-columns:repeat(auto-fill,minmax(285px,1fr));gap:16px;}
.offer{position:relative;background:#fff;border:1.5px solid var(--orange-line);border-radius:var(--radius);
  overflow:hidden;display:flex;flex-direction:column;}
.badge-off{position:absolute;inset-inline-start:12px;top:12px;z-index:2;background:var(--navy);color:#fff;
  border-radius:999px;padding:4px 12px;font-size:12.5px;font-weight:900;}
.offer-img{aspect-ratio:16/9;background:var(--orange-soft);overflow:hidden;}
.offer-img img{width:100%;height:100%;object-fit:cover;}
.offer-body{padding:14px 16px 16px;display:flex;flex-direction:column;flex:1;gap:6px;}
.offer-body h3{font-size:17px;font-weight:900;margin:0;}
.offer-body p{margin:0;font-size:13.5px;color:var(--soft);}
.offer-foot{margin-top:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:8px;}
.old{text-decoration:line-through;color:var(--soft);font-size:14px;font-variant-numeric:tabular-nums;}
.offer-foot .add{margin-inline-start:auto;}
.until{font-size:12px;color:var(--orange-d);font-weight:700;}

.about-in{display:grid;grid-template-columns:1.4fr 1fr;gap:34px;align-items:start;}
.about-in h2{font-size:clamp(21px,3vw,29px);font-weight:900;}
.about-in p{color:#CFC9C5;font-size:15px;margin:0 0 12px;max-width:62ch;}
.hours{font-weight:700;color:#fff !important;}
.about-box{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);
  border-radius:var(--radius);padding:18px;display:flex;flex-direction:column;gap:14px;}
.ab{display:flex;gap:11px;align-items:flex-start;font-size:14px;}
.ab span{font-size:19px;}
.ab strong{display:block;font-size:12.5px;color:var(--orange);font-weight:700;}
.ab a{text-decoration:none;}

/* ===== البحث والأقسام ===== */
.sec-grey{background:var(--bg);}
.find{position:relative;margin-bottom:18px;max-width:520px;}
.find input{width:100%;padding:14px 46px 14px 16px;border:1.5px solid var(--line);border-radius:12px;
  font:inherit;font-size:15.5px;background:#fff;color:var(--ink);}
.find input:focus{outline:none;border-color:var(--orange);box-shadow:0 0 0 3px rgba(240,78,5,.18);}
.find #qClear{position:absolute;inset-inline-start:10px;top:50%;transform:translateY(-50%);
  background:none;border:none;font-size:24px;line-height:1;color:var(--soft);cursor:pointer;}
.cat i{font-style:normal;background:var(--orange-soft);color:var(--orange-d);border-radius:999px;
  padding:1px 7px;font-size:11.5px;font-weight:900;margin-inline-start:5px;}
.cat.on i{background:rgba(255,255,255,.28);color:#fff;}
/* كروت الأقسام — صورة واسم وعدد الأصناف */
.secs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin:0 0 24px;}
.seccard{background:#fff;border:1.5px solid var(--line);border-radius:12px;overflow:hidden;
  cursor:pointer;padding:0;font:inherit;text-align:start;display:flex;flex-direction:column;
  transition:box-shadow .15s, border-color .15s, transform .15s;}
.seccard:hover{border-color:var(--orange);box-shadow:0 6px 18px rgba(240,78,5,.14);transform:translateY(-2px);}
.seccard.on{border-color:var(--orange);box-shadow:0 0 0 2px rgba(240,78,5,.28);}
.sc-img{display:block;aspect-ratio:4/3;background:var(--orange-soft);overflow:hidden;}
.sc-img img{width:100%;height:100%;object-fit:cover;display:block;}
/* القسم اللي لسه مالوش صورة: أول حرفين من اسمه بلون المحل —
   أنضف بكتير من أيقونة رمادية مكررة في كل كرت */
.sc-img.is-empty{background:linear-gradient(135deg,var(--orange-soft),#FFE2D2);}
.sc-ph{width:100%;height:100%;display:grid;place-items:center;font-size:26px;font-weight:900;
  color:var(--orange);opacity:.55;letter-spacing:1px;}
.sc-t{display:flex;flex-direction:column;gap:1px;padding:9px 12px 11px;}
.sc-t b{font-size:14.5px;font-weight:800;}
.sc-t i{font-style:normal;font-size:12px;color:var(--soft);font-weight:700;}
.find-info{font-size:13.5px;color:var(--soft);margin-bottom:14px;font-weight:700;}

/* ===== كارت المنتج ===== */
.card-open{display:flex;flex-direction:column;flex:1;width:100%;text-align:inherit;
  background:none;border:none;padding:0;font:inherit;color:inherit;cursor:pointer;}
.card-sec{display:inline-block;background:var(--orange-soft);color:var(--orange-d);
  border-radius:999px;padding:2px 9px;font-size:11px;font-weight:800;margin-bottom:2px;}
/* الماركة بتبان بلون المحل الغامق عشان تفرق عن اسم القسم */
.card-sec.is-brand{background:var(--navy);color:#fff;letter-spacing:.3px;}
.more{font-size:12.5px;font-weight:800;color:var(--orange);}
.card-foot{padding:0 14px 14px;}

/* ===== نافذة تفاصيل المنتج ===== */
.pm-box{position:absolute;inset-inline-start:0;top:0;bottom:0;width:min(520px,100%);background:#fff;
  display:flex;flex-direction:column;box-shadow:0 0 40px rgba(0,0,0,.3);}
.pm-x{position:absolute;top:10px;inset-inline-end:14px;z-index:2;}
.pm-body{padding:22px 20px 10px;overflow:auto;flex:1;}
.pm-foot{padding:14px 20px 18px;border-top:1px solid var(--line);}
.pm-qty{display:flex;align-items:center;gap:10px;margin-bottom:11px;font-weight:800;font-size:14px;}
.pm-qty span{color:var(--soft);}
.pm-qty b{min-width:42px;text-align:center;font-size:17px;font-variant-numeric:tabular-nums;}
.pm-qty button{width:38px;height:38px;border:1.5px solid var(--line);background:#fff;border-radius:10px;
  font-size:20px;font-weight:800;color:var(--navy);cursor:pointer;line-height:1;}
.pm-qty button:hover{border-color:var(--orange);color:var(--orange);}
.pd-path{font-size:12.5px;color:var(--orange);font-weight:800;margin-bottom:6px;}
.pm-body h3{font-size:21px;font-weight:900;margin:0 0 8px;}
.pd-price{font-size:24px;font-weight:900;color:var(--orange);font-variant-numeric:tabular-nums;margin-bottom:14px;}
.pd-price small{font-size:13px;color:var(--soft);font-weight:700;}
.pd-brand{display:inline-block;background:var(--navy);color:#fff;font-size:11.5px;font-weight:900;
  letter-spacing:.4px;padding:4px 10px;border-radius:999px;margin-bottom:8px;}
/* معرض الصور: صورة كبيرة وتحتها الصور الصغيرة */
.pd-gal{margin-bottom:16px;}
.pd-main{position:relative;background:var(--orange-soft);border-radius:14px;overflow:hidden;
  border:1px solid var(--line);}
.pd-nav{position:absolute;top:50%;transform:translateY(-50%);width:36px;height:36px;border:0;
  border-radius:50%;background:rgba(255,255,255,.92);box-shadow:0 2px 8px rgba(0,0,0,.18);
  font-size:24px;line-height:1;color:var(--navy);cursor:pointer;padding:0;}
.pd-prev{inset-inline-start:9px;} .pd-next{inset-inline-end:9px;}
.pd-nav:hover{background:#fff;color:var(--orange);}
.pd-count{position:absolute;bottom:9px;inset-inline-end:11px;background:rgba(20,20,20,.72);color:#fff;
  font-size:11.5px;font-weight:800;padding:3px 9px;border-radius:999px;}
/* الصورة متسيبش المميزات تحت الشاشة — فطولها محدود */
.pd-main img{width:100%;height:min(36vh,300px);object-fit:contain;display:block;background:#fff;}
.pd-thumbs{display:flex;gap:8px;margin-top:9px;overflow-x:auto;padding-bottom:3px;}
.pd-th{flex:none;width:68px;height:68px;padding:0;border:2px solid var(--line);border-radius:10px;
  overflow:hidden;background:#fff;cursor:pointer;}
.pd-th img{width:100%;height:100%;object-fit:cover;display:block;}
.pd-th.on{border-color:var(--orange);}
.pd-lead{font-size:14.5px;color:var(--soft);font-weight:700;margin:0 0 14px;line-height:1.8;}
.pd-blk{margin-bottom:16px;}
.pd-blk h4{font-size:15px;font-weight:900;margin:0 0 9px;padding-inline-start:11px;
  border-inline-start:4px solid var(--orange);line-height:1.3;}
.pd-feats{margin:0;padding-inline-start:20px;font-size:14.5px;line-height:2;color:var(--ink);}
.pd-feats li{margin-bottom:2px;}
.pd-feats li::marker{color:var(--orange);}
.pd-about{font-size:14.5px;line-height:1.95;color:var(--ink);margin:0;white-space:pre-line;}
.pd-specs{width:100%;border-collapse:collapse;font-size:14px;}
.pd-specs th,.pd-specs td{text-align:start;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top;}
.pd-specs th{color:var(--soft);font-weight:700;width:42%;background:var(--bg);}
.pd-specs td{font-weight:700;}

/* ===== الباكدچ ===== */
.bundle{position:relative;background:#fff;border:1.5px solid var(--line);border-radius:var(--radius);
  overflow:hidden;display:flex;flex-direction:column;}
.bn-list{list-style:none;margin:6px 0 4px;padding:10px 12px;background:var(--bg);border-radius:10px;
  display:flex;flex-direction:column;gap:5px;}
.bn-list li{display:flex;justify-content:space-between;gap:10px;font-size:13.5px;}
.bn-list b{color:var(--orange);font-variant-numeric:tabular-nums;}

.contact-in{text-align:center;}
.contact-in h2{font-size:clamp(21px,3vw,29px);font-weight:900;}
.contact-in p{color:var(--soft);margin:0 0 20px;}
.contact-in .hero-cta{justify-content:center;}

.foot{background:#0D0D0D;color:#9A9490;padding:22px 0;font-size:13px;}
.foot .wrap{display:flex;gap:16px;flex-wrap:wrap;align-items:center;}
.foot strong{color:#fff;font-size:14px;}

.fab{position:fixed;inset-inline-end:18px;bottom:18px;z-index:45;width:54px;height:54px;border-radius:50%;
  background:var(--orange);color:#fff;display:grid;place-items:center;font-size:23px;
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

  function add(name,price,qty){
    var n=Math.max(1,Number(qty)||1);
    if(!cart[name]) cart[name]={name:name,price:Number(price)||0,qty:0};
    cart[name].qty+=n; save(); paint();
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
    if(c){ document.querySelectorAll('.cat').forEach(function(x){ x.classList.toggle('on', x===c); });
           sel=c.dataset.sec||''; sub=''; drawSubs(); apply(); return; }
    var sc=e.target.closest('.seccard');
    if(sc){
      var id=sc.dataset.sec;
      if(!sel){ sel=id; document.querySelectorAll('.cat').forEach(function(x){ x.classList.toggle('on', x.dataset.sec===id); }); }
      else { sub = (sub===id) ? '' : id; }
      drawSubs(); apply();
      var g=$('grid'); if(g) g.scrollIntoView({behavior:'smooth',block:'start'});
      return;
    }
    var po=e.target.closest('.card-open');
    if(po){ openProduct(po.closest('.card')); return; }
  });

  /* ===== الأقسام والبحث =====
     القسم الرئيسي بيوري اللي جواه كله (الأقسام اللي تحته ومنتجاتها)،
     والبحث بيدوّر في كل حاجة من غير ما يهتم بالأقسام. */
  var sel='', sub='', q='';
  var TREE={};
  try{ TREE=JSON.parse(($('secGrid')||{dataset:{}}).dataset.tree||'{}'); }catch(e){ TREE={}; }

  /* كروت الأقسام: بتوري اللي جوه القسم المفتوح. لو واقف على "كل
     الأقسام" بتوري الأقسام الرئيسية، ولو فتح "كهرباء" بتوري اللي
     جواها (اي لوك، اليوس...). */
  function drawSubs(){
    var box=$('secGrid'); if(!box) return;
    var kids=TREE[sub||sel||'']||[];
    if(!kids.length){ box.hidden=true; box.innerHTML=''; return; }
    box.hidden=false;
    box.innerHTML=kids.map(function(k){
      var on = (sub||sel)===String(k.id);
      return '<button type="button" class="seccard'+(on?' on':'')+'" data-sec="'+k.id+'">'+
        '<span class="sc-img'+(k.img?'':' is-empty')+'">'+(k.img
          ? '<img src="img/'+k.img+'" alt="'+k.name+'" loading="lazy">'
          : '<span class="sc-ph">'+k.name.slice(0,2)+'</span>')+'</span>'+
        '<span class="sc-t"><b>'+k.name+'</b><i>'+k.n+' صنف</i></span></button>';
    }).join('');
  }

  function norm(t){
    return String(t||'').toLowerCase()
      .replace(/[\\u064B-\\u0652\\u0640]/g,'')
      .replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')
      .replace(/[ؤئ]/g,'ء')
      .replace(/[^0-9a-z\\u0621-\\u064A]+/g,' ').trim();
  }

  function apply(){
    var words = q ? norm(q).split(' ').filter(Boolean) : [];
    var want = sub || sel;
    var shown=0;
    document.querySelectorAll('.cell').forEach(function(cell){
      var ok=true;
      if(words.length){
        var hay=norm(cell.dataset.find||'');
        ok = words.every(function(w){ return hay.indexOf(w)>=0; });
      } else if(want){
        ok = (cell.dataset.path||'').indexOf('|'+want+'|')>=0;
      }
      cell.hidden=!ok;
      if(ok) shown++;
    });
    var nh=$('noHit'); if(nh) nh.hidden = shown>0;
    var info=$('qInfo');
    if(info){
      if(words.length){ info.hidden=false; info.textContent='نتايج البحث عن «'+q.trim()+'»: '+shown+' صنف'; }
      else info.hidden=true;
    }
    // وانت بتدوّر، الأقسام مالهاش لازمة
    var tc=$('topCats'), sc2=$('secGrid');
    if(tc) tc.style.opacity = words.length ? '.45' : '';
    if(sc2 && words.length) { sc2.hidden = true; }
    else if(sc2) drawSubs();
  }

  var qi=$('q');
  if(qi){
    var t=null;
    qi.addEventListener('input', function(){
      q=qi.value;
      $('qClear').hidden = !q;
      /* البحث بيدوّر في كل المحل مش في القسم المفتوح — فأول ما يبدأ
         يكتب بنسيب القسم، عشان لما يمسح البحث يرجع يشوف كل حاجة
         مش يلاقي نفسه واقف في قسم هو ناسيه. */
      if(q.trim()){
        sel=''; sub='';
        document.querySelectorAll('.cat').forEach(function(x){ x.classList.toggle('on', !x.dataset.sec); });
      }
      clearTimeout(t); t=setTimeout(apply,120);
    });
    $('qClear').addEventListener('click', function(){ qi.value=''; q=''; $('qClear').hidden=true; apply(); qi.focus(); });
  }

  // ===== نافذة تفاصيل المنتج =====
  var pmName='', pmPrice=0, pmQty=1, pmIdx=0, pmTimer=null;
  /* الصور بتتقلب لوحدها كل ٣ ثواني عشان الزبون يشوف المنتج من كل
     ناحية من غير ما يعمل حاجة. أول ما يمسك هو، بنوقف ونسيبه. */
  function showImg(i){
    var ths=$('pmBody').querySelectorAll('.pd-th');
    if(ths.length<2) return;
    pmIdx=(i%ths.length+ths.length)%ths.length;
    var main=$('pmBody').querySelector('.pd-main img');
    if(main) main.src=ths[pmIdx].dataset.src;
    for(var k=0;k<ths.length;k++) ths[k].classList.toggle('on',k===pmIdx);
    var c=$('pmBody').querySelector('.pd-count b');
    if(c) c.textContent=pmIdx+1;
  }
  function autoPlay(on){
    if(pmTimer){ clearInterval(pmTimer); pmTimer=null; }
    if(on && $('pmBody').querySelectorAll('.pd-th').length>1)
      pmTimer=setInterval(function(){ showImg(pmIdx+1); },3000);
  }
  function setQ(n){
    pmQty=Math.max(1,Math.min(999,n));
    $('pmQ').textContent=pmQty;
    $('pmAdd').textContent = pmQty>1 ? ('أضف '+pmQty+' للطلب') : 'أضف للطلب';
  }
  function openProduct(card){
    if(!card) return;
    var det=card.querySelector('.pdet');
    $('pmBody').innerHTML = det ? det.innerHTML : '';
    $('pmBody').scrollTop=0;
    pmName=card.dataset.name; pmPrice=Number(card.dataset.price)||0;
    setQ(1); pmIdx=0; autoPlay(true);
    if(cart[pmName]) $('pmAdd').textContent='في الطلب ('+cart[pmName].qty+') — زوّد كمان';
    open('pmodal');
  }
  $('pmMinus').addEventListener('click', function(){ setQ(pmQty-1); });
  $('pmPlus').addEventListener('click', function(){ setQ(pmQty+1); });
  $('pmAdd').addEventListener('click', function(){
    if(!pmName) return;
    add(pmName,pmPrice,pmQty);
    closeAll(); open('drawer');
  });
  /* الصور: دوسة على صورة صغيرة أو على السهم بتقلّبها — وبتوقف
     التقليب التلقائي عشان الزبون يبقى هو اللي ماسك. */
  $('pmBody').addEventListener('click', function(e){
    var nav=e.target.closest('.pd-nav');
    if(nav){ autoPlay(false); showImg(pmIdx+Number(nav.dataset.d)); return; }
    var t=e.target.closest('.pd-th'); if(!t) return;
    autoPlay(false);
    var ths=[].slice.call($('pmBody').querySelectorAll('.pd-th'));
    showImg(ths.indexOf(t));
  });

  function open(id){ $(id).hidden=false; document.body.style.overflow='hidden'; }
  function closeAll(){
    autoPlay(false);
    ['drawer','orderBox','done','pmodal'].forEach(function(i){ var el=$(i); if(el) el.hidden=true; });
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
  drawSubs();     // كروت الأقسام الرئيسية تبان من أول ما الصفحة تفتح
})();
`;

  return { build, defaults, normalize, flatSections, secChain, children, findSec, countIn,
           _css: CSS, _js: JS };
})();
