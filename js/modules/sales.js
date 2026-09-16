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

  /* آخر فاتورة اتحفظت في التشغيلة دي.

     الموقف اللي بيحصل كل يوم: بيبيع للزبون ويحفظ، والزبون يرجع بعد
     دقيقة يسأل على حاجة في فاتورته. فبنسيب الفاتورة اللي لسه
     متحفظة قدامه فوق بزرارين: افتحها / اطبعها — من غير ما يدوّر. */
  let lastSaved = null;   // { id, number, total, customer }
  let justSaved = false;  // الرسم الجاي جاي بعد حفظ — يوري الشريط
  let autoPrint = false; // يطبع الفاتورة لوحده بعد الحفظ؟ (بيتقرا من الإعدادات)

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
    /* شريط "اتحفظت الفاتورة" بيظهر بعد الحفظ على طول، وبيفضل لحد ما
       يبدأ فاتورة جديدة بإيده أو يسيب الشاشة. */
    if (!justSaved) lastSaved = null;
    justSaved = false;

    /* خانة البائع بتظهر بس لو فيه موظفين مسجلين — الحل ده بيخلي
       الشاشة زي ما هي بالظبط لحد ما يسجّل أول موظف. */
    const sellers = (await DB.getAll('employees'))
      .filter(e => e.active !== false)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));

    const apRec = await DB.get('settings', 'autoPrintInvoice');
    autoPrint = apRec ? !!apRec.value : false;

    container.innerHTML = `
      ${editing ? `
      <div class="edit-banner">
        <div>
          <strong>بتعدّل في فاتورة ${Utils.escapeHtml(editing.number)}</strong>
          <div class="hint" style="margin-top:2px;">أي تغيير هيتظبط لوحده في المخزن وحساب العميل</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="cancelEdit">سيبها زي ما هي</button>
      </div>` : ''}
      ${!editing && lastSaved ? `
      <div class="last-saved" id="lastSaved">
        <div>
          <strong>✅ اتحفظت فاتورة ${Utils.escapeHtml(lastSaved.number)}</strong>
          <span class="hint">${Utils.escapeHtml(lastSaved.customer)} · ${Utils.formatMoney(lastSaved.total)}</span>
        </div>
        <div class="last-saved-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="lsOpen">🧾 افتحها</button>
          <button type="button" class="btn btn-ghost btn-sm" id="lsPrint">🖨️ اطبعها</button>
        </div>
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

        <!-- بحث جوه سطور الفاتورة نفسها -->
        <div class="row-find">
          <span class="rf-ic">🔍</span>
          <input type="text" id="rowFind" placeholder="دوّر جوه سطور الفاتورة المفتوحة دي" autocomplete="off">
          <button type="button" class="btn btn-ghost btn-sm" id="rowFindClear" hidden>امسح البحث</button>
          <span class="rf-count" id="rowFindCount"></span>
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
          <button class="btn btn-amber" id="completeSale">${editing ? '💾 احفظ التعديل' : (autoPrint ? '💾 حفظ وطباعة' : '💾 حفظ الفاتورة')}</button>
        </div>
      </div>

      <div class="card" style="margin-top:18px;" id="recentCard">
        <div class="section-head">
          <h3>فواتير النهارده</h3>
          <button type="button" class="btn btn-ghost btn-sm" id="goSalesList">📚 فواتير قديمة؟ افتح فواتير المبيعات</button>
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
    // الفواتير القديمة والبحث فيهم ليهم شاشتهم — "فواتير المبيعات"
    const goList = container.querySelector('#goSalesList');
    if (goList) goList.addEventListener('click', () => {
      if (typeof navigate === 'function') navigate('saleslist');
    });

    // ---------- أزرار وضع التعديل ----------
    const cancelBtn = container.querySelector('#cancelEdit');
    if (cancelBtn) cancelBtn.addEventListener('click', () => render(container));

    // ---------- شريط آخر فاتورة اتحفظت ----------
    const lsOpen = container.querySelector('#lsOpen');
    if (lsOpen) lsOpen.addEventListener('click', () => Views.showInvoice('sales', lastSaved.id));
    const lsPrint = container.querySelector('#lsPrint');
    if (lsPrint) lsPrint.addEventListener('click', async () => {
      const doc = await DB.get('sales', lastSaved.id);
      if (!doc) { Utils.toast('الفاتورة مش موجودة', 'error'); return; }
      Printing.invoice('sales', doc, lastSaved.customer);
    });

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
          <input type="text" class="cell f-name" value="${Utils.escapeHtml(r.name)}" placeholder="ابحث بالاسم أو الباركود" autocomplete="off">
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
    applyRowFilter(container);   // البحث بيفضل شغال بعد إعادة رسم الجدول
    bindPicker(container);
    bindRowFind(container);
    updateTotals(container);

    if (focusRowId) {
      const tr = body.querySelector(`tr[data-id="${focusRowId}"]`);
      if (tr) {
        /* أي خانة في السطر — الاسم بييجي من الكلاس (f-qty ← qty).
           ولو الخانة دي مش موجودة في السطر الجديد بنرجع للكمية. */
        const el = tr.querySelector('.f-' + (focusField || 'qty'))
                || tr.querySelector('.f-qty')
                || tr.querySelector('.f-barcode');
        if (el) { el.focus(); el.select && el.select(); }
        tr.classList.add('flash-row');
      }
    }
  }

  /* البحث جوّه خانات الجدول — بيتربط مرة واحدة على الجدول كله
     مش على كل سطر، لأن الجدول بيتعاد رسمه كتير وانت بتكتب */
  let pickerBound = null;
  function bindPicker(container) {
    if (pickerBound === container) return;
    pickerBound = container;
    const take = (it, input) => {
      const id = Number(input.closest('tr').dataset.id);
      const r = rows.find(x => x._id === id);
      if (!r) return;
      applyItem(r, it);
      drawRows(container, id, 'qty');
    };
    Picker.bind(container, {
      '.f-barcode': { search: (q) => Picker.searchItems(q), render: Picker.itemRow, onPick: take },
      '.f-name':    { search: (q) => Picker.searchItems(q), render: Picker.itemRow, onPick: take }
    });
  }

  /* بحث جوه سطور الفاتورة — بيخبّي اللي مش مطابق شكليًا بس،
     السطور كلها بتفضل في الفاتورة والإجماليات على الكل */
  let rowFilter = '';
  function rowMatches(r, q) {
    if (!q) return true;
    return Search.matchesAny([r.name, r.barcode, r.unit, r.packName], q);
  }
  function applyRowFilter(container) {
    const body = container.querySelector('#invBody');
    if (!body) return;
    const q = rowFilter.trim().toLowerCase();
    let shown = 0;
    body.querySelectorAll('tr[data-id]').forEach(tr => {
      const r = rows.find(x => x._id === Number(tr.dataset.id));
      const ok = !r || rowMatches(r, q);
      tr.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    const cnt = container.querySelector('#rowFindCount');
    const clr = container.querySelector('#rowFindClear');
    if (cnt) cnt.textContent = q ? shown + ' من ' + rows.length + ' سطر' : '';
    if (clr) clr.hidden = !q;
    /* لو البحث خبّى كل السطور بنكتبله إن مفيش نتيجة — عشان الجدول
       الفاضي شكله كإن البرنامج باظ */
    let msg = body.querySelector('.rf-empty');
    if (q && shown === 0) {
      if (!msg) {
        msg = document.createElement('tr');
        msg.className = 'empty-row rf-empty';
        msg.innerHTML = '<td colspan="12"></td>';
        body.appendChild(msg);
      }
      /* المستخدم بيكتب هنا اسم صنف وهو متوقع إنها تدوّرله عليه.
         بدل ما نسيبه في طريق مسدود بنوريه الصنف ونخليه يضيفه. */
      const term = rowFilter.trim();
      const hit = Picker.searchItems(term)[0];
      msg.querySelector('td').innerHTML =
        '<div style="line-height:2;">مفيش سطر فيه "<strong>' + Utils.escapeHtml(term) +
        '</strong>" في الفاتورة المفتوحة دي — السطور الـ' + rows.length + ' كلها زي ما هي.' +
        (hit ? '<div class="rf-actions"><button type="button" class="btn btn-amber btn-sm" id="rfAdd" data-id="' +
               hit.id + '">+ ضيف "' + Utils.escapeHtml(hit.name) + '" للفاتورة</button></div>' : '') +
        '</div>';
      msg.style.display = '';
      const addBtn = msg.querySelector('#rfAdd');
      if (addBtn) addBtn.addEventListener('click', () => {
        const it = AppState.items.find(i => Number(i.id) === Number(addBtn.dataset.id));
        if (!it) return;
        const blank = rows.find(r => !r.itemId && !(r.name || '').trim() && !(r.barcode || '').trim());
        const target = blank || (rows.push(blankRow()), rows[rows.length - 1]);
        applyItem(target, it);
        rowFilter = '';
        const fe = container.querySelector('#rowFind');
        if (fe) fe.value = '';
        drawRows(container, target._id, 'qty');
      });
    } else if (msg) { msg.remove(); }
  }
  let findBound = null;
  function bindRowFind(container) {
    const el = container.querySelector('#rowFind');
    if (!el) return;
    el.value = rowFilter;
    if (findBound === el) return;   // الجدول بيتعاد رسمه كتير — مننفعش نربط مرتين
    findBound = el;
    el.addEventListener('input', () => { rowFilter = el.value; applyRowFilter(container); });
    const c = container.querySelector('#rowFindClear');
    if (c) c.addEventListener('click', () => { rowFilter = ''; el.value = ''; applyRowFilter(container); el.focus(); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { rowFilter = ''; el.value = ''; applyRowFilter(container); }
    });
    applyRowFilter(container);
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

      /* Enter بينزّلك على نفس الخانة في السطر اللي تحت — زي الإكسيل */
      tr.querySelectorAll('.cell').forEach(el => el.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const idx = rows.findIndex(x => x._id === id);
        if (idx === rows.length - 1) rows.push(blankRow());
        drawRows(container, rows[idx + 1]._id, Utils.fieldOf(e.target));
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

    /* سطر مكتوب فيه صنف مش متعرّف.

       الأول بندوّر عليه بالاسم أو الباركود — يمكن يكون موجود وهو
       كتبه بإيده. لو ملقناهوش يبقى صنف جديد فعلاً: البضاعة نزلت
       والزبون طلبها قبل ما يلحق يدخّل فاتورة الشراء.

       بنعمله صنف على طول بدل ما نوقّف البيعة. رصيده هيبقى بالسالب
       وتكلفته صفر، والاتنين هيتظبطوا لوحدهم أول ما يسجّل فاتورة
       الشراء — وبنعلّم عليه بالأحمر لحد ما يعملها. */
    const orphans = rows.filter(r => !r.itemId && ((r.name || '').trim() || (r.barcode || '').trim()));
    const born = [];
    for (const orphan of orphans) {
      const nm = (orphan.name || '').trim();
      const bc = (orphan.barcode || '').trim();
      const it = AppState.items.find(i =>
        (bc && i.barcode === bc) || (nm && (i.name || '').trim() === nm));
      if (it) { applyItem(orphan, it); continue; }   // لقيناه — نكمل عادي

      if (!nm) {
        Utils.toast(`الباركود "${bc}" مش متسجل — اكتب اسم الصنف جنبه عشان نسجّله`, 'error');
        Utils.beep('error');
        drawRows(container, orphan._id, 'name');
        return;
      }
      if (!(calc(orphan).price > 0)) {
        Utils.toast(`اكتب سعر البيع للصنف الجديد: ${nm}`, 'error');
        Utils.beep('error');
        drawRows(container, orphan._id, 'price');
        return;
      }
      born.push({ row: orphan, name: nm, barcode: bc });
    }

    if (born.length) {
      const ok = await Utils.confirmDialog(
        (born.length === 1
          ? `"${born[0].name}" مش متسجل في الأصناف.`
          : `${born.length} صنف مش متسجلين في الأصناف:\n` + born.map(b => '• ' + b.name).join('\n')) +
        `\n\nهنسجّله دلوقتي وهنكمّل البيع عادي.\n` +
        `هتلاقيه بالأحمر في المخزون لحد ما تدخّل فاتورة الشراء بتاعته،` +
        ` وساعتها الرصيد وسعر الشراء هيتظبطوا لوحدهم.\n\n` +
        `نكمّل؟`);
      if (!ok) return;

      for (const b of born) {
        const unit = (b.row.unit || 'قطعة').trim() || 'قطعة';
        const id = await DB.put('items', {
          barcode: b.barcode || await Utils.genInternalBarcode(),
          name: b.name, category: '', unit,
          costPrice: 0,                       // لسه ما نعرفهاش — هتتظبط من فاتورة الشراء
          salePrice: Number(calc(b.row).price || 0),
          stock: 0, damagedQty: 0, minStock: 0, active: true
        });
        await AppState.reloadItems();
        const fresh = AppState.items.find(i => i.id === id);
        if (fresh) applyItem(b.row, fresh);
      }
      drawRows(container);
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
    /* البيع من بضاعة لسه ما اتسجلتش حاجة عادية في المحل: البضاعة
       نزلت والزبون طلبها قبل ما تلحق تدخّلها. بنبيع عادي وبنعلّم
       على الصنف بالأحمر في المخزون، وأول ما تسجّل فاتورة الشراء
       الرقم بيتظبط لوحده. */
    if (short.length) {
      const go = await Utils.confirmDialog(
        'الأصناف دي رصيدها في البرنامج أقل من اللي بتبيعه:\n\n' +
        short.map(s => `• ${s.name}: بتبيع ${Units.fmtQty(s.want, s.unit)} — المسجّل ${Units.fmtQty(s.have, s.unit)}`).join('\n') +
        '\n\nلو البضاعة موجودة فعلاً في المحل وانت لسه ما دخّلتش فاتورة الشراء، كمّل عادي.\n' +
        'هتلاقيها متعلّمة بالأحمر في المخزون، وأول ما تسجّل فاتورة الشراء الرقم هيتظبط لوحده.\n\n' +
        'نكمّل البيع؟'
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
      /* الطباعة التلقائية بقت اختيار.

         مهم جدًا لو طابعة الملصقات هي الافتراضية: من غير الاختيار ده
         كل بيعة كانت هتطلع إيصال على رول الملصقات وتضيّعه. */
      if (!wasEditing && autoPrint) printReceipt(sale, res, customerName);
      editing = null;
      lastSaved = { id: res.id, number: res.number, total: res.total ?? total,
                    customer: customerName || 'كاش' };
      justSaved = true;
      render(container);            // بيرسم الشاشة من جديد بزرار جديد
    } catch (e) {
      Utils.beep('error');
      Utils.toast('الحفظ مانجحش: ' + (e.message || 'خطأ'), 'error');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = editing ? '💾 احفظ التعديل' : (autoPrint ? '💾 حفظ وطباعة' : '💾 حفظ الفاتورة'); }
    } finally {
      saving = false;
    }
  }

  /* ---------- كروت الفواتير ----------
     نفس الكارت بيتستعمل في مكانين: تحت نقطة البيع (فواتير النهارده
     بس) وفي شاشة "فواتير المبيعات" (بحث في كل الفواتير).
     الترتيب دايمًا: الأحدث فوق — آخر فاتورة اتعملت هي أول واحدة. */
  function sortNewestFirst(list) {
    return list.slice().sort((a, b) => {
      const d = new Date(b.date) - new Date(a.date);
      return d !== 0 ? d : (Number(b.id) - Number(a.id));
    });
  }

  function custName(id) {
    const x = AppState.customers.find(c => c.id === id);
    return x ? x.name : 'كاش';
  }

  // الفاتورة لسه فيها حاجة تترجّع؟ (مش ملغية ولسه مش كلها راجعة)
  function returnable(s) {
    if (s.voided) return false;
    return (s.lines || []).some(l => Number(l.qty || 0) - Number(l.returnedQty || 0) > 0.0001);
  }

  function renderSaleCards(box, list, container, opts) {
    opts = opts || {};
    const onChange = opts.onChange || (() => {});
    if (!list.length) {
      box.innerHTML = `<div class="empty-state" style="padding:20px;"><div class="ic">📭</div>${
        opts.emptyText || 'مفيش فواتير'}</div>`;
      return;
    }
    box.innerHTML = `
      ${opts.countText ? `<div class="hint" style="margin-bottom:8px;">${opts.countText}</div>` : ''}
      ${list.map(s => {
        const returned = (s.lines || []).some(l => Number(l.returnedQty || 0) > 0);
        return `
      <div class="line-card clickable" data-id="${s.id}">
        <div class="line-main open-doc">
          <div class="line-name"><span class="stmt-link">${s.number}</span>
            ${s.voided ? '<span class="badge badge-danger">ملغاة</span>' : ''}
            ${s.editedAt ? '<span class="badge badge-muted">اتعدّلت</span>' : ''}
            ${returned ? '<span class="badge badge-warn">فيها مرتجع</span>' : ''}</div>
          <div class="line-detail">${Utils.formatDate(s.date)} · ${Utils.escapeHtml(custName(s.customerId))} · ${s.lines.length} صنف${s.dueAmount > 0 ? ' · <span style="color:var(--amber-deep)">آجل ' + Utils.formatMoney(s.dueAmount) + '</span>' : ''}</div>
        </div>
        <div class="line-side">
          <div class="line-total">${Utils.formatMoney(s.total)}</div>
          <button class="btn btn-ghost btn-sm open-doc" title="افتح الفاتورة">🧾 افتح</button>
          ${returnable(s) ? '<button class="btn btn-ghost btn-sm ret-btn" title="مرتجع من الفاتورة دي">↩︎ مرتجع</button>' : ''}
          ${!s.voided ? '<button class="icon-btn edit-btn" title="تعديل الفاتورة">✏️</button>' : ''}
          ${!s.voided ? '<button class="icon-btn void-btn" title="مسح الفاتورة">🗑️</button>' : ''}
        </div>
      </div>`; }).join('')}`;

    box.querySelectorAll('.open-doc').forEach(el => el.addEventListener('click', (e) => {
      Views.showInvoice('sales', Number(e.currentTarget.closest('.line-card').dataset.id));
    }));

    box.querySelectorAll('.ret-btn').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openQuickReturn(Number(e.target.closest('.line-card').dataset.id), onChange);
    }));

    box.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(e.target.closest('.line-card').dataset.id);
      if (opts.editIn) { opts.editIn(id); return; }
      openForEdit(container, id);
    }));

    box.querySelectorAll('.void-btn').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(e.target.closest('.line-card').dataset.id);
      if (!(await Lock.require('مسح الفاتورة'))) return;
      if (!(await Utils.confirmDialog('البضاعة هترجع المخزن، والفلوس وحساب العميل هيترجعوا زي ما كانوا. متأكد؟'))) return;
      try {
        await Services.voidSale(id);
      } catch (err) { Utils.toast(err.message, 'error'); return; }
      await AppState.reloadItems(); await AppState.reloadParties(); await refreshShell();
      Utils.toast('اتمسحت الفاتورة', 'success');
      onChange();
    }));
  }

  /* تحت نقطة البيع: فواتير النهارده بس. اليوم بيومه — اللي فات ليه
     شاشته (فواتير المبيعات) عشان الشاشة دي تفضل خفيفة ونضيفة. */
  async function loadRecent(container) {
    const box = container.querySelector('#recentSales');
    if (!box) return;
    const today = Utils.todayISO();
    const all = sortNewestFirst((await DB.getAll('sales')).filter(s => Utils.dateKey(s.date) === today));
    renderSaleCards(box, all, container, {
      emptyText: 'لسه مفيش فواتير النهارده',
      onChange: () => loadRecent(container)
    });
  }

  /* ---------- مرتجع سريع من فاتورة ----------
     الزبون رجع بحاجة من اللي لسه شاريها: بيدوس "مرتجع" جنب فاتورته،
     يختار إيه اللي راجع وكام، ويخلص. مش محتاج يروح شاشة المرتجعات
     ويدوّر على الصنف من الأول — دي بقت للحاجات اللي اتباعت من زمان. */
  async function openQuickReturn(saleId, onDone) {
    const sale = await DB.get('sales', saleId);
    if (!sale) { Utils.toast('الفاتورة مش موجودة', 'error'); return; }
    if (sale.voided) { Utils.toast('الفاتورة دي ملغية', 'error'); return; }

    const lines = (sale.lines || []).map((l, i) => ({
      i, name: l.name, unit: l.unit || 'قطعة', itemId: l.itemId,
      price: Number(l.price || 0), sold: Number(l.qty || 0),
      back: Number(l.returnedQty || 0),
      left: Math.round((Number(l.qty || 0) - Number(l.returnedQty || 0)) * 1000) / 1000
    }));
    if (!lines.some(l => l.left > 0.0001)) { Utils.toast('كل اللي في الفاتورة دي اترجّع خلاص', 'info'); return; }

    const named = !!sale.customerId;
    const who = custName(sale.customerId);
    /* الفلوس ترجع منين؟ لو الفاتورة كلها اتدفعت → كاش من الخزنة.
       لو لسه عليه باقي → بتتخصم من اللي عليه. وهو يقدر يغيّر. */
    const defaultSettle = (named && Number(sale.dueAmount || 0) > 0) ? 'account' : 'cash';

    Utils.openModal({
      title: `مرتجع من فاتورة ${sale.number}`,
      wide: true,
      bodyHtml: `
        <form id="qrForm" novalidate>
          <div class="hint" style="margin-bottom:10px;">
            ${Utils.formatDate(sale.date)} · ${Utils.escapeHtml(who)} · الإجمالي ${Utils.formatMoney(sale.total)}
            — اكتب الكمية الراجعة قدام كل صنف
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>الصنف</th><th class="num-cell">اتباع</th><th class="num-cell">راجع قبل كده</th>
                <th class="num-cell">راجع دلوقتي</th><th>حالته</th><th class="num-cell">يرجعله</th>
              </tr></thead>
              <tbody>
                ${lines.map(l => `
                <tr data-i="${l.i}" class="${l.left > 0.0001 ? '' : 'voided'}">
                  <td>${Utils.escapeHtml(l.name)}<div class="inv-sub">${Utils.formatMoney(l.price)} / ${Utils.escapeHtml(l.unit)}</div></td>
                  <td class="num-cell">${Units.fmtQty(l.sold, l.unit)}</td>
                  <td class="num-cell">${l.back > 0 ? Units.fmtQty(l.back, l.unit) : '—'}</td>
                  <td class="num-cell">
                    <input type="number" class="cell qr-qty" min="0" max="${l.left}" step="${Units.allowsDecimals(l.unit) ? '0.001' : '1'}"
                           value="" placeholder="0" inputmode="decimal" ${l.left > 0.0001 ? '' : 'disabled'} style="width:80px;">
                  </td>
                  <td>
                    <select class="cell qr-cond" ${l.left > 0.0001 ? '' : 'disabled'} style="width:110px;">
                      <option value="good">سليم — يرجع المخزن</option>
                      <option value="damaged">تالف</option>
                    </select>
                  </td>
                  <td class="num-cell qr-line-total">—</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>

          <div class="qr-foot">
            <div class="field" style="max-width:280px;">
              <label>الفلوس ترجع إزاي</label>
              <select id="qrSettle">
                <option value="cash" ${defaultSettle === 'cash' ? 'selected' : ''}>كاش من الخزنة</option>
                ${named ? `<option value="account" ${defaultSettle === 'account' ? 'selected' : ''}>تتخصم من حساب ${Utils.escapeHtml(who)}</option>` : ''}
              </select>
            </div>
            <div class="qr-total">يرجعله: <strong id="qrTotal">${Utils.formatMoney(0)}</strong></div>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" id="qrCancel">إلغاء</button>
            <button type="submit" class="btn btn-amber" id="qrSave">↩︎ سجّل المرتجع</button>
          </div>
        </form>`,
      onMount: (body, close) => {
        const qtyOf = (tr) => Number(tr.querySelector('.qr-qty').value || 0);
        const refresh = () => {
          let total = 0;
          body.querySelectorAll('tr[data-i]').forEach(tr => {
            const l = lines[Number(tr.dataset.i)];
            const q = qtyOf(tr);
            const t = q > 0 ? q * l.price : 0;
            total += t;
            tr.querySelector('.qr-line-total').textContent = t > 0 ? Utils.formatMoney(t) : '—';
          });
          body.querySelector('#qrTotal').textContent = Utils.formatMoney(total);
          body.querySelector('#qrSave').disabled = total <= 0 && ![...body.querySelectorAll('tr[data-i]')].some(tr => qtyOf(tr) > 0);
        };
        body.addEventListener('input', refresh);
        refresh();
        // أول خانة كمية جاهزة للكتابة على طول
        const first = body.querySelector('.qr-qty:not([disabled])');
        if (first) first.focus();

        body.querySelector('#qrCancel').addEventListener('click', close);
        Utils.guardSubmit(body.querySelector('#qrForm'), async () => {
          const out = [];
          for (const tr of body.querySelectorAll('tr[data-i]')) {
            const l = lines[Number(tr.dataset.i)];
            const q = qtyOf(tr);
            if (q <= 0) continue;
            if (q > l.left + 0.0001) throw new Error(`"${l.name}": الباقي اللي ينفع يرجع ${l.left} بس`);
            out.push({
              itemId: l.itemId, name: l.name, qty: q, price: l.price,
              condition: tr.querySelector('.qr-cond').value, mode: 'refund',
              saleId: sale.id, saleLineIndex: l.i
            });
          }
          if (!out.length) throw new Error('اكتب كمية راجعة قدام صنف واحد على الأقل');
          const settle = body.querySelector('#qrSettle').value;
          const res = await Services.saveReturn({
            kind: 'customer', partyId: sale.customerId || null, date: Utils.nowISO(),
            reason: 'مرتجع من فاتورة ' + sale.number, settle, lines: out
          });
          await AppState.reloadItems(); await AppState.reloadParties(); await refreshShell();
          Utils.beep('ok');
          Utils.toast(`اتسجل المرتجع ${res.number} — ${settle === 'cash' ? 'رجّعله ' + Utils.formatMoney(res.total) + ' كاش' : 'اتخصم من حسابه ' + Utils.formatMoney(res.total)}`, 'success');
          close();
          if (onDone) onDone();
        });
      }
    });
  }

  function printReceipt(sale, res, customerName) {
    const c = AppState.company || {};
    const printArea = document.getElementById('printArea');
    if (typeof Barcode !== 'undefined' && Barcode.clearPageSize) Barcode.clearPageSize();
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

  /* editFromList: شاشة "فواتير المبيعات" بتطلب تعديل فاتورة — بنفتحها
     هنا في نقطة البيع لأن التعديل محتاج الجدول كله */
  let pendingEditId = null;
  function editFromList(id) { pendingEditId = id; }
  async function renderWithPending(container) {
    await render(container);
    if (pendingEditId) { const id = pendingEditId; pendingEditId = null; await openForEdit(container, id); }
  }

  return { render: renderWithPending, renderSaleCards, openQuickReturn, sortNewestFirst, editFromList };
})();
