Modules.inventory = (() => {

  const MOVE_LABELS = {
    purchase: { txt: 'شراء', cls: 'badge-ok' },
    sale: { txt: 'بيع', cls: 'badge-danger' },
    adjustment: { txt: 'تسوية جرد', cls: 'badge-muted' },
    return_in: { txt: 'مرتجع/إلغاء بيع', cls: 'badge-warn' },
    return_out: { txt: 'إلغاء شراء', cls: 'badge-warn' }
  };

  let catFilter = '';   // التصنيف المختار (كهرباء / حدايد …) — بيفضل لما يرجع للشاشة
  let selected = new Set();   // الأصناف المعلّم عليها ✓ عشان يتصنّفوا مرة واحدة

  function printCountSheet(list, cat) {
    if (!list.length) { Utils.toast('مفيش أصناف تتطبع', 'info'); return; }
    Printing.countSheet(list, cat || 'كل الأصناف');
  }

  // التصنيفات اللي ينفع يتحط فيها صنف (من غير "أصل ثابت" و"صيانة" — دول مش بضاعة)
  function goodsCategories() {
    return AppState.categorySuggestions().filter(c => Services.lineKind(c) === 'goods');
  }
  const NEW_CAT = '__new__', NO_CAT = '__none__';
  // قايمة صنف واحد: التصنيف الحالي مختار و"من غير تصنيف" اختيار عادي.
  // قايمة التصنيف الجماعي: بتبدأ بـ "اختار…" عشان مايدوسش تطبيق بالغلط ويشيل التصنيف من الكل.
  function catOptions(current, bulk) {
    const cats = goodsCategories().map(c => `<option value="${Utils.escapeHtml(c)}" ${!bulk && c === current ? 'selected' : ''}>${Utils.escapeHtml(c)}</option>`).join('');
    return (bulk ? `<option value="" selected>اختار التصنيف…</option>` : `<option value="">— من غير تصنيف —</option>`) +
      cats + `<option value="${NEW_CAT}">＋ تصنيف جديد…</option>` +
      (bulk ? `<option value="${NO_CAT}">✕ شيل التصنيف</option>` : '');
  }
  // "تصنيف جديد…" → يسأله على الاسم
  async function resolveCatChoice(value) {
    if (value === NO_CAT) return '';
    if (value !== NEW_CAT) return value;
    const name = await Utils.promptDialog('اسم التصنيف الجديد', { placeholder: 'مثلاً: سباكة' });
    return name == null ? null : String(name).trim();
  }

  async function render(container) {
    await AppState.reloadItems();
    selected = new Set();
    const burdenByCat = Auth.isSeller() ? {} : await Services.assetBurdenByCategory();
    const totalValue = AppState.items.reduce((s, i) => s + (i.stock * i.costPrice), 0);
    const lowStock = AppState.items.filter(i => i.minStock && i.stock <= i.minStock && i.stock > 0);
    const outOfStock = AppState.items.filter(i => i.stock <= 0);
    // اللي اتباع ولسه ما اتسجلش — الرصيد بالسالب
    const neg = AppState.negativeStockItems();

    container.innerHTML = `
      <div class="grid ${Auth.isSeller() ? 'grid-2' : 'grid-3'}" style="margin-bottom:18px;">
        ${Auth.isSeller() ? '' : `<div class="stat-tile"><div class="lbl">قيمة المخزون الحالية (بسعر التكلفة)</div><div class="val">${Utils.formatMoney(totalValue)}</div></div>`}
        <div class="stat-tile ${lowStock.length ? 'negative' : ''}"><div class="lbl">أصناف قاربت تخلص</div><div class="val">${lowStock.length}</div></div>
        <div class="stat-tile ${outOfStock.length ? 'negative' : ''}"><div class="lbl">أصناف نفدت</div><div class="val">${outOfStock.length}</div></div>
      </div>

      ${neg.length ? `
      <div class="notice notice-danger" style="margin-bottom:14px;line-height:1.9;">
        <strong>${neg.length} صنف اتباع ولسه ما اتسجلش في المشتريات:</strong>
        ${neg.slice(0, 8).map(i =>
          `<span class="neg-chip">${Utils.escapeHtml(i.name)} — ناقص ${Units.fmtQty(-i.stock, i.unit)}</span>`).join(' ')}
        ${neg.length > 8 ? `<span class="muted">و${neg.length - 8} كمان…</span>` : ''}
        <div class="hint" style="margin-top:6px;">
          سجّل فاتورة الشراء بتاعتهم والأرقام هتتظبط لوحدها — مش محتاج تعمل أي حاجة تانية.
        </div>
      </div>` : ''}

      <div id="invCats"></div>

      <div class="section-head">
        <div class="search-box" style="max-width:340px;">
          <input type="text" id="invSearch" placeholder="ابحث بالاسم أو الباركود...">
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-ghost" id="invSheetBtn" title="ورقة تطبعها وتلف بيها على الرف تعدّ">🖨️ ورقة جرد</button>
          <button class="btn btn-ghost" id="invLabelBtn">🏷️ طباعة ملصقات</button>
        </div>
      </div>

      ${Auth.isSeller() ? '' : `
      <div class="bulk-bar" id="bulkBar" hidden>
        <span id="bulkCount"></span>
        <label>صنّفهم كـ
          <select id="bulkCat">${catOptions('', true)}</select>
        </label>
        <button type="button" class="btn btn-amber btn-sm" id="bulkApply">تطبيق</button>
        <button type="button" class="btn btn-ghost btn-sm" id="bulkClear">إلغاء التحديد</button>
      </div>`}

      <div class="table-wrap">
        <table>
          <thead><tr>
            ${Auth.isSeller() ? '' : '<th class="sel-col"><input type="checkbox" id="selAll" title="علّم على كل اللي ظاهر"></th>'}
            <th>الباركود</th><th>الصنف</th><th>التصنيف</th><th>الرصيد</th><th>تالف/ضمان</th><th>الحد الأدنى</th>
            ${Auth.isSeller() ? '' : '<th>قيمة الرصيد</th>'}<th></th></tr></thead>
          <tbody id="invBody"></tbody>
        </table>
      </div>
    `;

    const tbody = container.querySelector('#invBody');
    const owner = !Auth.isSeller();
    const COLS = owner ? 9 : 7;

    /* ---------- المخزون حسب التصنيف ----------
       كهرباء بكام، حدايد بكام، مفاتيح بكام — ودوسة على التصنيف بتفلتر
       الجدول عليه عشان يجرد التصنيف ده لوحده. */
    const catOf = i => String(i.category || '').trim() || 'من غير تصنيف';
    function drawCats() {
      const box = container.querySelector('#invCats');
      const groups = {};
      AppState.items.forEach(i => {
        const c = catOf(i);
        const g = groups[c] || (groups[c] = { n: 0, cost: 0, sale: 0, neg: 0 });
        g.n++;
        const st = Number(i.stock || 0);
        if (st > 0) { g.cost += st * Number(i.costPrice || 0); g.sale += st * Number(i.salePrice || 0); }
        if (st < -0.0001) g.neg++;
      });
      const names = Object.keys(groups).sort((a, b) => groups[b].cost - groups[a].cost);
      const seller = Auth.isSeller();
      box.innerHTML = `
        <div class="cat-bar">
          <button type="button" class="cat-chip ${!catFilter ? 'on' : ''}" data-cat="">
            <span class="cc-name">كل الأصناف</span>
            <span class="cc-sub">${AppState.items.length} صنف${seller ? '' : ' · ' + Utils.formatMoney(totalValue)}</span>
          </button>
          ${names.map(c => `
          <button type="button" class="cat-chip ${catFilter === c ? 'on' : ''} ${c === 'من غير تصنيف' ? 'uncat' : ''}" data-cat="${Utils.escapeHtml(c)}">
            <span class="cc-name">${Utils.escapeHtml(c)}</span>
            <span class="cc-sub">${groups[c].n} صنف${seller ? '' : ' · ' + Utils.formatMoney(groups[c].cost)}</span>
            ${!seller && groups[c].sale > 0 ? `<span class="cc-sub2">بسعر البيع ${Utils.formatMoney(groups[c].sale)}</span>` : ''}
            ${burdenByCat[c] > 0 ? `<span class="cc-sub2" title="إهلاك وصيانة الماكينات اللي بتخدم التصنيف ده، مقسومين على اللي بيتباع منه">🏭 + ${Utils.formatMoney(burdenByCat[c])} للوحدة من الماكينات</span>` : ''}
          </button>`).join('')}
        </div>
        ${!seller && groups['من غير تصنيف'] && catFilter === 'من غير تصنيف' ? `
        <div class="hint" style="margin:-6px 0 12px;">علّم ✓ على الأصناف وصنّفهم مرة واحدة من الشريط تحت — أو دوس على «من غير تصنيف» جنب أي صنف وغيّره لوحده.</div>` : ''}`;
      box.querySelectorAll('.cat-chip').forEach(b => b.addEventListener('click', () => {
        catFilter = b.dataset.cat || '';
        drawCats(); redraw();
      }));
    }

    // اللي ظاهر دلوقتي = التصنيف المختار + كلمة البحث
    function visible() {
      let list = AppState.items;
      if (catFilter) list = list.filter(i => catOf(i) === catFilter);
      const q = (container.querySelector('#invSearch').value || '').trim();
      if (q) list = Search.items(q, list);
      return list;
    }
    function redraw() { draw(visible()); }

    function draw(list) {
      if (!list.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="${COLS}">مفيش أصناف${catFilter ? ' في "' + Utils.escapeHtml(catFilter) + '"' : ''}</td></tr>`;
        syncBulk();
        return;
      }
      tbody.innerHTML = list.map(i => {
        /* الرصيد بالسالب = بضاعة اتباعت ولسه ما اتسجلتش في المشتريات.
           بننوّر السطر أحمر ونقوله المطلوب يدخّله كام. */
        const neg = Number(i.stock || 0) < -0.0001;
        const cat = String(i.category || '').trim();
        return `
        <tr data-id="${i.id}"${neg ? ' class="row-missing" title="اتباع ولسه ما اتسجلش — سجّل فاتورة الشراء والرقم هيتظبط لوحده"' : ''}>
          ${owner ? `<td class="sel-col"><input type="checkbox" class="sel-row" ${selected.has(i.id) ? 'checked' : ''}></td>` : ''}
          <td>${Utils.escapeHtml(i.barcode || '—')}</td>
          <td style="font-weight:700;">${Utils.escapeHtml(i.name)}</td>
          <td>${owner
                ? `<button type="button" class="cat-pick ${cat ? '' : 'empty'}" title="دوس عشان تغيّر التصنيف">${cat ? Utils.escapeHtml(cat) : 'من غير تصنيف'}</button>`
                : (cat ? `<span class="badge badge-muted">${Utils.escapeHtml(cat)}</span>` : '<span class="muted">—</span>')}</td>
          <td>${neg
                ? `<span class="badge badge-danger">ناقص ${Units.fmtQty(-i.stock, i.unit)}</span>
                   <div class="unit-cost-sub">اتباع ولسه ما اتسجلش</div>`
                : (i.stock <= 0 ? '<span class="badge badge-danger">0</span>' : Units.fmtQty(i.stock, i.unit))}</td>
          <td>${i.damagedQty > 0 ? `<span class="badge badge-warn">${Units.fmtQty(i.damagedQty, i.unit)}</span>` : '<span class="muted">—</span>'}</td>
          <td>${Units.fmtQty(i.minStock || 0, i.unit)}</td>
          ${Auth.isSeller() ? '' : `<td>${Utils.formatMoney(i.stock * i.costPrice)}</td>`}
          <td>
            ${Auth.isSeller() ? '' : '<button class="icon-btn adj-btn" title="تسوية جرد">⚖️</button>'}
            <button class="icon-btn label-btn" title="اطبع ملصق باركود">🏷️</button>
            <button class="icon-btn hist-btn" title="سجل الحركة">📜</button>
          </td>
        </tr>`; }).join('');
      syncBulk();
    }

    /* ---------- التصنيف من هنا على طول ----------
       بدل ما يدخل على فاتورة فاتورة: يعلّم ✓ على كام صنف ويصنّفهم مرة
       واحدة، أو يدوس على تصنيف الصنف ويغيّره لوحده. */
    function syncBulk() {
      const bar = container.querySelector('#bulkBar');
      if (!bar) return;
      const n = selected.size;
      bar.hidden = n === 0;
      const cnt = container.querySelector('#bulkCount');
      if (cnt) cnt.textContent = 'اتعلّم على ' + n + ' صنف —';
      const all = container.querySelector('#selAll');
      if (all) {
        const vis = visible();
        all.checked = vis.length > 0 && vis.every(i => selected.has(i.id));
      }
    }
    async function applyCategory(ids, cat) {
      const n = await Services.setItemsCategory(ids, cat);
      await AppState.reloadItems();
      selected = new Set();
      drawCats(); redraw();
      Utils.toast(cat ? `اتصنّف ${n} صنف كـ «${cat}»` : `اتشال التصنيف من ${n} صنف`, 'success');
    }
    // دوسة على تصنيف صنف واحد → قايمة مكانه
    function openCatPicker(td, item) {
      const cur = String(item.category || '').trim();
      td.innerHTML = `<select class="cat-inline">${catOptions(cur)}</select>`;
      const sel = td.querySelector('select');
      sel.focus();
      let done = false;
      const finish = async () => {
        if (done) return; done = true;
        const v = await resolveCatChoice(sel.value);
        if (v == null || v === cur) { redraw(); return; }
        await applyCategory([item.id], v);
      };
      sel.addEventListener('change', finish);
      sel.addEventListener('blur', () => { if (!done && sel.value === cur) { done = true; redraw(); } });
      sel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { done = true; redraw(); } });
    }
    drawCats();
    redraw();

    container.querySelector('#invLabelBtn').addEventListener('click', () => Modules.items.openBulkLabels());
    container.querySelector('#invSheetBtn').addEventListener('click', () => printCountSheet(visible(), catFilter));

    container.querySelector('#invSearch').addEventListener('input', Utils.debounce(redraw, 150));

    if (owner) {
      container.querySelector('#selAll').addEventListener('change', (e) => {
        const vis = visible();
        if (e.target.checked) vis.forEach(i => selected.add(i.id));
        else vis.forEach(i => selected.delete(i.id));
        redraw();
      });
      container.querySelector('#bulkClear').addEventListener('click', () => { selected = new Set(); redraw(); });
      container.querySelector('#bulkApply').addEventListener('click', async () => {
        if (!selected.size) return;
        const raw = container.querySelector('#bulkCat').value;
        if (!raw) { Utils.toast('اختار التصنيف الأول', 'error'); return; }
        const v = await resolveCatChoice(raw);
        if (v == null) return;
        await applyCategory([...selected], v);
      });
      tbody.addEventListener('change', (e) => {
        if (!e.target.classList.contains('sel-row')) return;
        const id = Number(e.target.closest('tr').dataset.id);
        if (e.target.checked) selected.add(id); else selected.delete(id);
        syncBulk();
      });
    }

    tbody.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const item = AppState.items.find(i => i.id === Number(tr.dataset.id));
      if (e.target.classList.contains('cat-pick')) { openCatPicker(e.target.closest('td'), item); return; }
      if (e.target.classList.contains('adj-btn')) openAdjustModal(item, () => render(container));
      if (e.target.classList.contains('hist-btn')) openHistoryModal(item);
      if (e.target.classList.contains('label-btn')) {
        if (!(item.barcode || '').trim()) { Utils.toast('الصنف ده مالوش باركود', 'error'); return; }
        /* هو دايس على صنف بعينه — نفتحله ملصق الصنف ده على طول،
           مش قايمة الأصناف كلها. القايمة ليها زرارها فوق. */
        Modules.items.openLabelDialog(item);
      }
    });
  }

  function openAdjustModal(item, onDone) {
    Utils.openModal({
      title: `تسوية جرد: ${item.name}`,
      bodyHtml: `
        <form id="adjForm">
          <p class="muted" style="font-size:13px;">الرصيد الحالي بالنظام: <strong>${item.stock}</strong></p>
          <div class="field">
            <label>الرصيد الفعلي بعد الجرد</label>
            <input type="number" id="adjQty" step="0.01" value="${item.stock}" autofocus>
          </div>
          <div class="field">
            <label>ملاحظة (اختياري)</label>
            <input type="text" id="adjNote" placeholder="سبب الفرق">
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-amber">حفظ التسوية</button>
          </div>
        </form>`,
      onMount: (body, close) => {
        Utils.guardSubmit(body.querySelector('#adjForm'), async (e) => {
          e.preventDefault();
          const newQty = Number(body.querySelector('#adjQty').value);
          const note = body.querySelector('#adjNote').value.trim();
          await Services.adjustStock(item.id, newQty, note);
          await AppState.reloadItems();
          Utils.toast('تم تحديث الرصيد', 'success');
          close();
          onDone();
        });
      }
    });
  }

  async function openHistoryModal(item) {
    const all = await DB.getAllByIndex('stockMovements', 'itemId', item.id);
    all.sort((a, b) => new Date(b.date) - new Date(a.date));
    Utils.openModal({
      title: `سجل حركة: ${item.name}`,
      wide: true,
      bodyHtml: `
        <div class="table-wrap" style="border:none;">
          <table>
            <thead><tr><th>التاريخ</th><th>النوع</th><th>الكمية</th><th>ملاحظة</th></tr></thead>
            <tbody>
              ${all.length ? all.map(m => `
                <tr>
                  <td>${Utils.formatDateTime(m.date)}</td>
                  <td><span class="badge ${MOVE_LABELS[m.type]?.cls || 'badge-muted'}">${MOVE_LABELS[m.type]?.txt || m.type}</span></td>
                  <td style="font-weight:700;color:${m.qty >= 0 ? 'var(--success)' : 'var(--danger)'}">${m.qty >= 0 ? '+' : ''}${m.qty}</td>
                  <td>${Utils.escapeHtml(m.note || '')}</td>
                </tr>`).join('') : `<tr class="empty-row"><td colspan="4">مفيش حركة مسجلة لسه</td></tr>`}
            </tbody>
          </table>
        </div>`
    });
  }

  return { render };
})();
