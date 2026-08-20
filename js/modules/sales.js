Modules.sales = (() => {
  /* فاتورة بيع بشكل جدول زي الإكسيل:
     الباركود | الصنف | الكمية | الوحدة | السعر | الإجمالي
     اسم العميل بيتكتب بالإيد، ولو "كاش" يبقى بيع نقدي */

  let rows = [];
  let detachScanner = null;
  let rowSeq = 0;
  let paidTouched = false;
  let saving = false;   // بيمنع إن دوستين سريعتين على "حفظ" يعملوا فاتورتين
  let editing = null;   // الفاتورة اللي بنعدّل فيها دلوقتي (null = فاتورة جديدة)
  let wholesale = false; // بيع بسعر الجملة (للأسطوات)

  function blankRow() {
    return {
      _id: ++rowSeq, itemId: null, barcode: '', name: '', unit: 'قطعة',
      qty: '', price: '', cost: 0, stock: 0,
      // بيانات العبوة: لفة السلك فيها ١٠٠ متر وليها سعر مقطوعية أرخص
      packSize: 0, packName: '', packPrice: 0, sellPack: false
    };
  }

  function lineToRow(l) {
    const r = blankRow();
    const it = AppState.items.find(i => i.id === l.itemId);
    r.itemId = l.itemId;
    r.barcode = it ? (it.barcode || '') : '';
    r.name = l.name || (it ? it.name : '');
    r.unit = l.unit || (it ? it.unit : 'قطعة');
    r.cost = l.cost || 0;
    if (it) {
      r.packSize = Number(it.packSize || 0);
      r.packName = it.packName || Units.packLabel(r.unit);
      r.packPrice = Number(it.packPrice || 0);
    }
    /* الفاتورة متسجلة دايمًا بالوحدة الأصلية (متر) عشان المخزن والأرباح،
       فلو السطر كان مباع بالعبوة بنرجّعه لشكله ده تاني وقت التعديل
       عشان يشوفه زي ما باعه بالظبط */
    if (Number(l.packQty || 0) > 0 && Number(l.packSize || 0) > 0) {
      r.sellPack = true;
      r.packSize = Number(l.packSize);
      r.packName = l.packName || Units.packLabel(r.unit);
      r.qty = l.packQty;
      r.price = l.packPrice != null ? l.packPrice : Number(l.price || 0) * Number(l.packSize);
    } else {
      r.qty = l.qty;
      r.price = l.price;
    }
    // الرصيد المعروض لازم يحسب إن الفاتورة دي هتترجع الأول
    r.stock = it ? (Number(it.stock || 0) + Number(l.qty || 0)) : 0;
    return r;
  }

  async function openForEdit(container, id) {
    const doc = await DB.get('sales', id);
    if (!doc) { Utils.toast('الفاتورة مش موجودة', 'error'); return; }
    if (doc.voided) { Utils.toast('الفاتورة دي ملغاة — مينفعش تتعدّل', 'error'); return; }
    if (!(await Lock.require('تعديل فاتورة'))) return;

    await AppState.reloadItems();
    editing = doc;
    rows = (doc.lines || []).map(lineToRow);
    if (!rows.length) rows = [blankRow()];
    await render(container, true);

    const cus = AppState.customers.find(c => c.id === doc.customerId);
    container.querySelector('#customerName').value = cus ? cus.name : 'كاش';
    container.querySelector('#invDate').value = Utils.dateKey(doc.date);
    const disc = container.querySelector('#sDiscount');
    if (disc) disc.value = doc.discount || 0;
    const selEl = container.querySelector('#sellerSel');
    if (selEl && doc.sellerId) selEl.value = String(doc.sellerId);
    container.querySelector('#sPaidNow').value = doc.paidNow || 0;
    paidTouched = true;
    updateTotals(container);
    window.scrollTo(0, 0);
  }

  /* السطر ممكن يكون متكتب بالمتر أو باللفة.
     qty/price = اللي البياع كتبه بالوحدة اللي مختارها.
     baseQty/basePrice = نفس الكلام محوّل للوحدة الأصلية (المتر) —
     ودي اللي بتتسجل في الفاتورة، عشان المخزن والأرباح والمرتجعات
     يفضلوا شغالين بلغة واحدة مهما البياع باع بإيه. */
  function calc(r) {
    const qty = Number(r.qty || 0);
    const price = Number(r.price || 0);
    const size = Number(r.packSize || 0);
    const pack = !!r.sellPack && size > 0;
    return {
      qty, price, size, pack,
      lineTotal: qty * price,
      baseQty: pack ? Math.round(qty * size * 1000) / 1000 : qty,
      basePrice: pack ? price / size : price
    };
  }

  // هل الصنف ده أصلاً بيتباع بالعبوة؟ (لازم يكون معرّف فيها كام وبكام)
  function canSellPack(r) {
    return Number(r.packSize || 0) > 0 && Number(r.packPrice || 0) > 0;
  }

  function unitLabel(r) {
    return calc(r).pack ? (r.packName || Units.packLabel(r.unit)) : r.unit;
  }

  function filledRows() {
    return rows.filter(r => r.itemId && calc(r).qty > 0);
  }

  function subtotal() {
    return rows.reduce((s, r) => s + calc(r).lineTotal, 0);
  }

  async function render(container, keepEdit) {
    await AppState.reloadItems();
    await AppState.reloadParties();
    if (!keepEdit) { editing = null; rows = [blankRow()]; paidTouched = false; }
    if (detachScanner) { detachScanner(); detachScanner = null; }

    /* خانة البائع بتظهر بس لو فيه موظفين مسجلين — الحل ده بيخلي
       الشاشة زي ما هي بالظبط لحد ما يسجّل أول موظف. */
    const sellers = (await DB.getAll('employees'))
      .filter(e => e.active !== false)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));

    container.innerHTML = `
      ${editing ? `
      <div class="edit-banner">
        <div>
          <strong>بتعدّل في فاتورة ${Utils.escapeHtml(editing.number)}</strong>
          <div class="hint" style="margin-top:2px;">أي تغيير هيتظبط لوحده في المخزن وحساب العميل</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="cancelEdit">سيبها زي ما هي</button>
      </div>` : ''}
      <div class="card invoice-card">
        <div class="invoice-head">
          <div class="field inv-field">
            <label>التاريخ</label>
            <input type="date" id="invDate" value="${Utils.todayISO()}">
          </div>
          <div class="field inv-field" style="flex:2;">
            <label>اسم العميل <span class="muted">(اكتب "كاش" لو بيع نقدي)</span></label>
            <input type="text" id="customerName" list="customerList" placeholder="كاش" autocomplete="off">
            <datalist id="customerList">
              ${AppState.customers.map(c => `<option value="${Utils.escapeHtml(c.name)}">`).join('')}
            </datalist>
          </div>
          ${sellers.length ? `
          <div class="field inv-field">
            <label>البائع</label>
            <select id="sellerSel">
              <option value="">— مين بيبيع؟</option>
              <option value="owner">صاحب المحل</option>
              ${sellers.map(s => `<option value="${s.id}">${Utils.escapeHtml(s.name)}</option>`).join('')}
            </select>
            <div class="hint" id="sellerHint"></div>
          </div>` : ''}
          <div class="field inv-field">
            <label>رقم الفاتورة</label>
            <input type="text" value="تلقائي" disabled>
          </div>
        </div>

        <div class="scan-strip">
          <span>📡 امسح بالليزر في أي وقت — الصنف هيتحط في سطر لوحده</span>
          <label class="ws-toggle" title="بياخد سعر الجملة للأصناف اللي ليها سعر جملة">
            <input type="checkbox" id="wsMode" ${wholesale ? 'checked' : ''}>
            <span>بيع جملة</span>
          </label>
          <button type="button" class="btn btn-ghost btn-sm" id="camBtn">📷 كاميرا</button>
        </div>

        <div class="table-wrap invoice-table-wrap">
          <table class="invoice-table">
            <thead>
              <tr>
                <th style="width:34px;">#</th>
                <th style="width:160px;">الباركود</th>
                <th style="width:230px;">الصنف</th>
                <th style="width:110px;">الكمية</th>
                <th style="width:90px;">الوحدة</th>
                <th style="width:120px;">السعر</th>
                <th style="width:138px;">الإجمالي</th>
                <th style="width:40px;"></th>
              </tr>
            </thead>
            <tbody id="invBody"></tbody>
          </table>
        </div>

        <button type="button" class="btn btn-ghost" id="addRowBtn" style="margin-top:10px;">+ سطر جديد</button>

        <div class="invoice-foot">
          <div class="foot-left">
            <div class="field inv-field">
              <label>خصم (ج.م)</label>
              <input type="number" id="sDiscount" min="0" step="0.01" value="0" inputmode="decimal">
            </div>
            <div class="field inv-field">
              <label>المدفوع الآن (كاش)</label>
              <input type="number" id="sPaidNow" min="0" step="0.01" value="0" inputmode="decimal">
            </div>
          </div>
          <div class="foot-right">
            <div class="pay-summary">
              <div class="row"><span>عدد الأصناف</span><span id="sumCount">0</span></div>
              <div class="row"><span>الإجمالي قبل الخصم</span><span id="sumSub">0.00 ج.م</span></div>
              <div class="row grand"><span>الصافي</span><span id="sumTotal">0.00 ج.م</span></div>
              <div class="row"><span>المدفوع</span><span id="sumPaid">0.00 ج.م</span></div>
              <div class="row"><span>الباقي على العميل</span><span id="sumDue">0.00 ج.م</span></div>
            </div>
            <div class="hint" id="sDueHint"></div>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-ghost" id="clearInv">فاتورة جديدة</button>
          ${editing ? `<button class="btn btn-danger" id="deleteInv">🗑️ امسح الفاتورة</button>` : ''}
          <button class="btn btn-amber" id="completeSale">${editing ? '💾 احفظ التعديل' : '💾 حفظ وطباعة'}</button>
        </div>
      </div>

      <div class="card" style="margin-top:18px;">
        <div class="section-head"><h3>فواتير المبيعات</h3></div>
        <div class="inv-search">
          <div class="field">
            <label>من تاريخ</label>
            <input type="date" id="qFrom">
          </div>
          <div class="field">
            <label>لغاية</label>
            <input type="date" id="qTo">
          </div>
          <div class="field" style="flex:2;">
            <label>العميل أو رقم الفاتورة</label>
            <input type="text" id="qName" placeholder="اكتب اسم العميل أو رقم الفاتورة" autocomplete="off">
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="qClear">امسح البحث</button>
        </div>
        <div id="recentSales"></div>
      </div>

      <datalist id="itemNameList">
        ${AppState.items.map(i => `<option value="${Utils.escapeHtml(i.name)}">`).join('')}
      </datalist>
    `;

    drawRows(container);
    loadRecent(container);

    detachScanner = Scanner.attachHardwareScanner(
      container.querySelector('#customerName'),
      (code) => onScan(container, code)
    );

    container.querySelector('#camBtn').addEventListener('click', async () => {
      const code = await Scanner.scan();
      if (code) onScan(container, code);
    });
    /* البائع بيفضل محفوظ على الجهاز — البياع بيختار نفسه مرة واحدة
       وكل فاتورة بعدها بتتسجل باسمه من غير ما يفتكر.

       ولو لسه ما اختارش، بنفضل نبيّن تنبيه أصفر تحت الخانة — لأن
       الفواتير اللي من غير بائع مش بتتحسب عمولة لحد، والبياع بينسى. */
    const sellerSel = container.querySelector('#sellerSel');
    if (sellerSel) {
      const hint = container.querySelector('#sellerHint');
      const saved = localStorage.getItem('lastSellerId') || '';
      if (saved === 'owner' || (saved && sellers.some(s => String(s.id) === saved))) {
        sellerSel.value = saved;
      }
      function syncSeller() {
        const v = sellerSel.value;
        if (!v) {
          hint.innerHTML = '<span style="color:var(--amber-deep);font-weight:700;">اختار مين بيبيع — عشان العمولة تتحسب صح</span>';
          sellerSel.style.borderColor = 'var(--amber)';
        } else {
          hint.textContent = v === 'owner' ? 'الفاتورة دي مش عليها عمولة' : '';
          sellerSel.style.borderColor = '';
        }
      }
      sellerSel.addEventListener('change', () => {
        localStorage.setItem('lastSellerId', sellerSel.value || '');
        syncSeller();
      });
      syncSeller();
    }

    container.querySelector('#addRowBtn').addEventListener('click', () => {
      rows.push(blankRow()); drawRows(container, rows[rows.length - 1]._id, 'barcode');
    });
    container.querySelector('#sDiscount').addEventListener('input', () => updateTotals(container));
    container.querySelector('#sPaidNow').addEventListener('input', () => { paidTouched = true; updateTotals(container); });
    container.querySelector('#clearInv').addEventListener('click', async () => {
      if (filledRows().length && !(await Utils.confirmDialog('هتمسح الفاتورة وتبدأ واحدة جديدة؟'))) return;
      render(container);
    });
    container.querySelector('#completeSale').addEventListener('click', () => doSave(container));

    /* وضع الجملة: بيغيّر أسعار السطور اللي لسه ما اتلمستش بالإيد،
       ومبيلمسش أي سعر إنت كتبته بنفسك. */
    const ws = container.querySelector('#wsMode');
    if (ws) ws.addEventListener('change', () => {
      wholesale = ws.checked;
      let changed = 0;
      rows.forEach(r => {
        if (!r.itemId) return;
        const target = wholesale
          ? (Number(r.wholesalePrice) || Number(r.retailPrice) || 0)
          : (Number(r.retailPrice) || 0);
        const current = Number(r.price || 0);
        const other = wholesale ? Number(r.retailPrice || 0) : (Number(r.wholesalePrice) || Number(r.retailPrice) || 0);
        // بنغيّر بس لو السعر الحالي هو السعر التاني (يعني ما اتعدلش يدوي)
        if (Math.abs(current - other) < 0.005 && target > 0) { r.price = target; changed++; }
      });
      drawRows(container);
      updateTotals(container);
      Utils.toast(wholesale
        ? (changed ? `اتحوّل ${changed} سطر لسعر الجملة` : 'وضع الجملة شغال')
        : 'رجعنا لسعر القطاعي', 'info');
    });

    // ---------- البحث في الفواتير ----------
    const runSearch = Utils.debounce(() => loadRecent(container), 200);
    ['#qFrom', '#qTo'].forEach(sel => {
      const el = container.querySelector(sel);
      if (el) el.addEventListener('change', () => loadRecent(container));
    });
    const qn = container.querySelector('#qName');
    if (qn) qn.addEventListener('input', runSearch);
    const qc = container.querySelector('#qClear');
    if (qc) qc.addEventListener('click', () => {
      container.querySelector('#qFrom').value = '';
      container.querySelector('#qTo').value = '';
      container.querySelector('#qName').value = '';
      loadRecent(container);
    });

    // ---------- أزرار وضع التعديل ----------
    const cancelBtn = container.querySelector('#cancelEdit');
    if (cancelBtn) cancelBtn.addEventListener('click', () => render(container));

    const delBtn = container.querySelector('#deleteInv');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!editing) return;
      if (!(await Lock.require('مسح فاتورة'))) return;
      if (!(await Utils.confirmDialog(
        `هتمسح فاتورة ${editing.number}؟\nالبضاعة هترجع المخزن، والفلوس وحساب العميل هيترجعوا زي ما كانوا.`))) return;
      await Services.voidSale(editing.id);
      await AppState.reloadItems(); await AppState.reloadParties(); await refreshShell();
      Utils.toast('اتمسحت الفاتورة', 'success');
      render(container);
    });
  }

  function onScan(container, code) {
    const item = AppState.items.find(i => i.barcode === code);
    if (!item) {
      Utils.beep('error');
      Utils.toast('الباركود ده مش متسجل — سجّله من شاشة المشتريات الأول', 'error');
      return;
    }
    /* لو الصنف موجود في الفاتورة بنزوّد كميته.
       بس لو السطر الموجود متباع بالعبوة (لفة كاملة)، المسح معناه إنه
       بيبيع بالمتر كمان — فبنفتحله سطر جديد بدل ما نزوّد لفة غلط. */
    const already = rows.find(r => r.itemId === item.id && !r.sellPack);
    if (already) {
      already.qty = Math.round((Number(already.qty || 0) + 1) * 1000) / 1000;
      Utils.beep('ok');
      drawRows(container, already._id, 'qty');
      return;
    }
    let target = rows.find(r => !r.itemId && !r.name && !r.barcode);
    if (!target) { target = blankRow(); rows.push(target); }
    applyItem(target, item);
    Utils.beep('ok');
    if (!rows.some(r => !r.itemId && !r.name && !r.barcode)) rows.push(blankRow());
    drawRows(container, target._id, 'qty');
  }

  function applyItem(row, item) {
    row.itemId = item.id;
    row.name = item.name;
    row.barcode = item.barcode || '';
    row.unit = item.unit || 'قطعة';
    row.cost = item.costPrice || 0;
    row.stock = item.stock || 0;
    row.retailPrice = item.salePrice || 0;
    row.wholesalePrice = item.wholesalePrice || 0;
    row.packSize = Number(item.packSize || 0);
    row.packName = item.packName || Units.packLabel(row.unit);
    row.packPrice = Number(item.packPrice || 0);
    row.sellPack = false;   // الأصل إنه بيبيع بالمتر، واللي عايز لفة بيغيّر الوحدة
    // لو مفعّل وضع الجملة والصنف ليه سعر جملة، بنستعمله
    if (!row.price) row.price = (wholesale && item.wholesalePrice) ? item.wholesalePrice : (item.salePrice || '');
    if (!row.qty) row.qty = 1;
  }

  // بيبدّل السطر بين البيع بالمتر والبيع باللفة
  function switchRowUnit(r, toPack) {
    r.sellPack = !!toPack && canSellPack(r);
    r.qty = 1;
    r.price = r.sellPack
      ? r.packPrice
      : ((wholesale && r.wholesalePrice) ? r.wholesalePrice : (r.retailPrice || ''));
  }

  function drawRows(container, focusRowId, focusField) {
    const body = container.querySelector('#invBody');
    body.innerHTML = rows.map((r, idx) => {
      const c = calc(r);
      const over = r.itemId && c.baseQty > r.stock;
      const canPack = canSellPack(r);
      return `
      <tr data-id="${r._id}">
        <td data-label="#" class="row-num">${idx + 1}</td>
        <td data-label="الباركود">
          <div class="cell-scan">
            <input type="text" class="cell f-barcode" value="${Utils.escapeHtml(r.barcode)}" placeholder="امسح أو اكتب" autocomplete="off">
            <button type="button" class="cell-cam" title="صوّر الباركود">📷</button>
          </div>
        </td>
        <td data-label="الصنف">
          <input type="text" class="cell f-name" value="${Utils.escapeHtml(r.name)}" list="itemNameList" placeholder="اسم الصنف" autocomplete="off">
          ${over ? `<div class="line-derived warn">المتاح ${Units.fmtQty(r.stock, r.unit)} بس</div>` : ''}
        </td>
        <td data-label="الكمية">
          <input type="number" class="cell f-qty num" value="${r.qty}" min="0" step="${c.pack ? '0.01' : Units.step(r.unit)}" inputmode="decimal" placeholder="0">
        </td>
        <td data-label="الوحدة" class="unit-cell">
          ${canPack ? `
            <select class="cell f-unitsel" title="بيبيعها بالوحدة ولا بالعبوة كاملة؟">
              <option value="unit" ${!c.pack ? 'selected' : ''}>${Utils.escapeHtml(r.unit)}</option>
              <option value="pack" ${c.pack ? 'selected' : ''}>${Utils.escapeHtml(r.packName || Units.packLabel(r.unit))}</option>
            </select>`
            : Utils.escapeHtml(r.unit)}
        </td>
        <td data-label="السعر">
          <input type="number" class="cell f-price num" value="${r.price}" min="0" step="0.01" inputmode="decimal" placeholder="0.00">
          ${c.pack && c.basePrice > 0 ? `<div class="line-derived">ال${Utils.escapeHtml(r.unit)} بـ ${Utils.formatMoney(c.basePrice)}</div>` : ''}
        </td>
        <td data-label="الإجمالي" class="cell-total">
          <div class="line-sum">${Utils.formatMoney(c.lineTotal)}</div>
          ${c.pack && c.baseQty > 0 ? `<div class="line-derived">= ${Units.fmtQty(c.baseQty, r.unit)}</div>` : ''}
        </td>
        <td data-label=""><button type="button" class="icon-btn rm-row" title="حذف السطر">🗑️</button></td>
      </tr>`;
    }).join('');

    bindRows(container);
    updateTotals(container);

    if (focusRowId) {
      const tr = body.querySelector(`tr[data-id="${focusRowId}"]`);
      if (tr) {
        const sel = { barcode: '.f-barcode', name: '.f-name', qty: '.f-qty', price: '.f-price' }[focusField || 'qty'];
        const el = tr.querySelector(sel);
        if (el) { el.focus(); el.select && el.select(); }
        tr.classList.add('flash-row');
      }
    }
  }

  function bindRows(container) {
    container.querySelectorAll('#invBody tr').forEach(tr => {
      const id = Number(tr.dataset.id);
      const r = rows.find(x => x._id === id);
      if (!r) return;
      const $ = s => tr.querySelector(s);

      $('.f-barcode').addEventListener('input', e => { r.barcode = e.target.value.trim(); });
      // إنتر في خانة الباركود بيدوّر على الصنف على طول،
      // من غير ما تستنى التركيز يسيب الخانة
      $('.f-barcode').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); }
      });      $('.f-barcode').addEventListener('change', (e) => {
        r.barcode = e.target.value.trim();   // بنقرا من الخانة نفسها (اللصق مش دايمًا بيعمل input)
        const it = AppState.items.find(i => i.barcode === r.barcode);
        if (it) { applyItem(r, it); drawRows(container, id, 'qty'); }
        else if (r.barcode) Utils.toast('الباركود ده مش متسجل', 'error');
      });
      $('.cell-cam').addEventListener('click', async () => {
        const code = await Scanner.scan();
        if (!code) return;
        const it = AppState.items.find(i => i.barcode === code);
        if (it) { applyItem(r, it); drawRows(container, id, 'qty'); }
        else Utils.toast('الباركود ده مش متسجل', 'error');
      });

      $('.f-name').addEventListener('input', e => { r.name = e.target.value; });
      $('.f-name').addEventListener('change', (e) => {
        r.name = e.target.value;
        const it = AppState.items.find(i => (i.name || '').trim() === (r.name || '').trim());
        if (it) { applyItem(r, it); drawRows(container, id, 'qty'); }
      });

      $('.f-qty').addEventListener('input', e => { r.qty = e.target.value; refreshLine(container, tr, r); });
      $('.f-price').addEventListener('input', e => { r.price = e.target.value; refreshLine(container, tr, r); });

      // بيبيع بالمتر ولا باللفة كاملة؟
      if ($('.f-unitsel')) {
        $('.f-unitsel').addEventListener('change', (e) => {
          switchRowUnit(r, e.target.value === 'pack');
          drawRows(container, id, 'qty');
        });
      }

      $('.rm-row').addEventListener('click', () => {
        rows = rows.filter(x => x._id !== id);
        if (!rows.length) rows.push(blankRow());
        drawRows(container);
      });

      tr.querySelectorAll('.cell').forEach(el => el.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const idx = rows.findIndex(x => x._id === id);
        if (idx === rows.length - 1) rows.push(blankRow());
        drawRows(container, rows[idx + 1]._id, 'barcode');
      }));
    });
  }

  function refreshLine(container, tr, r) {
    const c = calc(r);
    tr.querySelector('.line-sum').textContent = Utils.formatMoney(c.lineTotal);

    /* تنبيه "المتاح كذا بس" لازم يتحدّث وهو بيكتب الكمية، مش بعدين.
       بقى أهم دلوقتي لأن لفة واحدة ممكن تكون ١٠٠ متر. */
    const nameEl = tr.querySelector('.f-name');
    if (nameEl) {
      const oldWarn = nameEl.parentElement.querySelector('.line-derived.warn');
      if (oldWarn) oldWarn.remove();
      if (r.itemId && c.baseQty > r.stock) {
        nameEl.insertAdjacentHTML('afterend',
          `<div class="line-derived warn">المتاح ${Units.fmtQty(r.stock, r.unit)} بس</div>`);
      }
    }
    // السطور الصغيرة اللي بتترجم اللفة لأمتار
    const totalCell = tr.querySelector('.cell-total');
    if (totalCell) {
      const note = totalCell.querySelector('.line-derived');
      if (note) note.remove();
      if (c.pack && c.baseQty > 0) {
        totalCell.insertAdjacentHTML('beforeend',
          `<div class="line-derived">= ${Units.fmtQty(c.baseQty, r.unit)}</div>`);
      }
    }
    const priceEl = tr.querySelector('.f-price');
    if (priceEl) {
      const old = priceEl.parentElement.querySelector('.line-derived');
      if (old) old.remove();
      if (c.pack && c.basePrice > 0) {
        priceEl.insertAdjacentHTML('afterend',
          `<div class="line-derived">ال${Utils.escapeHtml(r.unit)} بـ ${Utils.formatMoney(c.basePrice)}</div>`);
      }
    }
    updateTotals(container);
  }

  function updateTotals(container) {
    const sub = subtotal();
    const discount = Number(container.querySelector('#sDiscount').value || 0);
    const total = Math.max(0, sub - discount);
    const paidInput = container.querySelector('#sPaidNow');
    if (!paidTouched || Number(paidInput.value) > total) paidInput.value = total.toFixed(2);
    const paid = Number(paidInput.value || 0);
    const due = Math.max(0, total - paid);

    container.querySelector('#sumCount').textContent = filledRows().length;
    container.querySelector('#sumSub').textContent = Utils.formatMoney(sub);
    container.querySelector('#sumTotal').textContent = Utils.formatMoney(total);
    container.querySelector('#sumPaid').textContent = Utils.formatMoney(paid);
    container.querySelector('#sumDue').textContent = Utils.formatMoney(due);

    const hint = container.querySelector('#sDueHint');
    if (due > 0) {
      hint.textContent = 'الباقي هيتسجل على حساب العميل.';
      hint.style.color = 'var(--amber-deep)';
    } else {
      hint.textContent = 'البيع كاش بالكامل.';
      hint.style.color = 'var(--success)';
    }
  }

  async function doSave(container) {
    if (saving) return;   // الحفظ شغال بالفعل — مش هنعمله تاني

    // لو فيه سطر مكتوب فيه حاجة بس الصنف مش متعرّف، مننفعش نتجاهله في صمت
    const orphan = rows.find(r => !r.itemId && ((r.name || '').trim() || (r.barcode || '').trim()));
    if (orphan) {
      const it = AppState.items.find(i =>
        i.barcode === (orphan.barcode || '').trim() ||
        (i.name || '').trim() === (orphan.name || '').trim());
      if (it) {
        applyItem(orphan, it);   // لقيناه - نكمل عادي
        drawRows(container, orphan._id, 'qty');
      } else {
        Utils.toast(`"${(orphan.name || orphan.barcode).trim()}" مش متسجل في الأصناف — سجّله من المشتريات الأول`, 'error');
        Utils.beep('error');
        return;
      }
    }

    const valid = filledRows();
    if (!valid.length) { Utils.toast('اكتب صنف واحد على الأقل', 'error'); Utils.beep('error'); return; }
    const noQty = rows.find(r => r.itemId && !(calc(r).qty > 0));
    if (noQty) { Utils.toast(`اكتب الكمية للصنف: ${noQty.name}`, 'error'); Utils.beep('error'); return; }
    const bad = valid.find(r => !(calc(r).price > 0));
    if (bad) { Utils.toast(`اكتب سعر البيع للصنف: ${bad.name}`, 'error'); Utils.beep('error'); return; }

    // مينفعش نبيع أكتر من اللي في المخزن. بنجمع كمية كل صنف في الفاتورة كلها
    // (ممكن يكون مكتوب في أكتر من سطر) ونقارنها بالمتاح.
    // بنجمع بالوحدة الأصلية (المتر) عشان اللفة تتحسب بكل أمتارها
    const needed = {};
    valid.forEach(r => { needed[r.itemId] = (needed[r.itemId] || 0) + calc(r).baseQty; });
    const short = [];
    for (const id of Object.keys(needed)) {
      const it = AppState.items.find(i => i.id === Number(id));
      if (!it) continue;
      const have = Number(it.stock || 0);
      if (needed[id] > have + 0.0001) {
        short.push({ name: it.name, unit: it.unit, want: needed[id], have });
      }
    }
    if (short.length) {
      Utils.beep('error');
      const go = await Utils.confirmDialog(
        'مفيش رصيد كافي في المخزن:\n\n' +
        short.map(s => `• ${s.name}: عايز ${Units.fmtQty(s.want, s.unit)} — المتاح ${Units.fmtQty(s.have, s.unit)}`).join('\n') +
        '\n\nراجع الكميات. لو البضاعة موجودة فعلًا في المحل بس لسه متسجلتش، سجّل فاتورة الشراء الأول.\n\n' +
        'تكمل بالسالب على مسؤوليتك؟'
      );
      if (!go) return;
    }

    const dateVal = container.querySelector('#invDate').value;
    const date = dateVal ? new Date(dateVal + 'T12:00:00').toISOString() : Utils.nowISO();
    const customerName = container.querySelector('#customerName').value;
    const discount = Number(container.querySelector('#sDiscount').value || 0);
    const paidNow = Number(container.querySelector('#sPaidNow').value || 0);
    const total = Math.max(0, subtotal() - discount);

    if (total - paidNow > 0 && Services.isCashName(customerName)) {
      Utils.toast('فيه مبلغ باقي — اكتب اسم العميل عشان يتسجل في حسابه', 'error');
      Utils.beep('error');
      container.querySelector('#customerName').focus();
      return;
    }

    // من هنا وطالع بنقفل الحفظ لحد ما يخلص
    saving = true;
    const saveBtn = container.querySelector('#completeSale');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'بيحفظ...'; }

    try {
      const customerId = await Services.resolveParty('customers', customerName);
      const sellerEl = container.querySelector('#sellerSel');
      const sellerVal = sellerEl ? sellerEl.value : '';
      // "صاحب المحل" اختيار مقصود — يعني الفاتورة دي مالهاش عمولة
      const sellerId = (sellerVal && sellerVal !== 'owner') ? Number(sellerVal) : null;
      const sale = {
        date, customerId, discount, sellerId,
        // بنسجّل دايمًا بالوحدة الأصلية (المتر)، وبنحتفظ بشكل العبوة
        // جنبها عشان الفاتورة المطبوعة تقول "٢ لفة" مش "٢٠٠ متر"
        lines: valid.map(r => {
          const c = calc(r);
          return {
            itemId: r.itemId, name: r.name, barcode: r.barcode, unit: r.unit,
            qty: c.baseQty, price: c.basePrice, cost: r.cost,
            packQty: c.pack ? c.qty : null,
            packPrice: c.pack ? c.price : null,
            packSize: c.pack ? c.size : null,
            packName: c.pack ? (r.packName || Units.packLabel(r.unit)) : null
          };
        }),
        paidNow
      };

      const wasEditing = editing;
      const res = wasEditing
        ? await Services.updateSale(wasEditing.id, sale)
        : await Services.saveSale(sale);
      await AppState.reloadItems();
      await AppState.reloadParties();
      await refreshShell();
      Utils.beep('ok');
      Utils.toast(wasEditing ? `اتعدّلت الفاتورة ${res.number}` : `اتحفظت فاتورة البيع ${res.number}`, 'success');
      if (!wasEditing) printReceipt(sale, res, customerName);
      editing = null;
      render(container);            // بيرسم الشاشة من جديد بزرار جديد
    } catch (e) {
      Utils.beep('error');
      Utils.toast('الحفظ مانجحش: ' + (e.message || 'خطأ'), 'error');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = editing ? '💾 احفظ التعديل' : '💾 حفظ وطباعة'; }
    } finally {
      saving = false;
    }
  }

  async function loadRecent(container) {
    const box = container.querySelector('#recentSales');
    if (!box) return;

    const from = (container.querySelector('#qFrom') || {}).value || '';
    const to   = (container.querySelector('#qTo') || {}).value || '';
    const q    = ((container.querySelector('#qName') || {}).value || '').trim().toLowerCase();
    const searching = !!(from || to || q);

    const custName = id => { const x = AppState.customers.find(c => c.id === id); return x ? x.name : 'كاش'; };

    let all = await DB.getAll('sales');
    all.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (from) all = all.filter(s => Utils.dateKey(s.date) >= from);
    if (to)   all = all.filter(s => Utils.dateKey(s.date) <= to);
    if (q) {
      all = all.filter(s =>
        (s.number || '').toLowerCase().includes(q) ||
        custName(s.customerId).toLowerCase().includes(q) ||
        (s.lines || []).some(l => (l.name || '').toLowerCase().includes(q)));
    }

    const list = searching ? all : all.slice(0, 12);

    if (!list.length) {
      box.innerHTML = `<div class="empty-state" style="padding:20px;"><div class="ic">📭</div>${
        searching ? 'مفيش فواتير بالبحث ده' : 'مفيش مبيعات لسه'}</div>`;
      return;
    }

    box.innerHTML = `
      ${searching ? `<div class="hint" style="margin-bottom:8px;">لقينا <strong>${list.length}</strong> فاتورة</div>` : ''}
      ${list.map(s => `
      <div class="line-card clickable" data-id="${s.id}">
        <div class="line-main open-doc">
          <div class="line-name"><span class="stmt-link">${s.number}</span>
            ${s.voided ? '<span class="badge badge-danger">ملغاة</span>' : ''}
            ${s.editedAt ? '<span class="badge badge-muted">اتعدّلت</span>' : ''}</div>
          <div class="line-detail">${Utils.formatDate(s.date)} · ${Utils.escapeHtml(custName(s.customerId))} · ${s.lines.length} صنف${s.dueAmount > 0 ? ' · <span style="color:var(--amber-deep)">آجل ' + Utils.formatMoney(s.dueAmount) + '</span>' : ''}</div>
        </div>
        <div class="line-side">
          <div class="line-total">${Utils.formatMoney(s.total)}</div>
          ${!s.voided ? '<button class="icon-btn edit-btn" title="تعديل الفاتورة">✏️</button>' : ''}
          ${!s.voided ? '<button class="icon-btn void-btn" title="مسح الفاتورة">🗑️</button>' : ''}
        </div>
      </div>`).join('')}`;

    box.querySelectorAll('.open-doc').forEach(el => el.addEventListener('click', (e) => {
      Views.showInvoice('sales', Number(e.currentTarget.closest('.line-card').dataset.id));
    }));

    box.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      openForEdit(container, Number(e.target.closest('.line-card').dataset.id));
    }));

    box.querySelectorAll('.void-btn').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(e.target.closest('.line-card').dataset.id);
      if (!(await Lock.require('مسح الفاتورة'))) return;
      if (!(await Utils.confirmDialog('البضاعة هترجع المخزن، والفلوس وحساب العميل هيترجعوا زي ما كانوا. متأكد؟'))) return;
      await Services.voidSale(id);
      await AppState.reloadItems(); await AppState.reloadParties(); await refreshShell();
      Utils.toast('اتمسحت الفاتورة', 'success');
      loadRecent(container);
    }));
  }

  function printReceipt(sale, res, customerName) {
    const c = AppState.company || {};
    const printArea = document.getElementById('printArea');
    printArea.innerHTML = `
      <div class="receipt">
        <h2>${Utils.escapeHtml(c.name || 'مؤسسة المصطفى للأدوات الكهربائية والحدايد')}</h2>
        <div class="sub">${Utils.escapeHtml(c.phone || '')} ${c.address ? '· ' + Utils.escapeHtml(c.address) : ''}</div>
        <div class="sub">فاتورة ${res.number} — ${Utils.formatDate(sale.date)}</div>
        <div class="sub">العميل: ${Utils.escapeHtml(Services.isCashName(customerName) ? 'كاش' : customerName)}</div>
        <table>
          <thead><tr><th>الصنف</th><th>كمية</th><th>سعر</th><th>إجمالي</th></tr></thead>
          <tbody>
            ${sale.lines.map(l => {
              // اللي اتباع لفة كاملة يتكتب "٢ لفة" مش "٢٠٠ متر"
              const isPack = Number(l.packQty || 0) > 0;
              const q = isPack ? Units.fmtQty(l.packQty, l.packName || 'عبوة') : Units.fmtQty(l.qty, l.unit);
              const p = isPack ? Number(l.packPrice || 0) : Number(l.price || 0);
              const sub = isPack ? `<div class="line-sub">${Units.fmtQty(l.qty, l.unit)}</div>` : '';
              return `<tr><td>${Utils.escapeHtml(l.name)}${sub}</td><td>${q}</td><td>${p.toFixed(2)}</td><td>${(l.qty * l.price).toFixed(2)}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
        ${sale.discount ? `<div class="sub" style="text-align:left;">خصم: ${sale.discount.toFixed(2)}</div>` : ''}
        <div class="tot">الإجمالي: ${res.total.toFixed(2)} ج.م</div>
        ${res.dueAmount > 0 ? `<div class="tot" style="font-size:12px;">المدفوع: ${sale.paidNow.toFixed(2)} — المتبقي: ${res.dueAmount.toFixed(2)}</div>` : ''}
        ${c.note ? `<div class="sub" style="margin-top:10px;">${Utils.escapeHtml(c.note)}</div>` : ''}
      </div>`;
    setTimeout(() => window.print(), 150);
  }

  return { render };
})();
