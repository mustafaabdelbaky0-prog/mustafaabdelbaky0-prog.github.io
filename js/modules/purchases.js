Modules.purchases = (() => {
  /* فاتورة شراء على شكل جدول:
     الباركود | الصنف | الكمية | النوع | فيها كام | سعر النوع | سعر الوحدة (تلقائي) | الإجمالي

     النوع: المستخدم يختار أو يكتب اللي هو عايزه (كرتونة، لفة، طبلية، ربطة...)
       - لو كتب وحدة بيع معروفة (قطعة/كيلو/متر/نسخة) ← الكمية والسعر بالوحدة مباشرة
       - لو كتب أي حاجة تانية ← بتتعامل كعبوة، وبيكتب "فيها كام + الوحدة"
         مثال: لفة سلك فيها 100 متر بـ 1200 ← سعر المتر بيطلع 12.00 لوحده */

  let rows = [];
  let detachScanner = null;
  let rowSeq = 0;
  let saving = false;   // بيمنع إن دوستين سريعتين على "حفظ" يعملوا فاتورتين
  let editing = null;   // الفاتورة اللي بنعدّل فيها دلوقتي (null = فاتورة جديدة)

  /* بيحوّل سطر فاتورة متسجلة لسطر في الجدول عشان تقدر تعدّله.
     لو الشرا كان بالعبوة (كرتونة/لفة) بنرجّعه بنفس شكله الأصلي
     مش بالوحدة، عشان تلاقيه زي ما كتبته بالظبط. */
  function lineToRow(l) {
    const r = blankRow();
    const it = AppState.items.find(i => i.id === l.itemId);
    r.itemId = l.itemId;
    r.barcode = it ? (it.barcode || '') : '';
    r.name = l.name || (it ? it.name : '');
    r.category = it ? (it.category || '') : '';
    r.salePrice = it ? (it.salePrice || '') : '';
    r.packSalePrice = it ? (it.packPrice || '') : '';
    if (Number(l.packSize || 0) > 0) {
      r.unit = l.unit || 'قطعة';
      r.packType = l.packName || 'كرتونة';
      r.packSize = l.packSize;
      r.qty = l.packQty;
      r.price = l.packCost;
    } else {
      r.unit = l.unit || 'قطعة';
      r.packType = l.unit || 'قطعة';
      r.packSize = '';
      r.qty = l.qty;
      r.price = l.cost;
    }
    return r;
  }

  async function openForEdit(container, id) {
    const doc = await DB.get('purchases', id);
    if (!doc) { Utils.toast('الفاتورة مش موجودة', 'error'); return; }
    if (doc.voided) { Utils.toast('الفاتورة دي ملغاة — مينفعش تتعدّل', 'error'); return; }
    if (!(await Lock.require('تعديل فاتورة'))) return;

    await AppState.reloadItems();
    editing = doc;
    rows = (doc.lines || []).map(lineToRow);
    if (!rows.length) rows = [blankRow()];
    await render(container, true);

    const sup = AppState.suppliers.find(s => s.id === doc.supplierId);
    container.querySelector('#supplierName').value = sup ? sup.name : 'كاش';
    container.querySelector('#invDate').value = Utils.dateKey(doc.date);
    container.querySelector('#paidNow').value = doc.paidNow || 0;
    updateTotals(container);
    window.scrollTo(0, 0);
  }

  function blankRow() {
    return {
      _id: ++rowSeq, itemId: null, barcode: '', name: '', category: '',
      unit: 'قطعة', packType: 'قطعة', packSize: '', qty: '', price: '',
      salePrice: '', packSalePrice: ''
    };
  }

  /* سطر صغير تحت سعر العبوة بيقول: العبوة دي بتطلع ال«متر» بكام،
     وبكده يشوف بعينه إنها فعلاً أرخص من القطاعي وإنه لسه كاسب. */
  function packSaleNote(r, c, u) {
    const total = Number(r.packSalePrice || 0);
    if (!(c.pack && total > 0 && c.size > 0)) return '';
    const per = total / c.size;
    const one = Number(r.salePrice || 0);
    const cost = c.unitCost;
    const bad = cost > 0 && per < cost;
    let txt = `ال${u} بـ ${Utils.formatMoney(per)}`;
    if (bad) txt += ' · ⚠️ أقل من التكلفة';
    else if (one > 0 && per > one) txt += ' · ⚠️ أغلى من القطاعي';
    else if (one > 0) txt += ` · أرخص بـ ${Utils.formatMoney(one - per)}`;
    return `<div class="pack-sale-note ${bad ? 'bad' : ''}">${Utils.escapeHtml(txt)}</div>`;
  }

  /* القاعدة بسيطة وواضحة: لو كتبت "فيها كام" يبقى النوع ده عبوة، وبنحسب سعر الوحدة منه.
     لو سيبتها فاضية يبقى النوع نفسه هو وحدة البيع.
     كده "لفة" تنفع تبقى عبوة (لفة فيها 100 متر) أو وحدة بيع، وانت اللي بتقرر. */
  function calc(r) {
    const qty = Number(r.qty || 0);
    const price = Number(r.price || 0);
    const size = Number(r.packSize || 0);
    const pack = size > 0;
    return {
      qty, price, size, pack,
      totalUnits: pack ? qty * size : qty,
      unitCost: pack ? price / size : price,
      lineTotal: qty * price
    };
  }

  // الوحدة اللي الصنف هيتخزن ويتباع بيها
  function effUnit(r) {
    return (Number(r.packSize || 0) > 0 ? (r.unit || 'قطعة') : (r.packType || 'قطعة')).trim() || 'قطعة';
  }

  function invoiceTotal() { return rows.reduce((s, r) => s + calc(r).lineTotal, 0); }

  function filledRows() {
    return rows.filter(r => (r.name || '').trim() && calc(r).totalUnits > 0 && calc(r).unitCost > 0);
  }

  function headerHint() {
    return 'سيبها فاضية لو بتشتري بالوحدة، أو اكتب العدد + الوحدة لو عبوة (مثال: 100 متر)';
  }

  async function render(container, keepEdit) {
    await AppState.reloadItems();
    await AppState.reloadParties();
    if (!keepEdit) { editing = null; rows = [blankRow()]; }
    if (detachScanner) { detachScanner(); detachScanner = null; }

    container.innerHTML = `
      ${editing ? `
      <div class="edit-banner">
        <div>
          <strong>بتعدّل في فاتورة ${Utils.escapeHtml(editing.number)}</strong>
          <div class="hint" style="margin-top:2px;">أي تغيير هيتظبط لوحده في المخزن وحساب المورد</div>
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
            <label>اسم المورد <span class="muted">(اكتب "كاش" لو مورد نقدي)</span></label>
            <input type="text" id="supplierName" list="supplierList" placeholder="اكتب اسم المورد أو كاش" autocomplete="off">
            <datalist id="supplierList">
              ${AppState.suppliers.map(s => `<option value="${Utils.escapeHtml(s.name)}">`).join('')}
            </datalist>
          </div>
          <div class="field inv-field">
            <label>رقم الفاتورة</label>
            <input type="text" value="تلقائي" disabled>
          </div>
        </div>

        <div class="scan-strip">
          <span>📡 امسح بالليزر في أي وقت — الصنف هيتحط في سطر جديد لوحده</span>
          <button type="button" class="btn btn-ghost btn-sm" id="camBtn">📷 كاميرا</button>
        </div>

        <div class="table-wrap invoice-table-wrap">
          <table class="invoice-table">
            <thead>
              <tr>
                <th style="width:32px;">#</th>
                <th style="width:165px;">الباركود</th>
                <th style="width:175px;">الصنف</th>
                <th style="width:115px;">التصنيف</th>
                <th style="width:72px;">الكمية</th>
                <th style="width:105px;">النوع</th>
                <th style="width:160px;" title="${headerHint()}">فيها كام <span class="th-hint">؟</span></th>
                <th style="width:95px;">سعر الشراء</th>
                <th style="width:105px;">سعر الوحدة</th>
                <th style="width:95px;">سعر البيع</th>
                <th style="width:105px;">الإجمالي</th>
                <th style="width:36px;"></th>
              </tr>
            </thead>
            <tbody id="invBody"></tbody>
          </table>
        </div>

        <button type="button" class="btn btn-ghost" id="addRowBtn" style="margin-top:10px;">+ سطر جديد</button>

        <div class="invoice-foot">
          <div class="foot-left">
            <div class="field inv-field">
              <label>المدفوع دلوقتي من الخزنة (عربون)</label>
              <input type="number" id="paidNow" min="0" step="0.01" value="0" inputmode="decimal">
              <div class="tag-row" style="margin-top:8px;">
                <button type="button" class="btn btn-ghost btn-sm" id="payAll">دفعت الكل</button>
                <button type="button" class="btn btn-ghost btn-sm" id="payNone">مدفعتش حاجة</button>
              </div>
            </div>
          </div>
          <div class="foot-right">
            <div class="pay-summary">
              <div class="row"><span>عدد الأصناف</span><span id="sumCount">0</span></div>
              <div class="row"><span>إجمالي الفاتورة</span><span id="sumTotal">0.00 ج.م</span></div>
              <div class="row"><span>المدفوع</span><span id="sumPaid">0.00 ج.م</span></div>
              <div class="row grand"><span>الباقي على المورد</span><span id="sumDue">0.00 ج.م</span></div>
            </div>
            <div class="hint" id="dueHint"></div>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-ghost" id="clearInv">فاتورة جديدة</button>
          ${editing ? `<button class="btn btn-danger" id="deleteInv">🗑️ امسح الفاتورة</button>` : ''}
          <button class="btn btn-amber" id="saveInv">${editing ? '💾 احفظ التعديل' : '💾 حفظ الفاتورة'}</button>
        </div>
      </div>

      <div class="card" style="margin-top:18px;">
        <div class="section-head"><h3>فواتير المشتريات</h3></div>
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
            <label>المورد أو رقم الفاتورة</label>
            <input type="text" id="qName" placeholder="اكتب اسم المورد أو رقم الفاتورة" autocomplete="off">
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="qClear">امسح البحث</button>
        </div>
        <div id="recentPurchases"></div>
      </div>

      <datalist id="itemNameList">
        ${AppState.items.map(i => `<option value="${Utils.escapeHtml(i.name)}">`).join('')}
      </datalist>
      <datalist id="catList">
        ${AppState.categorySuggestions().map(v => `<option value="${Utils.escapeHtml(v)}">`).join('')}
      </datalist>
      <datalist id="typeList">
        ${AppState._uniq(AppState.unitSuggestions().concat(AppState.packTypeSuggestions()))
            .map(v => `<option value="${Utils.escapeHtml(v)}">`).join('')}
      </datalist>
      <datalist id="unitOnlyList">
        ${AppState.unitSuggestions().map(v => `<option value="${Utils.escapeHtml(v)}">`).join('')}
      </datalist>
    `;

    drawRows(container);
    loadRecent(container);

    detachScanner = Scanner.attachHardwareScanner(
      container.querySelector('#supplierName'),
      (code) => onScan(container, code)
    );

    container.querySelector('#camBtn').addEventListener('click', async () => {
      const code = await Scanner.scan();
      if (code) onScan(container, code);
    });
    container.querySelector('#addRowBtn').addEventListener('click', () => {
      rows.push(blankRow()); drawRows(container, rows[rows.length - 1]._id, 'barcode');
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
        `هتمسح فاتورة ${editing.number}؟\nالبضاعة هتتشال من المخزن، والفلوس وحساب المورد هيترجعوا زي ما كانوا.`))) return;
      try {
        await Services.voidPurchase(editing.id);
      } catch (err) {
        Utils.beep('error');
        await Utils.confirmDialog(err.message || 'المسح مانجحش');
        return;
      }
      await AppState.reloadItems(); await AppState.reloadParties(); await refreshShell();
      Utils.toast('اتمسحت الفاتورة', 'success');
      render(container);
    });
    container.querySelector('#paidNow').addEventListener('input', () => updateTotals(container));
    container.querySelector('#payAll').addEventListener('click', () => {
      container.querySelector('#paidNow').value = invoiceTotal().toFixed(2); updateTotals(container);
    });
    container.querySelector('#payNone').addEventListener('click', () => {
      container.querySelector('#paidNow').value = '0'; updateTotals(container);
    });
    container.querySelector('#clearInv').addEventListener('click', async () => {
      if (filledRows().length && !(await Utils.confirmDialog('هتمسح الفاتورة وتبدأ واحدة جديدة؟'))) return;
      render(container);
    });
    container.querySelector('#saveInv').addEventListener('click', () => doSave(container));
  }

  function onScan(container, code) {
    const item = AppState.items.find(i => i.barcode === code);
    let target = rows.find(r => !r.barcode && !r.name);
    if (!target) { target = blankRow(); rows.push(target); }
    target.barcode = code;
    if (item) { applyItem(target, item); Utils.beep('ok'); }
    else { Utils.beep('error'); Utils.toast('باركود جديد — اكتب اسم الصنف والسعر', 'info'); }
    if (!rows.some(r => !r.barcode && !r.name)) rows.push(blankRow());
    drawRows(container, target._id, item ? 'qty' : 'name');
  }

  function applyItem(row, item) {
    row.itemId = item.id;
    row.name = item.name;
    row.barcode = item.barcode || row.barcode;
    row.category = item.category || '';
    row.unit = item.unit || 'قطعة';
    if (!row.salePrice) row.salePrice = item.salePrice || '';
    if (item.packSize > 0) {
      row.packType = item.packName || Units.packLabel(row.unit);
      row.packSize = item.packSize;
      if (!row.packSalePrice) row.packSalePrice = item.packPrice || '';
      if (!row.price) row.price = (item.costPrice || 0) * item.packSize;
    } else {
      row.packType = row.unit;
      row.packSize = '';
      if (!row.price) row.price = item.costPrice || '';
    }
    if (!row.qty) row.qty = 1;
  }

  function drawRows(container, focusRowId, focusField) {
    const body = container.querySelector('#invBody');
    body.innerHTML = rows.map((r, idx) => {
      const c = calc(r);
      const u = effUnit(r);
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
        </td>
        <td data-label="التصنيف">
          <input type="text" class="cell f-category" value="${Utils.escapeHtml(r.category)}" list="catList" placeholder="كهرباء..." autocomplete="off">
        </td>
        <td data-label="الكمية">
          <input type="number" class="cell f-qty num" value="${r.qty}" min="0"
                 step="${c.pack ? '0.01' : Units.step(u)}" inputmode="decimal" placeholder="0">
        </td>
        <td data-label="النوع">
          <input type="text" class="cell f-packtype" value="${Utils.escapeHtml(r.packType)}"
                 list="typeList" placeholder="قطعة / كرتونة..." autocomplete="off">
        </td>
        <td data-label="فيها كام">
          <div class="pack-cell">
            <input type="number" class="cell f-packsize num" value="${r.packSize}" min="0" step="any"
                   inputmode="decimal" placeholder="50">
            <span class="pack-x">×</span>
            <input type="text" class="cell f-unit" value="${Utils.escapeHtml(c.pack ? r.unit : '')}"
                   list="unitOnlyList" placeholder="${Utils.escapeHtml(u)}" autocomplete="off">
          </div>
        </td>
        <td data-label="سعر الشراء">
          <input type="number" class="cell f-price num" value="${r.price}" min="0" step="0.01" inputmode="decimal" placeholder="0.00">
        </td>
        <td data-label="سعر الوحدة" class="cell-unitcost">
          ${c.unitCost > 0 ? `
            <div class="unit-cost">${Utils.formatMoney(c.unitCost)}</div>
            <div class="unit-cost-sub">لل${Utils.escapeHtml(u)}${c.pack && c.totalUnits > 0 ? ` · ${Units.fmtQty(c.totalUnits, u)}` : ''}</div>`
            : `<div class="cell-muted">—</div>`}
        </td>
        <td data-label="سعر البيع">
          <input type="number" class="cell f-sale num" value="${r.salePrice}" min="0" step="0.01" inputmode="decimal" placeholder="0.00" title="سعر بيع ال${Utils.escapeHtml(u)} الواحد">
          ${c.unitCost > 0 && Number(r.salePrice || 0) > 0 ? `
            <div class="profit-tag ${Number(r.salePrice) >= c.unitCost ? 'good' : 'bad'}">
              ${Number(r.salePrice) >= c.unitCost
                ? '+' + Utils.formatMoney(Number(r.salePrice) - c.unitCost)
                : 'أقل من التكلفة!'}
            </div>` : ''}
          ${c.pack ? `
            <div class="pack-sale">
              <span class="pack-sale-lbl">سعر ال${Utils.escapeHtml(r.packType || 'عبوة')}</span>
              <input type="number" class="cell f-packsale num" value="${r.packSalePrice}" min="0" step="0.01"
                     inputmode="decimal" placeholder="اختياري"
                     title="سعر بيع ال${Utils.escapeHtml(r.packType || 'عبوة')} كاملة لو الزبون خدها بحالها">
            </div>
            ${packSaleNote(r, c, u)}` : ''}
        </td>
        <td data-label="الإجمالي" class="cell-total">
          <div class="line-sum">${Utils.formatMoney(c.lineTotal)}</div>
        </td>
        <td data-label=""><button type="button" class="icon-btn rm-row" title="حذف السطر">🗑️</button></td>
      </tr>`;
    }).join('');

    bindRows(container);
    updateTotals(container);

    if (focusRowId) {
      const tr = body.querySelector(`tr[data-id="${focusRowId}"]`);
      if (tr) {
        const sel = { barcode: '.f-barcode', name: '.f-name', qty: '.f-qty',
                      price: '.f-price', packsize: '.f-packsize' }[focusField || 'qty'];
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

      $('.f-barcode').addEventListener('input', (e) => { r.barcode = e.target.value.trim(); });
      // إنتر في خانة الباركود بيدوّر على الصنف على طول،
      // من غير ما تستنى التركيز يسيب الخانة
      $('.f-barcode').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); }
      });      $('.f-barcode').addEventListener('change', (e) => {
        r.barcode = e.target.value.trim();
        const it = AppState.items.find(i => i.barcode === r.barcode);
        if (it) { applyItem(r, it); drawRows(container, id, 'qty'); }
      });
      $('.cell-cam').addEventListener('click', async () => {
        const code = await Scanner.scan();
        if (!code) return;
        r.barcode = code;
        const it = AppState.items.find(i => i.barcode === code);
        if (it) applyItem(r, it);
        drawRows(container, id, it ? 'qty' : 'name');
      });

      $('.f-name').addEventListener('input', (e) => { r.name = e.target.value; });
      $('.f-name').addEventListener('change', (e) => {
        r.name = e.target.value;
        const it = AppState.items.find(i => (i.name || '').trim() === (r.name || '').trim());
        if (it) { applyItem(r, it); drawRows(container, id, 'qty'); }
      });

      $('.f-category').addEventListener('input', (e) => { r.category = e.target.value; });
      $('.f-category').addEventListener('change', (e) => { r.category = e.target.value.trim(); });

      $('.f-qty').addEventListener('input', (e) => { r.qty = e.target.value; refreshLine(container, tr, r); });
      $('.f-price').addEventListener('input', (e) => { r.price = e.target.value; refreshLine(container, tr, r); });
      $('.f-sale').addEventListener('input', (e) => { r.salePrice = e.target.value; refreshLine(container, tr, r); });
      if ($('.f-packsale')) {
        $('.f-packsale').addEventListener('input', (e) => { r.packSalePrice = e.target.value; refreshLine(container, tr, r); });
      }

      // النوع: مكتوب بالإيد أو مختار من القايمة
      $('.f-packtype').addEventListener('input', (e) => { r.packType = (e.target.value || '').trim() || 'قطعة'; });
      $('.f-packtype').addEventListener('change', (e) => {
        r.packType = (e.target.value || '').trim() || 'قطعة';
        // لو كتب نوع مش وحدة بيع (كرتونة/لفة/طبلية) يبقى غالبًا عبوة ← نوديه لخانة "فيها كام"
        const looksLikePack = !Units.isBaseUnit(r.packType);
        drawRows(container, id, looksLikePack ? 'packsize' : 'qty');
      });

      $('.f-packsize').addEventListener('input', (e) => {
        const wasPack = Number(r.packSize || 0) > 0;
        r.packSize = e.target.value;
        const nowPack = Number(r.packSize || 0) > 0;
        // أول ما يكتب رقم، خانة الوحدة بتتفتح
        if (wasPack !== nowPack) drawRows(container, id, 'packsize');
        else refreshLine(container, tr, r);
      });
      const un = $('.f-unit');
      if (un) {
        un.addEventListener('input', (e) => { r.unit = e.target.value.trim() || 'قطعة'; refreshLine(container, tr, r); });
        un.addEventListener('change', (e) => {
          r.unit = e.target.value.trim() || 'قطعة';   // بنقرا من الخانة نفسها
          refreshLine(container, tr, r);
        });
      }

      $('.rm-row').addEventListener('click', () => {
        rows = rows.filter(x => x._id !== id);
        if (!rows.length) rows.push(blankRow());
        drawRows(container);
      });

      tr.querySelectorAll('.cell').forEach(el => el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const idx = rows.findIndex(x => x._id === id);
        if (idx === rows.length - 1) rows.push(blankRow());
        drawRows(container, rows[idx + 1]._id, 'barcode');
      }));
    });
  }

  // تحديث الأرقام في السطر من غير ما نعيد رسم الجدول (عشان الكتابة متتقطعش)
  function refreshLine(container, tr, r) {
    const c = calc(r);
    const u = effUnit(r);
    tr.querySelector('.line-sum').textContent = Utils.formatMoney(c.lineTotal);
    const box = tr.querySelector('.cell-unitcost');
    if (box) {
      box.innerHTML = c.unitCost > 0
        ? `<div class="unit-cost">${Utils.formatMoney(c.unitCost)}</div>
           <div class="unit-cost-sub">لل${Utils.escapeHtml(u)}${c.pack && c.totalUnits > 0 ? ` · ${Units.fmtQty(c.totalUnits, u)}` : ''}</div>`
        : `<div class="cell-muted">—</div>`;
    }
    // علامة المكسب جنب سعر البيع
    const saleEl = tr.querySelector('.f-sale');
    const saleCell = saleEl && saleEl.parentElement;
    if (saleCell) {
      const old = saleCell.querySelector('.profit-tag');
      if (old) old.remove();
      const sale = Number(r.salePrice || 0);
      if (c.unitCost > 0 && sale > 0) {
        const good = sale >= c.unitCost;
        saleEl.insertAdjacentHTML('afterend',
          `<div class="profit-tag ${good ? 'good' : 'bad'}">${good ? '+' + Utils.formatMoney(sale - c.unitCost) : 'أقل من التكلفة!'}</div>`);
      }
      // سطر "ال متر بكام" تحت سعر العبوة
      const oldNote = saleCell.querySelector('.pack-sale-note');
      if (oldNote) oldNote.remove();
      const note = packSaleNote(r, c, u);
      if (note) saleCell.insertAdjacentHTML('beforeend', note);
    }
    updateTotals(container);
  }

  function updateTotals(container) {
    const total = invoiceTotal();
    const paidInput = container.querySelector('#paidNow');
    let paid = Number(paidInput.value || 0);
    if (paid > total) { paid = total; paidInput.value = total.toFixed(2); }
    const due = Math.max(0, total - paid);

    container.querySelector('#sumCount').textContent = filledRows().length;
    container.querySelector('#sumTotal').textContent = Utils.formatMoney(total);
    container.querySelector('#sumPaid').textContent = Utils.formatMoney(paid);
    container.querySelector('#sumDue').textContent = Utils.formatMoney(due);

    const hint = container.querySelector('#dueHint');
    if (due > 0) {
      hint.textContent = 'المبلغ ده هيتسجل على حساب المورد وينزل لوحده مع كل دفعة.';
      hint.style.color = 'var(--amber-deep)';
    } else {
      hint.textContent = 'الفاتورة مدفوعة بالكامل.';
      hint.style.color = 'var(--success)';
    }
  }

  async function doSave(container) {
    if (saving) return;   // الحفظ شغال بالفعل — مش هنعمله تاني

    const valid = filledRows();
    if (!valid.length) { Utils.toast('اكتب صنف واحد على الأقل بكمية وسعر', 'error'); Utils.beep('error'); return; }

    for (const r of rows) {
      const c = calc(r);
      if (!(r.name || '').trim() && !r.barcode && !r.qty && !r.price) continue;
      if (!(r.name || '').trim()) { Utils.toast('فيه سطر من غير اسم صنف', 'error'); Utils.beep('error'); return; }
      if (!(c.totalUnits > 0)) { Utils.toast(`اكتب الكمية للصنف: ${r.name}`, 'error'); Utils.beep('error'); return; }
      if (!(c.unitCost > 0)) { Utils.toast(`اكتب السعر للصنف: ${r.name}`, 'error'); Utils.beep('error'); return; }
    }

    const dateVal = container.querySelector('#invDate').value;
    const date = dateVal ? new Date(dateVal + 'T12:00:00').toISOString() : Utils.nowISO();
    const supplierName = container.querySelector('#supplierName').value;
    const paidNow = Number(container.querySelector('#paidNow').value || 0);
    const total = invoiceTotal();

    if (total - paidNow > 0 && Services.isCashName(supplierName)) {
      Utils.toast('فيه مبلغ باقي — اكتب اسم المورد عشان يتسجل في حسابه', 'error');
      Utils.beep('error');
      container.querySelector('#supplierName').focus();
      return;
    }

    const bal = await Services.getCashBalance();
    if (paidNow > bal && !(await Utils.confirmDialog(
      `المدفوع (${Utils.formatMoney(paidNow)}) أكبر من رصيد الخزنة (${Utils.formatMoney(bal)}). تكمل؟`))) return;

    // من هنا وطالع بنقفل الحفظ لحد ما يخلص
    saving = true;
    const saveBtn = container.querySelector('#saveInv');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'بيحفظ...'; }

    try {

    const lines = [];
    // الأصناف اللي اتعملت في الفاتورة دي — عشان لو نفس الباركود أو الاسم اتكرر
    // في سطرين مايتعملش صنفين مكررين
    const createdInThisInvoice = new Map();

    for (const r of valid) {
      const c = calc(r);
      const u = effUnit(r);
      const sale = Number(r.salePrice || 0);
      // سعر بيع العبوة كاملة (لفة/كرتونة) — بيتحفظ على الصنف عشان البياع
      // يلاقيه جاهز في شاشة البيع
      const packSale = c.pack ? Number(r.packSalePrice || 0) : 0;
      let itemId = r.itemId;

      // لو الاسم مطابق لصنف موجود بس المستخدم مادوسش برّه الخانة، نلاقيه هنا
      if (!itemId) {
        const byName = AppState.items.find(i => (i.name || '').trim() === r.name.trim());
        if (byName && !(r.barcode || '').trim()) itemId = byName.id;
      }

      if (!itemId) {
        const barcode = (r.barcode || '').trim() || Utils.genInternalBarcode();
        const key = barcode + '|' + r.name.trim();
        if (createdInThisInvoice.has(barcode) || createdInThisInvoice.has(key)) {
          itemId = createdInThisInvoice.get(barcode) || createdInThisInvoice.get(key);
        }
        const dup = itemId ? null : AppState.items.find(i => i.barcode === barcode);
        if (dup) itemId = dup.id;
        else if (!itemId) {
          itemId = await DB.put('items', {
            barcode, name: r.name.trim(),
            category: (r.category || '').trim(),
            unit: u,
            packSize: c.pack ? c.size : null,
            packName: c.pack ? r.packType : null,
            packPrice: packSale > 0 ? packSale : null,
            costPrice: c.unitCost, salePrice: sale,
            stock: 0, minStock: 0, active: true
          });
          createdInThisInvoice.set(barcode, itemId);
          createdInThisInvoice.set(key, itemId);
        }
      }
      if (itemId) {
        // بنحدّث الصنف بأي حاجة جديدة كتبها (تصنيف/سعر بيع/العبوة) عشان تتفتكر بعد كده
        const it = AppState.items.find(i => i.id === itemId);
        if (it) {
          let changed = false;
          const cat = (r.category || '').trim();
          if (cat && it.category !== cat) { it.category = cat; changed = true; }
          if (sale > 0 && it.salePrice !== sale) { it.salePrice = sale; changed = true; }
          if (c.pack && (it.packSize !== c.size || it.packName !== r.packType)) {
            it.packSize = c.size; it.packName = r.packType; changed = true;
          }
          if (packSale > 0 && it.packPrice !== packSale) { it.packPrice = packSale; changed = true; }
          if (it.unit !== u) { it.unit = u; changed = true; }
          if (changed) await DB.put('items', it);
        }
      }
      lines.push({
        itemId, name: r.name.trim(), unit: u,
        qty: c.totalUnits, cost: c.unitCost,
        packQty: c.pack ? c.qty : null, packCost: c.pack ? c.price : null,
        packSize: c.pack ? c.size : null, packName: c.pack ? r.packType : null
      });
    }

    const supplierId = await Services.resolveParty('suppliers', supplierName);
    const res = editing
      ? await Services.updatePurchase(editing.id, { date, supplierId, lines, paidNow })
      : await Services.savePurchase({ date, supplierId, lines, paidNow });

    await AppState.reloadItems();
    await AppState.reloadParties();
    await refreshShell();
    Utils.beep('ok');
    Utils.toast(
      (editing ? `اتعدّلت الفاتورة ${res.number}` : `اتحفظت الفاتورة ${res.number}`) +
      (res.dueAmount > 0 ? ` — باقي ${Utils.formatMoney(res.dueAmount)} على المورد` : ''), 'success');
    editing = null;
    render(container);            // بيرسم الشاشة من جديد بزرار جديد

    } catch (e) {
      Utils.beep('error');
      Utils.toast('الحفظ مانجحش: ' + (e.message || 'خطأ'), 'error');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 حفظ الفاتورة'; }
    } finally {
      saving = false;
    }
  }

  async function loadRecent(container) {
    const box = container.querySelector('#recentPurchases');
    if (!box) return;

    const from = (container.querySelector('#qFrom') || {}).value || '';
    const to   = (container.querySelector('#qTo') || {}).value || '';
    const q    = ((container.querySelector('#qName') || {}).value || '').trim().toLowerCase();
    const searching = !!(from || to || q);

    const supName = id => { const s = AppState.suppliers.find(x => x.id === id); return s ? s.name : 'كاش'; };

    let all = await DB.getAll('purchases');
    all.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (from) all = all.filter(p => Utils.dateKey(p.date) >= from);
    if (to)   all = all.filter(p => Utils.dateKey(p.date) <= to);
    if (q) {
      all = all.filter(p =>
        (p.number || '').toLowerCase().includes(q) ||
        supName(p.supplierId).toLowerCase().includes(q) ||
        (p.lines || []).some(l => (l.name || '').toLowerCase().includes(q)));
    }

    const list = searching ? all : all.slice(0, 12);

    if (!list.length) {
      box.innerHTML = `<div class="empty-state" style="padding:20px;"><div class="ic">📭</div>${
        searching ? 'مفيش فواتير بالبحث ده' : 'مفيش فواتير شراء لسه'}</div>`;
      return;
    }

    box.innerHTML = `
      ${searching ? `<div class="hint" style="margin-bottom:8px;">لقينا <strong>${list.length}</strong> فاتورة</div>` : ''}
      ${list.map(p => `
      <div class="line-card clickable" data-id="${p.id}">
        <div class="line-main open-doc">
          <div class="line-name"><span class="stmt-link">${p.number}</span>
            ${p.voided ? '<span class="badge badge-danger">ملغاة</span>' : ''}
            ${p.editedAt ? '<span class="badge badge-muted">اتعدّلت</span>' : ''}</div>
          <div class="line-detail">${Utils.formatDate(p.date)} · ${Utils.escapeHtml(supName(p.supplierId))} · ${p.lines.length} صنف${p.dueAmount > 0 ? ' · <span style="color:var(--amber-deep)">آجل ' + Utils.formatMoney(p.dueAmount) + '</span>' : ''}</div>
        </div>
        <div class="line-side">
          <div class="line-total">${Utils.formatMoney(p.total)}</div>
          ${!p.voided ? '<button class="icon-btn edit-btn" title="تعديل الفاتورة">✏️</button>' : ''}
          ${!p.voided ? '<button class="icon-btn void-btn" title="مسح الفاتورة">🗑️</button>' : ''}
        </div>
      </div>`).join('')}`;

    box.querySelectorAll('.open-doc').forEach(el => el.addEventListener('click', (e) => {
      Views.showInvoice('purchases', Number(e.currentTarget.closest('.line-card').dataset.id));
    }));

    box.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      openForEdit(container, Number(e.target.closest('.line-card').dataset.id));
    }));

    box.querySelectorAll('.void-btn').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(e.target.closest('.line-card').dataset.id);
      if (!(await Lock.require('مسح الفاتورة'))) return;
      if (!(await Utils.confirmDialog('البضاعة هتتشال من المخزن، والفلوس وحساب المورد هيترجعوا زي ما كانوا. متأكد؟'))) return;
      try {
        await Services.voidPurchase(id);
      } catch (err) {
        Utils.beep('error');
        await Utils.confirmDialog(err.message || 'المسح مانجحش');
        return;
      }
      await AppState.reloadItems(); await AppState.reloadParties(); await refreshShell();
      Utils.toast('اتمسحت الفاتورة', 'success');
      loadRecent(container);
    }));
  }

  return { render };
})();
