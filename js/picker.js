/* بحث سريع جوّه خانات الفاتورة

   المشكلة: البرنامج فيه مئات الأصناف. قائمة المتصفح العادية
   (datalist) بتوري الأسماء بس، من غير الباركود ولا الرصيد ولا آخر
   سعر — وبتدوّر بشكل مش مظبوط مع العربي.

   الحل: قايمة بحث بنرسمها إحنا تحت الخانة. بتدوّر في الاسم
   والباركود مع بعض، وبتوري جنب كل صنف رصيده وآخر سعر شراء — عشان
   وهو بيكتب الفاتورة يبقى شايف كل اللي محتاجه من غير ما يسيب مكانه.

   بتشتغل بالكيبورد: ↓ ↑ للتنقل، Enter يختار، Esc يقفل.

   قاعدة مهمة: الـEnter عمره ما يغيّر الكلام اللي هو كتبه. القايمة
   مبتظلّلش حاجة لوحدها غير لو الاقتراح هو هو اللي مكتوب بالظبط
   (أو الباركود مطابق) — يعني الـEnter مش هيغيّر حرف.
   غير كده (كتب "عود داكت 1.5*1.5" والموجود "عود داكت") مفيش حاجة
   متظلّلة: الـEnter يسيب كلامه وينزل للسطر اللي تحت، ولو عايز
   اقتراح يدوس ↓ أو يدوس عليه بالماوس. ده مهم لأنه بيكتب أصناف
   جديدة بإيده في فاتورة البيع والشرا.
   وبتتربط بالجدول كله مرة واحدة (delegation) مش بكل سطر — عشان
   الجدول بيتعاد رسمه كتير وانت بتكتب. */

const Picker = (() => {

  let box = null;          // القايمة نفسها
  let host = null;         // الخانة اللي القايمة فاتحة عليها
  let items = [];          // اللي ظاهر دلوقتي
  let active = -1;
  let cfg = null;          // إعدادات الخانة المفتوحة

  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.className = 'pick-box';
    box.hidden = true;
    document.body.appendChild(box);

    box.addEventListener('mousedown', (e) => {
      // mousedown مش click — عشان ما نخسرش الفوكس قبل ما نختار
      const row = e.target.closest('.pick-row');
      if (!row) return;
      e.preventDefault();
      choose(Number(row.dataset.i));
    });
    /* لما الصفحة تتحرك بنحرّك القايمة معاها — مش نقفلها.
       (لو قفلناها هتقفل نفسها، لأن تحريك السطر المختار جوّه القايمة
       بيعمل حدث تمرير) */
    const follow = () => {
      if (!host || !box || box.hidden) return;
      if (!document.body.contains(host)) { close(); return; }
      place();
    };
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    document.addEventListener('mousedown', (e) => {
      if (!box || box.hidden) return;
      if (e.target === host || box.contains(e.target)) return;
      close();
    });
    return box;
  }

  function close() {
    if (box) { box.hidden = true; box.innerHTML = ''; }
    host = null; items = []; active = -1; cfg = null;
  }

  function place() {
    const r = host.getBoundingClientRect();
    box.style.top = (r.bottom + window.scrollY + 2) + 'px';
    box.style.minWidth = Math.max(r.width, 260) + 'px';
    /* الصفحة عربي فبنظبط القايمة من ناحية اليمين — لو الخانة قريبة
       من حرف الشاشة بنزحلقها جوّه عشان ما تتقصش */
    const w = Math.max(r.width, 260);
    let right = window.innerWidth - r.right - window.scrollX;
    if (right + w > window.innerWidth - 8) right = Math.max(8, window.innerWidth - w - 8);
    box.style.right = right + 'px';
    box.style.left = 'auto';
  }

  function draw() {
    if (!items.length) { close(); return; }
    box.innerHTML = items.map((it, i) => `
      <div class="pick-row${i === active ? ' on' : ''}" data-i="${i}">
        ${cfg.render(it)}
      </div>`).join('')
      /* مفيش حاجة متظلّلة؟ بنفهّمه إن الـEnter هيسيب كلامه زي ما هو */
      + (active < 0 ? '<div class="pick-hint">دوس ↓ تختار من اللي فوق · أو كمّل كتابة الاسم اللي انت عايزه</div>' : '');
    box.hidden = false;
    place();
    const on = box.querySelector('.pick-row.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }

  function move(step) {
    if (!items.length) return;
    // لسه مفيش حاجة متظلّلة: ↓ تودّيه لأول واحد و↑ لآخر واحد
    if (active < 0) active = step > 0 ? 0 : items.length - 1;
    else active = (active + step + items.length) % items.length;
    draw();
  }

  function choose(i) {
    const it = items[i];
    const el = host, c = cfg;
    close();
    if (it && c && c.onPick) c.onPick(it, el);
  }

  /* نص الاقتراح — القايمة بتستعمل مرة مع الأصناف (كائن فيه name)
     ومرة مع كلام ساده (وحدات، تصنيفات، شركات) */
  function labelOf(it) {
    if (it == null) return '';
    return typeof it === 'string' ? it : String(it.name || '');
  }

  /* ناخد الاقتراح ده بالـEnter لوحدنا ولا لأ؟

     أيوه في حالتين بس، والاتنين الكلام فيهم مش بيتغير:
       - اسمه هو هو اللي كتبه بالظبط (بعد التطبيع: ة=ه،
         "عود داكت1.5" = "عود داكت 1.5")
       - أو اللي كتبه باركود الصنف بالظبط (الليزر)

     أي حالة تانية — ولو كان الاقتراح بيكمّل كلامه — سايبينها ليه
     هو: يدوس ↓ أو يدوس بالماوس. لأن الصنف الجديد بيتكتب بإيده في
     فاتورة البيع والشرا، ولو أخدنا كلامه وحطّينا مكانه اسم صنف
     موجود كان بيلاقي اللي كتبه ضاع. */
  function safePick(it, q) {
    const nq = Search.norm(q);
    if (!nq) return false;
    if (Search.norm(labelOf(it)) === nq) return true;
    const code = (it && typeof it === 'object') ? String(it.barcode || '').trim() : '';
    return !!code && code === String(q).trim();
  }

  /* بنفتح القايمة على خانة معيّنة.
     opts = { search(q) بترجع قايمة, render(it) بترجع HTML, onPick(it, input) } */
  function open(input, opts) {
    ensureBox();
    host = input; cfg = opts;
    const q = String(input.value || '').trim();
    items = (opts.search(q) || []).slice(0, 40);
    /* بنظلّل حاجة لوحدنا بس لو الـEnter مش هيغيّر كلامه.
       ولو المطابق مش أول واحد في القايمة بندوّر عليه — عشان
       البحث ساعات بيقدّم الاسم القصير على المطابق بالظبط. */
    active = items.findIndex(it => safePick(it, q));
    draw();
  }

  /* بنربط الجدول كله مرة واحدة.
     map = { '.f-name': {search, render, onPick}, ... } */
  function bind(container, map) {
    const sel = Object.keys(map).join(',');

    container.addEventListener('input', (e) => {
      const el = e.target.closest(sel);
      if (!el) return;
      const key = Object.keys(map).find(k => el.matches(k));
      open(el, map[key]);
    });

    container.addEventListener('focusin', (e) => {
      const el = e.target.closest(sel);
      if (!el) { if (host) close(); return; }
      // لو الخانة فيها كلام خلاص بنوريه المطابق، ولو فاضية نستنى يكتب
      if (String(el.value || '').trim()) {
        const key = Object.keys(map).find(k => el.matches(k));
        open(el, map[key]);
      }
    });

    /* الكيبورد لازم يكون capture — عشان نمسك Enter قبل ما الجدول
       ينقل للسطر اللي تحت */
    container.addEventListener('keydown', (e) => {
      if (!host || !box || box.hidden) return;
      if (e.target !== host) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move(-1); }
      else if (e.key === 'Enter') {
        if (active >= 0) { e.preventDefault(); e.stopPropagation(); choose(active); }
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    }, true);
  }

  /* البحث القياسي في الأصناف: بالاسم أو الباركود.
     بيستعمل البحث اللي بيفهم العربي (Search في utils.js): ة=ه،
     الرقم اللازق في الحرف، والكلمات بأي ترتيب — والأقرب بييجي الأول. */
  function searchItems(q, list) {
    const r = Search.items(q, list);
    return String(q || '').trim() ? r : r.slice(0, 40);
  }

  /* شكل سطر الصنف في القايمة: الاسم، والباركود، والرصيد، وآخر تكلفة */
  function itemRow(it) {
    const stock = Number(it.stock || 0);
    const cls = stock < 0 ? 'neg' : (stock <= 0 ? 'zero' : '');
    const unit = it.unit || 'قطعة';
    return `
      <div class="pick-main">
        <span class="pick-name">${Utils.escapeHtml(it.name || '')}</span>
        ${it.barcode ? `<span class="pick-code">${Utils.escapeHtml(it.barcode)}</span>` : ''}
      </div>
      <div class="pick-side">
        <span class="pick-stock ${cls}">${
          stock < 0 ? 'ناقص ' + Units.fmtQty(-stock, unit) : Units.fmtQty(stock, unit)}</span>
        ${Number(it.costPrice || 0) > 0
          ? `<span class="pick-cost">شرا ${Utils.formatMoney(it.costPrice)}</span>` : ''}
      </div>`;
  }

  /* قايمة نصوص بسيطة (النوع، التصنيف) */
  function searchText(q, list) {
    const n = String(q || '').trim().toLowerCase();
    if (!n) return list.slice(0, 40);
    return list.filter(t => String(t).toLowerCase().includes(n));
  }
  function textRow(t) {
    return `<div class="pick-main"><span class="pick-name">${Utils.escapeHtml(t)}</span></div>`;
  }

  return { bind, open, close, searchItems, itemRow, searchText, textRow };
})();
