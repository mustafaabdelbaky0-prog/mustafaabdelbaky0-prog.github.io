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
  /* بيفتح اختيار صورة، يعدّيها على الاستوديو (تنضيف الخلفية والقص
     والإضاءة)، وبعد ما يوافق بيرفعها ويرجّع اسم الملف. */
  function pickImage() {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0];
        if (!f) { resolve(null); return; }
        const upload = async (b64) => {
          try {
            const name = newImageName();
            await api('api/site/save', { files: [{ path: 'img/' + name, b64 }] });
            dirty = true;
            resolve(name);
          } catch (e) { Utils.toast(e.message || 'الصورة ما اترفعتش', 'error'); resolve(null); }
        };
        if (typeof Photo !== 'undefined') {
          const b64 = await Photo.open(f);
          if (b64) await upload(b64); else resolve(null);
        } else {
          try { await upload(await shrink(f, 1000)); }
          catch (e) { Utils.toast('الصورة ما اترفعتش', 'error'); resolve(null); }
        }
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
        ${[['brand', '🏪 بيانات المحل'], ['hero', '🖼️ الواجهة'], ['sections', '🗂️ الأقسام'],
           ['products', '📦 المنتجات'], ['offers', '🏷️ العروض'], ['bundles', '🎁 الباكدچات'],
           ['about', '📝 من إحنا والمزايا'], ['order', '📬 الطلبات'], ['images', '🖼️ الصور']]
          .map(([k, t]) => `<button type="button" class="site-tab ${tab === k ? 'on' : ''}" data-tab="${k}">${t}
            ${k === 'sections' && site.sections.length ? `<span class="n">${site.sections.length}</span>` : ''}
            ${k === 'products' && site.products.length ? `<span class="n">${site.products.length}</span>` : ''}
            ${k === 'offers' && site.offers.length ? `<span class="n">${site.offers.length}</span>` : ''}
            ${k === 'bundles' && site.bundles.length ? `<span class="n">${site.bundles.length}</span>` : ''}</button>`).join('')}
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
      brand: drawBrand, hero: drawHero, sections: drawSections, products: drawProducts,
      offers: drawOffers, bundles: drawBundles, about: drawAbout, order: drawOrder, images: drawImages
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

  // ---------- الأقسام ----------
  /* شجرة: قسم رئيسي (كهرباء) وجواه أقسام (اي لوك، اليوس) وجوّاهم
     أقسام تاني لو حب. المنتج بيتربط بأصغر قسم، ولما الزبون يدوس على
     القسم الكبير بيشوف كل اللي تحته. */
  function nextSecId() {
    const used = (site.sections || []).map(x => Number(x.id) || 0);
    const n = Math.max(Number(site.seq || 1), used.length ? Math.max(...used) + 1 : 1);
    site.seq = n + 1;
    return n;
  }
  const flat = () => SiteGen.flatSections(site);
  const kidsOf = id => site.sections.filter(x => Number(x.parent || 0) === Number(id || 0)
                                             || (id == null && (x.parent == null || x.parent === '')));
  function inSection(id) {   // المنتجات اللي في القسم ده أو أي قسم تحته
    const ids = [Number(id)];
    const walk = p => site.sections.filter(x => Number(x.parent) === Number(p))
      .forEach(c => { ids.push(Number(c.id)); walk(c.id); });
    walk(id);
    return site.products.filter(p => ids.indexOf(Number(p.sectionId)) >= 0);
  }

  function drawSections(container, body) {
    const rows = flat();
    const loose = site.products.filter(p => !site.sections.some(x => Number(x.id) === Number(p.sectionId)));
    body.innerHTML = `
      <div class="card">
        <div class="section-head">
          <div><h3 class="mini-head">أقسام الموقع</h3>
            <div class="hint">اعمل قسم رئيسي (كهرباء، حدايد) وجواه أقسام زي ما تحب (اي لوك، اليوس).
              المنتج بيتحط في أصغر قسم، ولما الزبون يدوس على «كهرباء» هيشوف كل اللي تحتها.</div></div>
          <button type="button" class="btn btn-amber" id="addTop">+ قسم رئيسي</button>
        </div>

        ${rows.length ? `<div class="tree" id="tree">
          ${rows.map(({ sec, depth }) => {
            const n = inSection(sec.id).length;
            const own = site.products.filter(p => Number(p.sectionId) === Number(sec.id)).length;
            const sibs = flat().filter(r => Number(r.sec.parent || 0) === Number(sec.parent || 0));
            const pos = sibs.findIndex(r => Number(r.sec.id) === Number(sec.id));
            return `
            <div class="tr-row" data-id="${sec.id}" style="margin-inline-start:${depth * 26}px;">
              <span class="tr-dash">${depth ? '↳' : '▪'}</span>
              <input class="cell tr-name" value="${esc(sec.name)}">
              <span class="tr-n" title="${own} في القسم ده نفسه">${n} صنف</span>
              <button type="button" class="icon-btn tr-add" title="قسم جوّه ده">＋</button>
              <button type="button" class="icon-btn tr-up" ${pos <= 0 ? 'disabled' : ''}>▲</button>
              <button type="button" class="icon-btn tr-dn" ${pos < 0 || pos >= sibs.length - 1 ? 'disabled' : ''}>▼</button>
              <button type="button" class="icon-btn tr-del" title="امسح القسم">🗑️</button>
            </div>`;
          }).join('')}
        </div>` : `<p class="empty-note">لسه مفيش أقسام. ابدأ بـ «كهرباء» و«حدايد».</p>`}

        ${loose.length ? `
        <div class="notice notice-warn" style="margin-top:14px;">
          فيه <strong>${loose.length}</strong> صنف لسه مش في أي قسم — هيظهروا على الموقع تحت «باقي الأصناف».
          روح لقسم <strong>المنتجات</strong> وحطهم في أقسامهم.
        </div>` : ''}
      </div>`;

    body.querySelector('#addTop').addEventListener('click', () => addSection(null, container, body));
    const tree = body.querySelector('#tree');
    if (!tree) return;
    tree.addEventListener('click', async (e) => {
      const row = e.target.closest('.tr-row'); if (!row) return;
      const id = Number(row.dataset.id);
      const sec = site.sections.find(x => Number(x.id) === id);
      if (e.target.classList.contains('tr-add')) { addSection(id, container, body); return; }
      if (e.target.classList.contains('tr-del')) {
        const inside = inSection(id);
        const subs = site.sections.filter(x => Number(x.parent) === id);
        let msg = 'تمسح قسم «' + sec.name + '»؟';
        if (subs.length) msg += '\nوجواه ' + subs.length + ' قسم هيتمسحوا كمان.';
        if (inside.length) msg += '\nو' + inside.length + ' صنف هيرجعوا من غير قسم (مش هيتمسحوا).';
        if (!(await Utils.confirmDialog(msg))) return;
        const kill = [id].concat(SiteGen.flatSections(site)
          .filter(r => secAncestors(r.sec.id).indexOf(id) >= 0).map(r => Number(r.sec.id)));
        site.sections = site.sections.filter(x => kill.indexOf(Number(x.id)) < 0);
        site.products.forEach(p => { if (kill.indexOf(Number(p.sectionId)) >= 0) p.sectionId = null; });
        await save(); drawSections(container, body);
        return;
      }
      if (e.target.classList.contains('tr-up') || e.target.classList.contains('tr-dn')) {
        const dir = e.target.classList.contains('tr-up') ? -1 : 1;
        const sibs = site.sections.filter(x => Number(x.parent || 0) === Number(sec.parent || 0))
          .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
        const i = sibs.findIndex(x => Number(x.id) === id);
        const j = i + dir;
        if (j < 0 || j >= sibs.length) return;
        const tmp = Number(sibs[i].order || 0);
        sibs[i].order = Number(sibs[j].order || 0);
        sibs[j].order = tmp;
        if (sibs[i].order === sibs[j].order) { sibs.forEach((x, k) => x.order = k); const t2 = sibs[i].order; sibs[i].order = sibs[j].order; sibs[j].order = t2; }
        await save(); drawSections(container, body);
        return;
      }
    });
    tree.addEventListener('change', async (e) => {
      if (!e.target.classList.contains('tr-name')) return;
      const id = Number(e.target.closest('.tr-row').dataset.id);
      const sec = site.sections.find(x => Number(x.id) === id);
      const v = e.target.value.trim();
      if (!v) { e.target.value = sec.name; return; }
      sec.name = v; await save();
    });
  }
  function secAncestors(id) {
    const out = [];
    let cur = site.sections.find(x => Number(x.id) === Number(id)), g = 0;
    while (cur && g++ < 20) { cur = site.sections.find(x => Number(x.id) === Number(cur.parent)); if (cur) out.push(Number(cur.id)); }
    return out;
  }
  async function addSection(parent, container, body) {
    const name = await Utils.promptDialog(parent ? 'اسم القسم الجديد جوّه' : 'اسم القسم الرئيسي',
      { placeholder: parent ? 'مثلاً: اي لوك' : 'مثلاً: كهرباء' });
    if (name == null) return;
    const v = String(name).trim();
    if (!v) return;
    const sibs = site.sections.filter(x => Number(x.parent || 0) === Number(parent || 0));
    site.sections.push({ id: nextSecId(), name: v, parent: parent == null ? null : Number(parent),
                         order: sibs.length });
    await save();
    drawSections(container, body);
  }

  // قايمة الأقسام لاختيار قسم المنتج
  function sectionOptions(current) {
    return `<option value="">— من غير قسم —</option>` +
      flat().map(({ sec, depth }) =>
        `<option value="${sec.id}" ${Number(current) === Number(sec.id) ? 'selected' : ''}>${
          esc('  '.repeat(depth) + (depth ? '↳ ' : '') + sec.name)}</option>`).join('');
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
            <thead><tr><th>الصورة</th><th>الاسم على الموقع</th><th>القسم</th><th>الشرح والمواصفات</th><th>السعر</th><th>الترتيب</th><th></th></tr></thead>
            <tbody id="prodBody">
              ${site.products.map((p, i) => {
                const nSpecs = (p.specs || []).filter(x => (x.k || '').trim()).length;
                return `
              <tr data-i="${i}">
                <td class="pcell">${p.image
                  ? `<img class="pth" src="site-img/${esc(p.image)}" alt="">`
                  : '<span class="pth empty">📦</span>'}
                  <button type="button" class="link-btn p-img">${p.image ? 'غيّر' : 'ارفع صورة'}</button></td>
                <td><input class="cell p-name" value="${esc(p.name)}"></td>
                <td><select class="cell p-sec">${sectionOptions(p.sectionId)}</select></td>
                <td>
                  <button type="button" class="link-btn p-edit">${
                    p.about || nSpecs
                      ? '✏️ ' + (nSpecs ? nSpecs + ' مواصفة' : '') + (p.about ? (nSpecs ? ' + شرح' : 'فيه شرح') : '')
                      : '➕ اكتب الشرح والمواصفات'}</button>
                </td>
                <td class="strong">${money(p.price)}</td>
                <td style="white-space:nowrap;">
                  <button type="button" class="icon-btn p-up" ${i === 0 ? 'disabled' : ''}>▲</button>
                  <button type="button" class="icon-btn p-dn" ${i === site.products.length - 1 ? 'disabled' : ''}>▼</button>
                </td>
                <td><button type="button" class="icon-btn p-del" title="شيله من الموقع">🗑️</button></td>
              </tr>`; }).join('')}
            </tbody>
          </table>
        </div>`
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
      } else if (e.target.classList.contains('p-edit')) {
        openProductEditor(i, container, body);
      }
    });
    tb.addEventListener('change', async (e) => {
      const tr = e.target.closest('tr'); if (!tr) return;
      const p = site.products[Number(tr.dataset.i)];
      if (e.target.classList.contains('p-name')) p.name = e.target.value.trim();
      if (e.target.classList.contains('p-sec')) p.sectionId = e.target.value ? Number(e.target.value) : null;
      await save();
    });
  }

  /* محرر المنتج: الشرح الكامل والمواصفات (بيتحمل كام، الضمان، المقاس…)
     وصور زيادة. ده اللي الزبون بيشوفه لما يدوس على المنتج. */
  function openProductEditor(i, container, body) {
    const p = site.products[i];
    const specs = (p.specs || []).slice();
    if (!specs.length) specs.push({ k: '', v: '' });
    const extra = (p.images || []).slice();
    const specRow = (x, n) => `
      <div class="sp-row" data-n="${n}">
        <input class="cell sp-k" value="${esc(x.k || '')}" placeholder="الخانة (مثلاً: بيتحمل)">
        <input class="cell sp-v" value="${esc(x.v || '')}" placeholder="القيمة (مثلاً: ٢٥٠٠ وات)">
        <button type="button" class="icon-btn sp-del">🗑️</button>
      </div>`;

    Utils.openModal({
      title: 'تفاصيل: ' + p.name,
      wide: true,
      bodyHtml: `
        <form id="pdForm" novalidate>
          <div class="field"><label>الاسم على الموقع</label>
            <input id="pdName" value="${esc(p.name)}"></div>
          <div class="field-row">
            <div class="field"><label>القسم</label>
              <select id="pdSec">${sectionOptions(p.sectionId)}</select></div>
            <div class="field"><label>سطر صغير تحت الاسم</label>
              <input id="pdDesc" value="${esc(p.desc || '')}" placeholder="مثلاً: ضمان سنة"></div>
          </div>
          <div class="field"><label>الشرح الكامل (اللي الزبون يقراه لما يدوس على المنتج)</label>
            <textarea id="pdAbout" rows="5" placeholder="اكتب براحتك: بيستعمل في إيه، بيتحمل لحد كام، الفرق بينه وبين غيره، أي نصيحة للزبون...">${esc(p.about || '')}</textarea></div>

          <label class="lbl">المواصفات</label>
          <div class="hint" style="margin:-2px 0 8px;">زي: بيتحمل / الضمان / الماركة / المقاس / اللون</div>
          <div id="spList">${specs.map(specRow).join('')}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="spAdd" style="margin:6px 0 16px;">+ مواصفة</button>

          <label class="lbl">صور زيادة (غير الصورة الأساسية)</label>
          <div id="pdImgs" class="img-grid sm"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="pdAddImg" style="margin-top:8px;">📷 ضيف صورة</button>

          <div class="form-actions" style="margin-top:18px;">
            <button type="button" class="btn btn-ghost" id="pdCancel">إلغاء</button>
            <button type="submit" class="btn btn-amber">حفظ</button>
          </div>
        </form>`,
      onMount: (mb, close) => {
        let n = specs.length;
        const list = mb.querySelector('#spList');
        mb.querySelector('#spAdd').addEventListener('click', () => {
          list.insertAdjacentHTML('beforeend', specRow({ k: '', v: '' }, n++));
        });
        list.addEventListener('click', (e) => {
          if (!e.target.classList.contains('sp-del')) return;
          const rows = list.querySelectorAll('.sp-row');
          if (rows.length > 1) e.target.closest('.sp-row').remove();
          else { e.target.closest('.sp-row').querySelectorAll('input').forEach(x => x.value = ''); }
        });

        const drawExtra = () => {
          const box = mb.querySelector('#pdImgs');
          box.innerHTML = extra.length ? extra.map((im, k) => `
            <div class="img-cell" data-k="${k}">
              <img src="site-img/${esc(im)}" alt="">
              <button type="button" class="icon-btn ic-del">🗑️</button>
            </div>`).join('') : '<p class="empty-note" style="padding:6px 0;">مفيش صور زيادة</p>';
        };
        drawExtra();
        mb.querySelector('#pdImgs').addEventListener('click', (e) => {
          if (!e.target.classList.contains('ic-del')) return;
          extra.splice(Number(e.target.closest('.img-cell').dataset.k), 1);
          drawExtra();
        });
        mb.querySelector('#pdAddImg').addEventListener('click', async () => {
          if (!onPc()) { Utils.toast('رفع الصور من الكمبيوتر', 'error'); return; }
          const nm = await pickImage();
          if (nm) { extra.push(nm); drawExtra(); }
        });

        mb.querySelector('#pdCancel').addEventListener('click', close);
        Utils.guardSubmit(mb.querySelector('#pdForm'), async (e) => {
          e.preventDefault();
          const nm = mb.querySelector('#pdName').value.trim();
          if (!nm) { Utils.toast('الاسم مش ممكن يبقى فاضي', 'error'); return; }
          p.name = nm;
          p.desc = mb.querySelector('#pdDesc').value.trim();
          p.about = mb.querySelector('#pdAbout').value.trim();
          const sv = mb.querySelector('#pdSec').value;
          p.sectionId = sv ? Number(sv) : null;
          p.specs = [...list.querySelectorAll('.sp-row')]
            .map(r => ({ k: r.querySelector('.sp-k').value.trim(), v: r.querySelector('.sp-v').value.trim() }))
            .filter(x => x.k || x.v);
          p.images = extra.slice();
          await save();
          close();
          drawProducts(container, body);
          Utils.toast('اتحفظ — دوس «انشر التعديلات» عشان يظهر على الموقع', 'success');
        });
      }
    });
  }

  // ---------- الباكدچات ----------
  function drawBundles(container, body) {
    body.innerHTML = `
      <div class="card">
        <div class="section-head">
          <div><h3 class="mini-head">الباكدچات</h3>
            <div class="hint">كذا منتج مع بعض بسعر أقل من مجموعهم. البرنامج بيحسب التوفير ويوريه للزبون.</div></div>
          <button type="button" class="btn btn-amber" id="addBn">+ باكدچ جديد</button>
        </div>
        ${site.bundles.length ? `<div class="off-list">${site.bundles.map((bn, i) => {
          const lines = (bn.lines || []).filter(l => (l.name || '').trim());
          const full = lines.reduce((t, l) => t + Number(l.qty || 1) * Number(l.price || 0), 0);
          const save2 = full - Number(bn.price || 0);
          return `
          <div class="off-row" data-i="${i}">
            <div class="off-th">${bn.image ? `<img src="site-img/${esc(bn.image)}" alt="">` : '🎁'}</div>
            <div class="off-txt">
              <strong>${esc(bn.title)}</strong>
              <span>${lines.length} حاجة: ${esc(lines.map(l => l.name + ' ×' + (l.qty || 1)).join('، '))}</span>
              <span class="off-p">${money(bn.price)} ج.م
                ${save2 > 0 ? `<s>${money(full)}</s> <em style="color:var(--success);font-style:normal;">توفير ${money(save2)}</em>` : ''}</span>
            </div>
            <div class="off-btns">
              <button type="button" class="icon-btn b-edit">✏️</button>
              <button type="button" class="icon-btn b-del">🗑️</button>
            </div>
          </div>`; }).join('')}</div>`
        : `<p class="empty-note">مفيش باكدچات. مثال: «طقم تأسيس شقة» فيه سلك ومفاتيح وبرايز بسعر مجمّع.</p>`}
      </div>`;

    body.querySelector('#addBn').addEventListener('click', () => openBundle(container, body, null));
    const lst = body.querySelector('.off-list');
    if (lst) lst.addEventListener('click', async (e) => {
      const row = e.target.closest('.off-row'); if (!row) return;
      const i = Number(row.dataset.i);
      if (e.target.classList.contains('b-edit')) openBundle(container, body, i);
      if (e.target.classList.contains('b-del')) {
        if (!(await Utils.confirmDialog('تمسح الباكدچ ده؟'))) return;
        site.bundles.splice(i, 1); await save(); drawBundles(container, body);
      }
    });
  }

  function openBundle(container, body, idx) {
    const bn = idx == null
      ? { title: '', desc: '', price: '', image: '', lines: [] }
      : JSON.parse(JSON.stringify(site.bundles[idx]));
    const lines = bn.lines || [];

    Utils.openModal({
      title: idx == null ? 'باكدچ جديد' : 'تعديل الباكدچ',
      wide: true,
      bodyHtml: `
        <form id="bnForm" novalidate>
          <div class="field"><label>اسم الباكدچ</label>
            <input id="bnTitle" value="${esc(bn.title)}" placeholder="مثلاً: طقم تأسيس شقة" autofocus></div>
          <div class="field"><label>وصف (اختياري)</label>
            <textarea id="bnDesc" rows="2">${esc(bn.desc || '')}</textarea></div>

          <label class="lbl">اللي جوّه الباكدچ</label>
          <div id="bnList"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="bnAddItem" style="margin:8px 0 14px;">+ ضيف منتج للباكدچ</button>

          <div class="field-row">
            <div class="field"><label>سعر الباكدچ كامل</label>
              <input type="number" id="bnPrice" min="0" step="0.01" inputmode="decimal" value="${bn.price ?? ''}"></div>
            <div class="field"><label>لو اتشرى فرادى</label>
              <input id="bnFull" disabled></div>
            <div class="field"><label>الزبون بيوفّر</label>
              <input id="bnSave" disabled></div>
          </div>

          <label class="lbl">صورة الباكدچ</label>
          <div id="bnImg">${imgBox(bn.image, 'ارفع صورة')}</div>

          <div class="form-actions" style="margin-top:16px;">
            <button type="button" class="btn btn-ghost" id="bnCancel">إلغاء</button>
            <button type="submit" class="btn btn-amber">حفظ</button>
          </div>
        </form>`,
      onMount: (mb, close) => {
        const listBox = mb.querySelector('#bnList');
        const draw = () => {
          listBox.innerHTML = lines.length ? lines.map((l, k) => `
            <div class="bn-edit" data-k="${k}">
              <span class="bn-nm">${esc(l.name)}</span>
              <span class="bn-pr">${money(l.price)} ج.م</span>
              <input type="number" class="cell bn-q" min="1" step="1" value="${Number(l.qty || 1)}">
              <button type="button" class="icon-btn bn-x">🗑️</button>
            </div>`).join('') : '<p class="empty-note" style="padding:4px 0;">لسه فاضي — ضيف المنتجات</p>';
          const full = lines.reduce((t, l) => t + Number(l.qty || 1) * Number(l.price || 0), 0);
          mb.querySelector('#bnFull').value = money(full) + ' ج.م';
          const pr = Number(mb.querySelector('#bnPrice').value || 0);
          const sv = full - pr;
          mb.querySelector('#bnSave').value = (pr > 0 && sv > 0) ? money(sv) + ' ج.م' : '—';
        };
        draw();
        listBox.addEventListener('click', (e) => {
          if (!e.target.classList.contains('bn-x')) return;
          lines.splice(Number(e.target.closest('.bn-edit').dataset.k), 1); draw();
        });
        listBox.addEventListener('input', (e) => {
          if (!e.target.classList.contains('bn-q')) return;
          lines[Number(e.target.closest('.bn-edit').dataset.k)].qty = Math.max(1, Number(e.target.value || 1));
          draw();
        });
        mb.querySelector('#bnPrice').addEventListener('input', draw);

        mb.querySelector('#bnAddItem').addEventListener('click', () => {
          // بيختار من منتجات الموقع — اللي مش عليه يضيفه من تبويب المنتجات الأول
          Utils.openModal({
            title: 'اختار منتج تحطه في الباكدچ',
            bodyHtml: `<div class="pk-list">${site.products.length ? site.products.map((p, k) => `
              <button type="button" class="pk-row" data-k="${k}">
                <span class="pk-n">${esc(p.name)}</span>
                <span class="pk-p">${money(p.price)}</span>
                <span class="pk-a">+ ضيف</span>
              </button>`).join('') : '<p class="empty-note">حط منتجات على الموقع الأول من تبويب «المنتجات»</p>'}</div>`,
            onMount: (m2, close2) => {
              m2.addEventListener('click', (e) => {
                const b2 = e.target.closest('.pk-row'); if (!b2) return;
                const p = site.products[Number(b2.dataset.k)];
                const have = lines.find(l => l.name === p.name);
                if (have) have.qty = Number(have.qty || 1) + 1;
                else lines.push({ name: p.name, qty: 1, price: Number(p.price || 0), itemId: p.itemId || null });
                draw();
                close2();
              });
            }
          });
        });

        const setImg = async (v) => {
          bn.image = v;
          const box = mb.querySelector('#bnImg');
          box.innerHTML = imgBox(bn.image, 'ارفع صورة');
          bindImg(box, () => bn.image, setImg);
        };
        bindImg(mb.querySelector('#bnImg'), () => bn.image, setImg);

        mb.querySelector('#bnCancel').addEventListener('click', close);
        Utils.guardSubmit(mb.querySelector('#bnForm'), async (e) => {
          e.preventDefault();
          const rec = {
            title: mb.querySelector('#bnTitle').value.trim(),
            desc: mb.querySelector('#bnDesc').value.trim(),
            price: Number(mb.querySelector('#bnPrice').value || 0),
            image: bn.image || '',
            lines: lines.slice()
          };
          if (!rec.title) { Utils.toast('اكتب اسم الباكدچ', 'error'); return; }
          if (!rec.lines.length) { Utils.toast('ضيف منتج واحد على الأقل جوّه الباكدچ', 'error'); return; }
          if (!(rec.price > 0)) { Utils.toast('اكتب سعر الباكدچ', 'error'); return; }
          if (idx == null) site.bundles.push(rec); else site.bundles[idx] = rec;
          await save();
          close();
          drawBundles(container, body);
        });
      }
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
        <div class="field-row">
          ${field('توكن البوت (من BotFather)', 'order.tgToken', { ph: '8813...:AAF...' })}
          ${field('رقم محادثتك على تليجرام', 'order.tgChat', { ph: '1437...' })}
          ${field('الإيميل اللي يوصله الطلب', 'order.email', { ph: 'you@gmail.com' })}
        </div>
        <div class="hint" style="margin:-8px 0 14px;">
          البيانات دي بتتحط جوه الكود اللي تحت عشان تلزقه جاهز — وعمرها ما بتتنشر على الموقع.
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
            <li>لو كاتب التوكن ورقمك وإيميلك في الخانات اللي فوق، الكود تحت
              <strong>جاهز بيهم</strong> — انسخه والصقه زي ما هو من غير ما تعدّل فيه حاجة.</li>
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
          <pre class="code">${esc(relayCode())}</pre>
        </details>
      </div>`;
    bindFields(body, () => drawOrder(container, body));
    const cc = body.querySelector('#copyCode');
    if (cc) cc.addEventListener('click', () => {
      navigator.clipboard.writeText(relayCode()).then(
        () => Utils.toast('الكود اتنسخ — الصقه في script.google.com', 'success'),
        () => Utils.toast('مقدرش ينسخ — علّم على الكود وانسخه بإيدك', 'error'));
    });
  }

  /* الوسيط اللي بيستلم الطلب من الموقع ويبعته على تليجرام والإيميل.
     بيتحط في حساب جوجل بتاع صاحب المحل — يعني توكن البوت مش مكتوب
     في الموقع نفسه، فمحدش يقدر يستعمله غيره. */
  /* الكود بيتكتب وفيه التوكن ورقم المحادثة والإيميل اللي كاتبهم فوق،
     عشان يلزقه في جوجل من غير ما يعدّل فيه حاجة ومن غير غلط كتابة. */
  function relayCode() {
    const o = (site && site.order) || {};
    const q = v => "'" + String(v || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    return RELAY_CODE
      .replace("'__TOKEN__'", o.tgToken ? q(o.tgToken) : "'حط التوكن هنا'")
      .replace("'__CHAT__'", o.tgChat ? q(o.tgChat) : "'حط رقمك هنا'")
      .replace("'__EMAIL__'", o.email ? q(o.email) : "'حط إيميلك هنا'");
  }

  const RELAY_CODE = [
    "// ===== إعدادات =====",
    "var TELEGRAM_TOKEN = '__TOKEN__';",
    "var CHAT_ID        = '__CHAT__';",
    "var EMAIL          = '__EMAIL__';",
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
