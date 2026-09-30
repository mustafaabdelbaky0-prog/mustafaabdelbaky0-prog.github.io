Modules.site = (() => {
  /* لوحة تحكم موقع المحل.

     كل حاجة على الموقع بتتكتب من هنا: بيانات المحل، الواجهة،
     المنتجات وصورها، العروض. والنشر بيبعت الملفات للسيرفر وهو
     اللي بيرفعها على النت في الخلفية.

     الصور مش بتتخزن في بيانات البرنامج — بتتحفظ ملفات جنب الموقع،
     وإحنا بنخزن اسم الملف بس. لو خزناها جوه البيانات كان ملف
     المحل هيتخن وكل مزامنة هتبقى بطيئة. */

  const KEY = 'site';
  let site = null;          // اللي بنعدّل فيه دلوقتي
  let info = null;          // حالة الموقع من السيرفر
  let dirty = false;        // فيه تعديل لسه ما اتنشرش
  let tab = 'brand';
  let poll = null;

  const onPc = () => !(typeof window !== 'undefined' && window.DB_BACKEND);
  const esc = s => Utils.escapeHtml(s == null ? '' : String(s));
  const money = n => Utils.formatMoney(n);

  // ---------- تخزين ----------
  async function load() {
    const rec = await DB.get('settings', KEY);
    site = SiteGen.normalize(rec ? rec.value : null, AppState.company);
  }
  async function save() {
    site.updatedAt = Utils.nowISO();
    await DB.put('settings', { key: KEY, value: site });
    dirty = true;
  }
  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : undefined);
    const j = await res.json().catch(() => ({}));
    if (j && j.error) throw new Error(j.error);
    return j;
  }
  async function refreshInfo() {
    try { info = await api('api/site'); } catch (e) { info = null; }
  }

  // ---------- الصور ----------
  /* بنصغّر الصورة في المتصفح قبل ما نبعتها: صورة الموبايل ٤ ميجا
     بتبقى ١٥٠ كيلو — الموقع بيفتح بسرعة على بيانات الموبايل. */
  function shrink(file, maxW) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, (maxW || 1000) / img.width);
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', 0.82).split(',')[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('الصورة مش مقروءة')); };
      img.src = url;
    });
  }
  function newImageName() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return 'p' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
           p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) +
           String(Math.floor(Math.random() * 90) + 10) + '.jpg';
  }
  // بيفتح اختيار صورة، يصغّرها، يرفعها، ويرجّع اسم الملف
  function pickImage() {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0];
        if (!f) { resolve(null); return; }
        try {
          Utils.toast('بيجهّز الصورة...', 'info');
          const b64 = await shrink(f, 1000);
          const name = newImageName();
          await api('api/site/save', { files: [{ path: 'img/' + name, b64 }] });
          dirty = true;
          resolve(name);
        } catch (e) { Utils.toast(e.message || 'الصورة ما اترفعتش', 'error'); resolve(null); }
      });
      inp.click();
    });
  }

  // الصورة دي مستعملة في حاجة؟ (عشان ما نمسحش صورة شغالة)
  function imageUsers(name) {
    const who = [];
    if (site.hero.image === name) who.push('صورة الواجهة');
    site.products.forEach(p => { if (p.image === name) who.push(p.name); });
    site.offers.forEach(o => { if (o.image === name) who.push(o.title); });
    return who;
  }

  // ---------- النشر ----------
  async function publish(container) {
    if (!onPc()) { Utils.toast('النشر من الكمبيوتر — الموبايل بيعدّل بس', 'error'); return; }
    if (!site.enabled) {
      if (!(await Utils.confirmDialog('الموقع مقفول. تشغّله وتنشر؟'))) return;
      site.enabled = true; await save();
    }
    try {
      const files = SiteGen.build(site, AppState.company);
      await api('api/site/save', { files, publish: true });
      dirty = false;
      Utils.toast('بيرفع الموقع على النت...', 'info');
      await refreshInfo();
      render(container);
      startPoll(container);
    } catch (e) { Utils.toast(e.message || 'النشر ما نجحش', 'error'); }
  }
  function startPoll(container) {
    if (poll) clearInterval(poll);
    poll = setInterval(async () => {
      await refreshInfo();
      if (!info || !info.busy) {
        clearInterval(poll); poll = null;
        if (info && info.error) Utils.toast('الرفع ما نجحش — ' + info.error, 'error');
        else if (info) Utils.toast('الموقع اتحدّث ✓', 'success');
        if (currentRoute === 'site') render(container);
      }
    }, 2500);
  }

  // ---------- الشاشة ----------
  async function render(container) {
    await AppState.reloadItems();
    await AppState.reloadCompany();
    /* بنقرا من الأول في كل مرة: كل تعديل بيتحفظ على طول، والموبايل
       ممكن يكون عدّل حاجة ووصلت بالمزامنة — فاللي في الذاكرة ممكن
       يكون قديم. */
    await load();
    if (onPc()) await refreshInfo();

    const url = info && info.url;
    container.innerHTML = `
      <div class="site-top">
        <div class="site-state ${site.enabled ? 'on' : ''}">
          <div>
            <strong>${site.enabled ? '🌐 الموقع شغال على النت' : '⏸️ الموقع لسه مقفول'}</strong>
            ${url ? `<div class="site-url"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>
                      <button type="button" class="btn btn-ghost btn-sm" id="copyUrl">انسخ الرابط</button></div>`
                  : `<div class="hint">الرابط هيظهر بعد أول نشر</div>`}
            ${info && info.lastPublish ? `<div class="hint">آخر نشر: ${Utils.formatDateTime(info.lastPublish)}</div>` : ''}
            ${info && info.error ? `<div class="hint" style="color:var(--danger);font-weight:700;">آخر رفع ما نجحش: ${esc(info.error)}</div>` : ''}
          </div>
          <div class="site-actions">
            <label class="site-sw"><input type="checkbox" id="siteOn" ${site.enabled ? 'checked' : ''}> شغّال</label>
            <button type="button" class="btn btn-amber" id="publishBtn" ${info && info.busy ? 'disabled' : ''}>
              ${info && info.busy ? 'بيرفع...' : '🚀 انشر التعديلات'}</button>
          </div>
        </div>
        ${dirty ? `<div class="notice notice-warn" style="margin-top:10px;">فيه تعديلات لسه ما اتنشرتش — دوس «انشر التعديلات» عشان تظهر للناس.</div>` : ''}
        ${!onPc() ? `<div class="notice notice-info" style="margin-top:10px;">انت على الموبايل: تقدر تعدّل الكلام والتعديل هيتزامن، بس رفع الصور والنشر من الكمبيوتر.</div>` : ''}
      </div>

      <div class="site-tabs">
        ${[['brand', '🏪 بيانات المحل'], ['hero', '🖼️ الواجهة'], ['products', '📦 المنتجات'],
           ['offers', '🏷️ العروض'], ['about', '📝 من إحنا والمزايا'], ['order', '📬 الطلبات'],
           ['images', '🗂️ الصور']]
          .map(([k, t]) => `<button type="button" class="site-tab ${tab === k ? 'on' : ''}" data-tab="${k}">${t}
            ${k === 'products' && site.products.length ? `<span class="n">${site.products.length}</span>` : ''}
            ${k === 'offers' && site.offers.length ? `<span class="n">${site.offers.length}</span>` : ''}</button>`).join('')}
      </div>

      <div id="siteBody"></div>
    `;

    const body = container.querySelector('#siteBody');
    drawTab(container, body);

    container.querySelector('#siteOn').addEventListener('change', async (e) => {
      site.enabled = e.target.checked;
      await save();
      Utils.toast(site.enabled ? 'الموقع هيشتغل بعد النشر' : 'هيتقفل بعد النشر', 'info');
      render(container);
    });
    container.querySelector('#publishBtn').addEventListener('click', () => publish(container));
    const cp = container.querySelector('#copyUrl');
    if (cp) cp.addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(
        () => Utils.toast('الرابط اتنسخ — الزقه في صفحة الفيسبوك', 'success'),
        () => Utils.toast('مقدرش ينسخ', 'error'));
    });
    container.querySelectorAll('.site-tab').forEach(b => b.addEventListener('click', () => {
      tab = b.dataset.tab;
      container.querySelectorAll('.site-tab').forEach(x => x.classList.toggle('on', x === b));
      drawTab(container, body);
    }));
    if (info && info.busy) startPoll(container);
  }

  // خانة نص بتتحفظ أول ما يسيبها
  function field(label, path, opts) {
    const o = opts || {};
    const v = get(path);
    const inp = o.area
      ? `<textarea data-f="${path}" rows="${o.rows || 3}" placeholder="${esc(o.ph || '')}">${esc(v)}</textarea>`
      : `<input type="${o.type || 'text'}" data-f="${path}" value="${esc(v)}" placeholder="${esc(o.ph || '')}" ${o.inputmode ? 'inputmode="' + o.inputmode + '"' : ''}>`;
    return `<div class="field"><label>${esc(label)}</label>${inp}${o.hint ? `<div class="hint">${esc(o.hint)}</div>` : ''}</div>`;
  }
  function get(path) {
    return path.split('.').reduce((o, k) => (o == null ? '' : o[k]), site) ?? '';
  }
  function set(path, val) {
    const ks = path.split('.');
    let o = site;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] = o[ks[i]] || {};
    o[ks[ks.length - 1]] = val;
  }
  function bindFields(box, after) {
    box.querySelectorAll('[data-f]').forEach(el => {
      el.addEventListener('change', async () => {
        set(el.dataset.f, el.value.trim());
        await save();
        if (after) after();
      });
    });
  }

  // صورة مع زرار غيّر/امسح
  function imgBox(src, label) {
    return `
      <div class="img-pick">
        <div class="img-th">${src ? `<img src="site-img/${esc(src)}" alt="">` : '<span>مفيش صورة</span>'}</div>
        <div class="img-btns">
          <button type="button" class="btn btn-ghost btn-sm im-set">${src ? 'غيّر الصورة' : '📷 ' + esc(label || 'ارفع صورة')}</button>
          ${src ? '<button type="button" class="btn btn-ghost btn-sm im-clr">شيلها</button>' : ''}
        </div>
      </div>`;
  }

  function drawTab(container, body) {
    const T = {
      brand: drawBrand, hero: drawHero, products: drawProducts,
      offers: drawOffers, about: drawAbout, order: drawOrder, images: drawImages
    };
    (T[tab] || drawBrand)(container, body);
  }

  // ---------- بيانات المحل ----------
  function drawBrand(container, body) {
    body.innerHTML = `
      <div class="card">
        <div class="field-row">
          ${field('اسم المحل', 'brand.name')}
          ${field('سطر تعريفي صغير', 'brand.tagline', { ph: 'كهرباء وحدايد ومفاتيح' })}
        </div>
        <div class="field-row">
          ${field('تليفون', 'brand.phone', { inputmode: 'tel' })}
          ${field('تليفون تاني', 'brand.phone2', { inputmode: 'tel' })}
          ${field('واتساب', 'brand.whatsapp', { inputmode: 'tel', hint: 'سيبه فاضي لو نفس التليفون' })}
        </div>
        ${field('العنوان', 'brand.address')}
        <div class="field-row">
          ${field('لينك الخريطة (جوجل ماب)', 'brand.mapUrl', { ph: 'https://maps.app.goo.gl/...' })}
          ${field('لينك صفحة الفيسبوك', 'brand.facebook', { ph: 'https://facebook.com/...' })}
        </div>
        ${field('مواعيد الشغل', 'brand.hours')}
      </div>`;
    bindFields(body);
  }

  // ---------- الواجهة ----------
  function drawHero(container, body) {
    body.innerHTML = `
      <div class="card">
        <h3 class="mini-head">أول حاجة الزبون بيشوفها</h3>
        ${field('العنوان الكبير', 'hero.title')}
        ${field('السطر اللي تحته', 'hero.subtitle', { area: true, rows: 2 })}
        <label class="lbl">صورة الخلفية (اختياري — صورة المحل من بره أو الرفوف)</label>
        <div id="heroImg">${imgBox(site.hero.image, 'ارفع صورة الواجهة')}</div>
        <hr class="sep">
        ${field('شريط إعلان فوق الموقع (اختياري)', 'banner', { ph: 'مثلاً: خصم ١٠٪ على الأسلاك الأسبوع ده' })}
      </div>`;
    bindFields(body);
    bindImg(body.querySelector('#heroImg'), () => site.hero.image, async (v) => {
      site.hero.image = v; await save(); drawHero(container, body);
    });
  }

  function bindImg(box, getV, setV) {
    if (!box) return;
    const s = box.querySelector('.im-set');
    const c = box.querySelector('.im-clr');
    if (s) s.addEventListener('click', async () => {
      if (!onPc()) { Utils.toast('رفع الصور من الكمبيوتر', 'error'); return; }
      const n = await pickImage();
      if (n) await setV(n);
    });
    if (c) c.addEventListener('click', async () => { await setV(''); });
  }

  // ---------- المنتجات ----------
  function drawProducts(container, body) {
    // الأسعار بتتحدث من البرنامج مع كل رسم — فاللي على الموقع دايمًا سعرك الحالي
    site.products.forEach(p => {
      const it = AppState.items.find(i => i.id === p.itemId);
      if (it) { p.price = Number(it.salePrice || 0); p.unit = it.unit || p.unit; }
    });

    body.innerHTML = `
      <div class="card">
        <div class="section-head">
          <div>
            <h3 class="mini-head">المنتجات اللي بتظهر على الموقع</h3>
            <div class="hint">الأسعار بتتحدث لوحدها من سعر البيع في البرنامج. رتّبهم بالسهمين — الأول بيظهر الأول.</div>
          </div>
          <button type="button" class="btn btn-amber" id="addProd">+ ضيف منتج من المخزن</button>
        </div>
        ${site.products.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>الصورة</th><th>الاسم على الموقع</th><th>وصف صغير</th><th>التصنيف</th><th>السعر</th><th>الترتيب</th><th></th></tr></thead>
            <tbody id="prodBody">
              ${site.products.map((p, i) => `
              <tr data-i="${i}">
                <td class="pcell">${p.image
                  ? `<img class="pth" src="site-img/${esc(p.image)}" alt="">`
                  : '<span class="pth empty">📦</span>'}
                  <button type="button" class="link-btn p-img">${p.image ? 'غيّر' : 'ارفع صورة'}</button></td>
                <td><input class="cell p-name" value="${esc(p.name)}"></td>
                <td><input class="cell p-desc" value="${esc(p.desc || '')}" placeholder="اختياري"></td>
                <td><input class="cell p-cat" value="${esc(p.category || '')}" list="siteCats"></td>
                <td class="strong">${money(p.price)}</td>
                <td style="white-space:nowrap;">
                  <button type="button" class="icon-btn p-up" ${i === 0 ? 'disabled' : ''}>▲</button>
                  <button type="button" class="icon-btn p-dn" ${i === site.products.length - 1 ? 'disabled' : ''}>▼</button>
                </td>
                <td><button type="button" class="icon-btn p-del" title="شيله من الموقع">🗑️</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <datalist id="siteCats">${[...new Set(AppState.items.map(i => i.category).filter(Boolean))]
          .map(c => `<option value="${esc(c)}">`).join('')}</datalist>`
        : `<p class="empty-note">لسه مفيش منتجات على الموقع. دوس «ضيف منتج من المخزن» واختار اللي عايز الناس تشوفه.</p>`}
      </div>`;

    body.querySelector('#addProd').addEventListener('click', () => openPicker(container, body));
    const tb = body.querySelector('#prodBody');
    if (!tb) return;
    tb.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr'); if (!tr) return;
      const i = Number(tr.dataset.i);
      if (e.target.classList.contains('p-del')) {
        if (!(await Utils.confirmDialog('تشيل «' + site.products[i].name + '» من الموقع؟'))) return;
        site.products.splice(i, 1); await save(); drawProducts(container, body);
      } else if (e.target.classList.contains('p-up')) {
        [site.products[i - 1], site.products[i]] = [site.products[i], site.products[i - 1]];
        await save(); drawProducts(container, body);
      } else if (e.target.classList.contains('p-dn')) {
        [site.products[i + 1], site.products[i]] = [site.products[i], site.products[i + 1]];
        await save(); drawProducts(container, body);
      } else if (e.target.classList.contains('p-img')) {
        if (!onPc()) { Utils.toast('رفع الصور من الكمبيوتر', 'error'); return; }
        const n = await pickImage();
        if (n) { site.products[i].image = n; await save(); drawProducts(container, body); }
      }
    });
    tb.addEventListener('change', async (e) => {
      const tr = e.target.closest('tr'); if (!tr) return;
      const p = site.products[Number(tr.dataset.i)];
      if (e.target.classList.contains('p-name')) p.name = e.target.value.trim();
      if (e.target.classList.contains('p-desc')) p.desc = e.target.value.trim();
      if (e.target.classList.contains('p-cat')) p.category = e.target.value.trim();
      await save();
    });
  }

  function openPicker(container, body) {
    const chosen = new Set(site.products.map(p => p.itemId));
    Utils.openModal({
      title: 'اختار المنتجات اللي هتظهر على الموقع',
      wide: true,
      bodyHtml: `
        <div class="search-box" style="margin-bottom:12px;">
          <input type="text" id="pkSearch" placeholder="ابحث بالاسم أو الباركود..." autofocus>
        </div>
        <div class="hint" style="margin-bottom:10px;">دوس على الصنف عشان تضيفه — تقدر تختار أكتر من واحد.</div>
        <div id="pkList" class="pk-list"></div>`,
      onMount: (mb, close) => {
        const list = mb.querySelector('#pkList');
        const draw = (q) => {
          let items = AppState.items.filter(i => i.active !== false);
          if (q) items = Search.items(q, items);
          items = items.slice(0, 60);
          list.innerHTML = items.length ? items.map(i => `
            <button type="button" class="pk-row ${chosen.has(i.id) ? 'in' : ''}" data-id="${i.id}">
              <span class="pk-n">${esc(i.name)}</span>
              <span class="pk-c">${esc(i.category || '—')}</span>
              <span class="pk-p">${money(i.salePrice)}</span>
              <span class="pk-a">${chosen.has(i.id) ? '✓ على الموقع' : '+ ضيف'}</span>
            </button>`).join('') : '<p class="empty-note">مفيش نتيجة</p>';
        };
        draw('');
        mb.querySelector('#pkSearch').addEventListener('input', Utils.debounce(e => draw(e.target.value), 150));
        list.addEventListener('click', async (e) => {
          const b = e.target.closest('.pk-row'); if (!b) return;
          const id = Number(b.dataset.id);
          const it = AppState.items.find(x => x.id === id);
          if (chosen.has(id)) {
            chosen.delete(id);
            site.products = site.products.filter(p => p.itemId !== id);
          } else {
            chosen.add(id);
            site.products.push({
              itemId: id, name: it.name, price: Number(it.salePrice || 0),
              unit: it.unit || '', category: it.category || '', image: '', desc: ''
            });
          }
          await save();
          draw(mb.querySelector('#pkSearch').value);
          drawProducts(container, body);
        });
      }
    });
  }

  // ---------- العروض ----------
  function drawOffers(container, body) {
    body.innerHTML = `
      <div class="card">
        <div class="section-head">
          <div><h3 class="mini-head">العروض</h3>
            <div class="hint">العرض بيظهر فوق في مكان واضح بلونه. سيبه من غير سعر لو عايزه إعلان بس.</div></div>
          <button type="button" class="btn btn-amber" id="addOffer">+ اكتب عرض</button>
        </div>
        ${site.offers.length ? `<div class="off-list">${site.offers.map((o, i) => `
          <div class="off-row" data-i="${i}">
            <div class="off-th">${o.image ? `<img src="site-img/${esc(o.image)}" alt="">` : '🏷️'}</div>
            <div class="off-txt">
              <strong>${esc(o.title)}</strong>
              ${o.desc ? `<span>${esc(o.desc)}</span>` : ''}
              <span class="off-p">${Number(o.price) > 0 ? money(o.price) + ' ج.م' : 'من غير سعر'}
                ${Number(o.oldPrice) > Number(o.price) ? `<s>${money(o.oldPrice)}</s>` : ''}
                ${o.until ? ` · لحد ${esc(o.until)}` : ''}</span>
            </div>
            <div class="off-btns">
              <button type="button" class="icon-btn o-edit">✏️</button>
              <button type="button" class="icon-btn o-del">🗑️</button>
            </div>
          </div>`).join('')}</div>`
        : `<p class="empty-note">مفيش عروض دلوقتي.</p>`}
      </div>`;

    body.querySelector('#addOffer').addEventListener('click', () => openOffer(container, body, null));
    const lst = body.querySelector('.off-list');
    if (lst) lst.addEventListener('click', async (e) => {
      const row = e.target.closest('.off-row'); if (!row) return;
      const i = Number(row.dataset.i);
      if (e.target.classList.contains('o-edit')) openOffer(container, body, i);
      if (e.target.classList.contains('o-del')) {
        if (!(await Utils.confirmDialog('تمسح العرض ده؟'))) return;
        site.offers.splice(i, 1); await save(); drawOffers(container, body);
      }
    });
  }

  function openOffer(container, body, idx) {
    const o = idx == null
      ? { title: '', desc: '', price: '', oldPrice: '', image: '', until: '' }
      : Object.assign({}, site.offers[idx]);
    Utils.openModal({
      title: idx == null ? 'عرض جديد' : 'تعديل العرض',
      bodyHtml: `
        <form id="offForm" novalidate>
          <div class="field"><label>العنوان</label>
            <input id="oTitle" value="${esc(o.title)}" placeholder="مثلاً: لمبة ليد ٩ وات" autofocus></div>
          <div class="field"><label>الوصف (اختياري)</label>
            <textarea id="oDesc" rows="2" placeholder="تفاصيل العرض">${esc(o.desc)}</textarea></div>
          <div class="field-row">
            <div class="field"><label>سعر العرض</label>
              <input type="number" id="oPrice" min="0" step="0.01" inputmode="decimal" value="${o.price ?? ''}"></div>
            <div class="field"><label>السعر قبل العرض</label>
              <input type="number" id="oOld" min="0" step="0.01" inputmode="decimal" value="${o.oldPrice ?? ''}"
                     placeholder="عشان يبان الخصم"></div>
            <div class="field"><label>العرض لحد</label>
              <input id="oUntil" value="${esc(o.until)}" placeholder="آخر الشهر"></div>
          </div>
          <label class="lbl">صورة العرض</label>
          <div id="offImg">${imgBox(o.image, 'ارفع صورة العرض')}</div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" id="oCancel">إلغاء</button>
            <button type="submit" class="btn btn-amber">حفظ</button>
          </div>
        </form>`,
      onMount: (mb, close) => {
        // الصورة بتتغير جوه النافذة من غير ما نقفلها — فبنعيد ربط زراريها كل مرة
        const setImg = async (v) => {
          o.image = v;
          const box = mb.querySelector('#offImg');
          box.innerHTML = imgBox(o.image, 'ارفع صورة العرض');
          bindImg(box, () => o.image, setImg);
        };
        bindImg(mb.querySelector('#offImg'), () => o.image, setImg);
        mb.querySelector('#oCancel').addEventListener('click', close);
        Utils.guardSubmit(mb.querySelector('#offForm'), async (e) => {
          e.preventDefault();
          const rec = {
            title: mb.querySelector('#oTitle').value.trim(),
            desc: mb.querySelector('#oDesc').value.trim(),
            price: Number(mb.querySelector('#oPrice').value || 0),
            oldPrice: Number(mb.querySelector('#oOld').value || 0),
            until: mb.querySelector('#oUntil').value.trim(),
            image: o.image || ''
          };
          if (!rec.title) { Utils.toast('اكتب عنوان العرض', 'error'); return; }
          if (idx == null) site.offers.push(rec); else site.offers[idx] = rec;
          await save();
          close();
          drawOffers(container, body);
        });
      }
    });
  }

  // ---------- من إحنا والمزايا ----------
  function drawAbout(container, body) {
    body.innerHTML = `
      <div class="card">
        ${field('كلمة عن المحل', 'about', { area: true, rows: 4 })}
        <hr class="sep">
        <h3 class="mini-head">المزايا (الشريط اللي تحت الواجهة)</h3>
        <div class="feat-edit">
          ${site.features.map((f, i) => `
            <div class="fe-row" data-i="${i}">
              <input class="cell fe-i" value="${esc(f.icon)}" maxlength="3" title="رمز">
              <input class="cell fe-t" value="${esc(f.title)}" placeholder="العنوان">
              <input class="cell fe-x" value="${esc(f.text)}" placeholder="سطر صغير">
              <button type="button" class="icon-btn fe-del">🗑️</button>
            </div>`).join('')}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="addFeat" style="margin-top:10px;">+ ميزة</button>
      </div>`;
    bindFields(body);
    const fe = body.querySelector('.feat-edit');
    fe.addEventListener('change', async (e) => {
      const row = e.target.closest('.fe-row'); if (!row) return;
      const f = site.features[Number(row.dataset.i)];
      if (e.target.classList.contains('fe-i')) f.icon = e.target.value.trim();
      if (e.target.classList.contains('fe-t')) f.title = e.target.value.trim();
      if (e.target.classList.contains('fe-x')) f.text = e.target.value.trim();
      await save();
    });
    fe.addEventListener('click', async (e) => {
      if (!e.target.classList.contains('fe-del')) return;
      site.features.splice(Number(e.target.closest('.fe-row').dataset.i), 1);
      await save(); drawAbout(container, body);
    });
    body.querySelector('#addFeat').addEventListener('click', async () => {
      site.features.push({ icon: '✅', title: '', text: '' });
      await save(); drawAbout(container, body);
    });
  }

  // ---------- الطلبات ----------
  function drawOrder(container, body) {
    const ready = !!(site.order.relayUrl || '').trim();
    body.innerHTML = `
      <div class="card">
        <div class="notice ${ready ? 'notice-ok' : 'notice-warn'}" style="margin-bottom:14px;">
          ${ready
            ? '✅ الطلبات متوصّلة — أول ما الزبون يدوس «إتمام الشراء» الطلب هيوصلك على تليجرام والإيميل في نفس اللحظة.'
            : '⚠️ لسه ما ظبطناش وصول الطلبات. دلوقتي الزبون هيدوس «إتمام الشراء» وهيشوف إن طلبه اتسجل — بس مش هيوصلك إشعار. حطّ اللينك تحت وهي تشتغل.'}
        </div>
        ${field('لينك استقبال الطلبات', 'order.relayUrl', { ph: 'https://script.google.com/macros/s/.../exec' })}
        ${field('كلمة للزبون بعد الطلب', 'order.note', { area: true, rows: 2 })}
        ${field('مناطق التوصيل (اختياري)', 'order.areas', { ph: 'مثلاً: المنطقة والعزب المجاورة' })}

        <details class="setup" ${ready ? '' : 'open'}>
          <summary>إزاي أظبط وصول الطلبات؟ (مرة واحدة — حوالي ٥ دقايق)</summary>
          <ol class="steps">
            <li><strong>اعمل بوت على تليجرام:</strong> افتح تليجرام، دوّر على
              <code>@BotFather</code>، ابعتله <code>/newbot</code>، سمّي البوت أي اسم
              (مثلاً «طلبات المصطفى») والاسم المستخدم لازم ينتهي بـ <code>bot</code>.
              هيبعتلك سطر طويل اسمه <strong>token</strong> — احفظه.</li>
            <li><strong>هات رقم محادثتك:</strong> دوّر على <code>@userinfobot</code> وابعتله أي رسالة،
              هيقولك <strong>Id</strong> — ده رقمك. وابعت كلمة أي حاجة للبوت بتاعك الأول
              عشان يبقى مسموحله يكلمك.</li>
            <li><strong>افتح <a href="https://script.google.com" target="_blank" rel="noopener">script.google.com</a></strong>
              بحسابك على جوجل ← <strong>New project</strong> ← امسح اللي مكتوب والصق الكود اللي تحت.</li>
            <li>غيّر أول ٣ سطور بس: التوكن، ورقمك، وإيميلك.</li>
            <li>دوس <strong>Deploy ← New deployment ← Web app</strong>، وفي
              <strong>Who has access</strong> اختار <strong>Anyone</strong>، وبعدين
              <strong>Deploy</strong> (هيطلب إذن — وافق).</li>
            <li>هيديك لينك بينتهي بـ <code>/exec</code> — الصقه فوق في خانة
              «لينك استقبال الطلبات»، وبعدين دوس «انشر التعديلات».</li>
          </ol>
          <div class="code-head">
            <strong>الكود</strong>
            <button type="button" class="btn btn-ghost btn-sm" id="copyCode">انسخ الكود</button>
          </div>
          <pre class="code">${esc(RELAY_CODE)}</pre>
        </details>
      </div>`;
    bindFields(body, () => drawOrder(container, body));
    const cc = body.querySelector('#copyCode');
    if (cc) cc.addEventListener('click', () => {
      navigator.clipboard.writeText(RELAY_CODE).then(
        () => Utils.toast('الكود اتنسخ — الصقه في script.google.com', 'success'),
        () => Utils.toast('مقدرش ينسخ — علّم على الكود وانسخه بإيدك', 'error'));
    });
  }

  /* الوسيط اللي بيستلم الطلب من الموقع ويبعته على تليجرام والإيميل.
     بيتحط في حساب جوجل بتاع صاحب المحل — يعني توكن البوت مش مكتوب
     في الموقع نفسه، فمحدش يقدر يستعمله غيره. */
  const RELAY_CODE = [
    "// ===== إعدادات: غيّر التلات سطور دول بس =====",
    "var TELEGRAM_TOKEN = 'حط التوكن هنا';",
    "var CHAT_ID        = 'حط رقمك هنا';",
    "var EMAIL          = 'حط إيميلك هنا';",
    "",
    "function doPost(e) {",
    "  var o = JSON.parse(e.postData.contents);",
    "",
    "  // لو نفس الطلب وصل مرتين (النت قطع ورجع) بيتحسب مرة واحدة",
    "  var cache = CacheService.getScriptCache();",
    "  if (o.ref && cache.get('r' + o.ref)) return ok();",
    "  if (o.ref) cache.put('r' + o.ref, '1', 21600);",
    "",
    "  var lines = (o.items || []).map(function (i) {",
    "    return '• ' + i.name + '  x' + i.qty + '  =  ' + (i.qty * i.price) + ' EGP';",
    "  }).join('\\n');",
    "",
    "  var msg = 'طلب جديد من الموقع' +",
    "    '\\n\\nالاسم: ' + o.name +",
    "    '\\nالتليفون: ' + o.phone +",
    "    '\\nالعنوان: ' + o.address +",
    "    (o.notes ? '\\nملاحظات: ' + o.notes : '') +",
    "    '\\n\\n' + lines +",
    "    '\\n\\nالإجمالي: ' + o.total +",
    "    '\\nرقم الطلب: ' + o.ref;",
    "",
    "  if (TELEGRAM_TOKEN.indexOf('حط') < 0) {",
    "    UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage', {",
    "      method: 'post', muteHttpExceptions: true,",
    "      payload: { chat_id: CHAT_ID, text: msg }",
    "    });",
    "  }",
    "  if (EMAIL.indexOf('حط') < 0) {",
    "    MailApp.sendEmail(EMAIL, 'طلب جديد من الموقع - ' + o.name, msg);",
    "  }",
    "  return ok();",
    "}",
    "",
    "function ok() {",
    "  return ContentService.createTextOutput('{\"ok\":true}')",
    "    .setMimeType(ContentService.MimeType.JSON);",
    "}",
    "",
    "// عشان تتأكد إنه شغال: افتح اللينك في المتصفح",
    "function doGet() {",
    "  return ContentService.createTextOutput('الوسيط شغال');",
    "}"
  ].join('\n');

  // ---------- الصور ----------
  function drawImages(container, body) {
    const imgs = (info && info.images) || [];
    body.innerHTML = `
      <div class="card">
        <div class="section-head">
          <div><h3 class="mini-head">كل الصور اللي على الموقع</h3>
            <div class="hint">الصورة اللي مش مستعملة في أي حاجة تقدر تمسحها عشان الموقع يفضل خفيف.</div></div>
          <button type="button" class="btn btn-ghost" id="upImg">📷 ارفع صورة</button>
        </div>
        ${imgs.length ? `<div class="img-grid">${imgs.map(im => {
          const users = imageUsers(im.name);
          return `
          <div class="img-cell" data-n="${esc(im.name)}">
            <img src="site-img/${esc(im.name)}" alt="" loading="lazy">
            <div class="ic-meta">${Math.round(im.size / 1024)} ك.ب</div>
            <div class="ic-use ${users.length ? 'on' : ''}">${users.length ? esc(users.slice(0, 2).join('، ')) : 'مش مستعملة'}</div>
            <button type="button" class="icon-btn ic-del" title="امسح الصورة">🗑️</button>
          </div>`; }).join('')}</div>`
        : `<p class="empty-note">مفيش صور لسه.</p>`}
      </div>`;

    body.querySelector('#upImg').addEventListener('click', async () => {
      if (!onPc()) { Utils.toast('رفع الصور من الكمبيوتر', 'error'); return; }
      const n = await pickImage();
      if (n) { await refreshInfo(); drawImages(container, body); }
    });
    const grid = body.querySelector('.img-grid');
    if (grid) grid.addEventListener('click', async (e) => {
      if (!e.target.classList.contains('ic-del')) return;
      const name = e.target.closest('.img-cell').dataset.n;
      const users = imageUsers(name);
      const msg = users.length
        ? 'الصورة دي مستعملة في: ' + users.join('، ') + '\n\nلو مسحتها هتختفي من الموقع. تكمّل؟'
        : 'تمسح الصورة دي؟';
      if (!(await Utils.confirmDialog(msg))) return;
      try {
        await api('api/site/delete', { paths: ['img/' + name] });
        if (site.hero.image === name) site.hero.image = '';
        site.products.forEach(p => { if (p.image === name) p.image = ''; });
        site.offers.forEach(o => { if (o.image === name) o.image = ''; });
        await save();
        await refreshInfo();
        drawImages(container, body);
        Utils.toast('اتمسحت', 'success');
      } catch (err) { Utils.toast(err.message || 'مقدرش يمسح', 'error'); }
    });
  }

  return { render, _site: () => site };
})();
