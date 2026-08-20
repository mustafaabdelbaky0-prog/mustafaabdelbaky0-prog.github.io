Modules.returns = (() => {
  /* فاتورة مرتجع — بنفس أسلوب فاتورة المشتريات (جدول تكتب فيه سطر سطر)

     نوعين:
       مرتجع من عميل  → بضاعة راجعة من الزبون
       مرتجع لمورد    → بضاعة راجعة للمورد

     لكل سطر:
       - الحالة: سليم (يرجع للمخزن ويتباع) أو تالف (يروح لرصيد الضمان)
       - العملية: فلوس (حساب/كاش) أو استبدال (بضاعة ببضاعة من غير فلوس)
       - المورد بيظهر لوحده من آخر مورد جبنا منه الصنف */

  let kind = 'customer';        // customer | supplier
  let rows = [];
  let rowSeq = 0;
  let saving = false;
  let detachScanner = null;

  function blankRow() {
    return {
      _id: ++rowSeq, itemId: null, barcode: '', name: '', unit: 'قطعة',
      qty: '', price: '', condition: 'good', mode: 'money',
      supplierId: null, supplierName: '', reason: ''
    };
  }

  function calc(r) {
    const qty = Number(r.qty || 0);
    const price = Number(r.price || 0);
    return { qty, price, total: r.mode === 'swap' ? 0 : qty * price };
  }
  function grandTotal() { return rows.reduce((s, r) => s + calc(r).total, 0); }
  function filled() { return rows.filter(r => r.itemId && calc(r).qty > 0); }

  async function render(container) {
    await AppState.reloadItems();
    await AppState.reloadParties();
    rows = [blankRow()];
    if (detachScanner) { detachScanner(); detachScanner = null; }
    if (Auth.isSeller() && kind === 'supplier') kind = 'customer';

    const isCust = kind === 'customer';

    container.innerHTML = `
      <div class="tabs" id="retTabs">
        <button data-t="customer" class="${isCust ? 'active' : ''}">مرتجع من عميل</button>
        ${Auth.isSeller() ? '' : `<button data-t="supplier" class="${!isCust ? 'active' : ''}">مرتجع لمورد</button>`}
      </div>

      <div class="card invoice-card">
        <div class="invoice-head">
          <div class="field inv-field">
            <label>التاريخ</label>
            <input type="date" id="retDate" value="${Utils.todayISO()}">
          </div>
          <div class="field inv-field" style="flex:2;">
            <label>${isCust ? 'اسم العميل' : 'اسم المورد'} <span class="muted">(اكتب "كاش" لو نقدي)</span></label>
            <input type="text" id="retParty" list="retPartyList" placeholder="${isCust ? 'اسم العميل أو كاش' : 'هيظهر لوحده من الصنف'}" autocomplete="off">
            <datalist id="retPartyList">
              ${(isCust ? AppState.customers : AppState.suppliers).map(p => `<option value="${Utils.escapeHtml(p.name)}">`).join('')}
            </datalist>
          </div>
          <div class="field inv-field" style="flex:2;">
            <label>سبب المرتجع</label>
            <input type="text" id="retReason" list="reasonList" placeholder="ضمان / تالف / مقاس غلط..." autocomplete="off">
            <datalist id="reasonList">
              <option value="ضمان — باظت قبل انتهاء الضمان">
              <option value="تالف من المورد">
              <option value="مقاس أو نوع غلط">
              <option value="العميل مش عاجبه">
              <option value="زيادة عن الطلب">
            </datalist>
          </div>
        </div>

        <div class="scan-strip">
          <span>📡 امسح بالليزر — الصنف هيتحط في سطر لوحده${isCust ? '' : ' ومعاه اسم المورد'}</span>
          <button type="button" class="btn btn-ghost btn-sm" id="camBtn">📷 كاميرا</button>
        </div>

        <div class="table-wrap invoice-table-wrap">
          <table class="invoice-table ret-table">
            <thead>
              <tr>
                <th style="width:32px;">#</th>
                <th style="width:175px;">الباركود</th>
                <th style="width:190px;">الصنف</th>
                <th style="width:80px;">العدد</th>
                <th style="width:150px;">${isCust ? 'اتشرى من' : 'المورد'}</th>
                <th style="width:130px;">الحالة</th>
                <th style="width:135px;">العملية</th>
                <th style="width:95px;">السعر</th>
                <th style="width:105px;">القيمة</th>
                <th style="width:36px;"></th>
              </tr>
            </thead>
            <tbody id="retBody"></tbody>
          </table>
        </div>

        <button type="button" class="btn btn-ghost" id="addRowBtn" style="margin-top:10px;">+ سطر جديد</button>

        <div class="invoice-foot">
          <div class="foot-left">
            <div class="field inv-field">
              <label>الفلوس تتسوّى إزاي؟</label>
              <select id="settleMode">
                <option value="account">تنزل من الحساب</option>
                <option value="cash">${isCust ? 'أديله كاش من الخزنة' : 'آخد كاش في الخزنة'}</option>
              </select>
              <div class="hint">الأصناف اللي عملتها "استبدال" مش بيتحسبلها فلوس أصلاً.</div>
            </div>
          </div>
          <div class="foot-right">
            <div class="pay-summary">
              <div class="row"><span>عدد الأصناف</span><span id="sumCount">0</span></div>
              <div class="row"><span>استبدال (من غير فلوس)</span><span id="sumSwap">0</span></div>
              <div class="row grand"><span>قيمة المرتجع</span><span id="sumTotal">0.00 ج.م</span></div>
            </div>
            <div class="hint" id="retHint"></div>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-ghost" id="clearRet">فاتورة جديدة</button>
          <button class="btn btn-amber" id="saveRet">💾 حفظ المرتجع</button>
        </div>
      </div>

      <div class="card" style="margin-top:18px;">
        <div class="section-head"><h3>المرتجعات اللي اتسجلت</h3></div>
        <div id="retHistory"></div>
      </div>

      <datalist id="retItemList">
        ${AppState.items.map(i => `<option value="${Utils.escapeHtml(i.name)}">`).join('')}
      </datalist>
    `;

    container.querySelectorAll('#retTabs button').forEach(b =>
      b.addEventListener('click', () => { kind = b.dataset.t; render(container); }));

    drawRows(container);
    loadHistory(container);

    detachScanner = Scanner.attachHardwareScanner(
      container.querySelector('#retParty'), (code) => onScan(container, code));

    container.querySelector('#camBtn').addEventListener('click', async () => {
      const code = await Scanner.scan();
      if (code) onScan(container, code);
    });
    container.querySelector('#addRowBtn').addEventListener('click', () => {
      rows.push(blankRow()); drawRows(container, rows[rows.length - 1]._id, 'barcode');
    });
    container.querySelector('#settleMode').addEventListener('change', () => updateTotals(container));
    container.querySelector('#clearRet').addEventListener('click', async () => {
      if (filled().length && !(await Utils.confirmDialog('هتمسح المرتجع وتبدأ من جديد؟'))) return;
      render(container);
    });
    container.querySelector('#saveRet').addEventListener('click', () => doSave(container));
  }

  function onScan(container, code) {
    const item = AppState.items.find(i => i.barcode === code);
    if (!item) { Utils.beep('error'); Utils.toast('الباركود ده مش متسجل', 'error'); return; }
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
    // المورد بيتملى لوحده من آخر مورد جبنا منه الصنف
    const sup = AppState.suppliers.find(s => s.id === item.lastSupplierId);
    row.supplierId = sup ? sup.id : null;
    row.supplierName = sup ? sup.name : '';
    if (!row.qty) row.qty = 1;
    if (!row.price) row.price = (kind === 'customer' ? item.salePrice : item.costPrice) || '';
  }

  function drawRows(container, focusId, focusField) {
    const body = container.querySelector('#retBody');
    const isCust = kind === 'customer';

    body.innerHTML = rows.map((r, idx) => {
      const c = calc(r);
      const item = AppState.items.find(i => i.id === r.itemId);
      const stock = item ? Number(item.stock || 0) : 0;
      const damaged = item ? Number(item.damagedQty || 0) : 0;
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
          <input type="text" class="cell f-name" value="${Utils.escapeHtml(r.name)}" list="retItemList" placeholder="اسم الصنف" autocomplete="off">
          ${item ? `<div class="inv-sub">بالمخزن ${Units.fmtQty(stock, r.unit)}${damaged > 0 ? ` · تالف ${Units.fmtQty(damaged, r.unit)}` : ''}</div>` : ''}
        </td>
        <td data-label="العدد">
          <input type="number" class="cell f-qty num" value="${r.qty}" min="0" step="${Units.step(r.unit)}" inputmode="decimal" placeholder="0">
        </td>
        <td data-label="${isCust ? 'اتشرى من' : 'المورد'}" class="sup-cell">
          ${r.supplierName
            ? `<div class="sup-auto">${Utils.escapeHtml(r.supplierName)}</div>`
            : `<div class="cell-muted">—</div>`}
        </td>
        <td data-label="الحالة">
          <select class="cell f-cond">
            <option value="good" ${r.condition === 'good' ? 'selected' : ''}>سليم</option>
            <option value="damaged" ${r.condition === 'damaged' ? 'selected' : ''}>تالف / ضمان</option>
          </select>
        </td>
        <td data-label="العملية">
          <select class="cell f-mode">
            <option value="money" ${r.mode === 'money' ? 'selected' : ''}>فلوس</option>
            <option value="swap" ${r.mode === 'swap' ? 'selected' : ''}>استبدال</option>
          </select>
        </td>
        <td data-label="السعر">
          <input type="number" class="cell f-price num" value="${r.price}" min="0" step="0.01"
                 inputmode="decimal" placeholder="0.00" ${r.mode === 'swap' ? 'disabled' : ''}>
        </td>
        <td data-label="القيمة" class="cell-total">
          <div class="line-sum">${r.mode === 'swap' ? '<span class="swap-tag">استبدال</span>' : Utils.formatMoney(c.total)}</div>
        </td>
        <td data-label=""><button type="button" class="icon-btn rm-row" title="حذف السطر">🗑️</button></td>
      </tr>`;
    }).join('');

    bindRows(container);
    updateTotals(container);

    if (focusId) {
      const tr = body.querySelector(`tr[data-id="${focusId}"]`);
      if (tr) {
        const sel = { barcode: '.f-barcode', name: '.f-name', qty: '.f-qty', price: '.f-price' }[focusField || 'qty'];
        const el = tr.querySelector(sel);
        if (el) { el.focus(); el.select && el.select(); }
        tr.classList.add('flash-row');
      }
    }
  }

  function bindRows(container) {
    container.querySelectorAll('#retBody tr').forEach(tr => {
      const id = Number(tr.dataset.id);
      const r = rows.find(x => x._id === id);
      if (!r) return;
      const $ = s => tr.querySelector(s);

      $('.f-barcode').addEventListener('input', e => { r.barcode = e.target.value.trim(); });
      // إنتر في خانة الباركود بيدوّر على الصنف على طول،
      // من غير ما تستنى التركيز يسيب الخانة
      $('.f-barcode').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); }
      });      $('.f-barcode').addEventListener('change', e => {
        r.barcode = e.target.value.trim();
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
      $('.f-name').addEventListener('change', e => {
        r.name = e.target.value;
        const it = AppState.items.find(i => (i.name || '').trim() === r.name.trim());
        if (it) { applyItem(r, it); drawRows(container, id, 'qty'); }
      });

      $('.f-qty').addEventListener('input', e => { r.qty = e.target.value; refreshLine(container, tr, r); });
      $('.f-price').addEventListener('input', e => { r.price = e.target.value; refreshLine(container, tr, r); });
      $('.f-cond').addEventListener('change', e => { r.condition = e.target.value; drawRows(container, id, 'qty'); });
      $('.f-mode').addEventListener('change', e => { r.mode = e.target.value; drawRows(container, id, 'qty'); });

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
    tr.querySelector('.line-sum').innerHTML = r.mode === 'swap'
      ? '<span class="swap-tag">استبدال</span>' : Utils.formatMoney(c.total);
    updateTotals(container);
  }

  function updateTotals(container) {
    const total = grandTotal();
    const swaps = rows.filter(r => r.itemId && r.mode === 'swap' && calc(r).qty > 0).length;
    container.querySelector('#sumCount').textContent = filled().length;
    container.querySelector('#sumSwap').textContent = swaps;
    container.querySelector('#sumTotal').textContent = Utils.formatMoney(total);

    const hint = container.querySelector('#retHint');
    const settle = container.querySelector('#settleMode').value;
    if (total <= 0) {
      hint.textContent = 'مفيش فلوس هتتحرك — استبدال بس.';
      hint.style.color = 'var(--success)';
    } else if (settle === 'account') {
      hint.textContent = kind === 'customer'
        ? 'المبلغ هينزل من حساب العميل.'
        : 'المبلغ هينزل من اللي احنا مدينينه للمورد.';
      hint.style.color = 'var(--amber-deep)';
    } else {
      hint.textContent = kind === 'customer'
        ? 'المبلغ هيطلع كاش من الخزنة للعميل.'
        : 'المبلغ هيدخل كاش في الخزنة.';
      hint.style.color = 'var(--amber-deep)';
    }
  }

  async function doSave(container) {
    if (saving) return;
    const valid = filled();
    if (!valid.length) { Utils.toast('اكتب صنف واحد على الأقل', 'error'); Utils.beep('error'); return; }
    const noPrice = valid.find(r => r.mode === 'money' && !(calc(r).price > 0));
    if (noPrice) { Utils.toast(`اكتب السعر للصنف: ${noPrice.name}`, 'error'); Utils.beep('error'); return; }

    const dateVal = container.querySelector('#retDate').value;
    const date = dateVal ? new Date(dateVal + 'T12:00:00').toISOString() : Utils.nowISO();
    const reason = container.querySelector('#retReason').value.trim();
    const settle = container.querySelector('#settleMode').value;
    let partyName = container.querySelector('#retParty').value.trim();

    // لو مورد ومكتبش الاسم، بناخده من الصنف نفسه
    if (kind === 'supplier' && Services.isCashName(partyName)) {
      const withSup = valid.find(r => r.supplierName);
      if (withSup) partyName = withSup.supplierName;
    }

    const total = grandTotal();
    if (total > 0 && settle === 'account' && Services.isCashName(partyName)) {
      Utils.toast(`اكتب اسم ${kind === 'customer' ? 'العميل' : 'المورد'} عشان ينزل من حسابه`, 'error');
      Utils.beep('error');
      container.querySelector('#retParty').focus();
      return;
    }

    saving = true;
    const btn = container.querySelector('#saveRet');
    btn.disabled = true; btn.textContent = 'بيحفظ...';
    try {
      const partyId = await Services.resolveParty(
        kind === 'customer' ? 'customers' : 'suppliers', partyName);

      const res = await Services.saveReturn({
        kind, date, partyId, reason, settle,
        lines: valid.map(r => ({
          itemId: r.itemId, name: r.name, qty: calc(r).qty, price: calc(r).price,
          condition: r.condition, mode: r.mode, reason: reason
        }))
      });

      await AppState.reloadItems(); await AppState.reloadParties();
      if (typeof refreshShell === 'function') await refreshShell();
      Utils.beep('ok');
      Utils.toast(`اتسجل المرتجع ${res.number}` + (res.total > 0 ? ` بقيمة ${Utils.formatMoney(res.total)}` : ' (استبدال)'), 'success');
      render(container);
    } catch (e) {
      Utils.beep('error');
      Utils.toast(e.message || 'المرتجع مانجحش', 'error');
      btn.disabled = false; btn.textContent = '💾 حفظ المرتجع';
    } finally {
      saving = false;
    }
  }

  async function loadHistory(container) {
    const all = await DB.getAll('returns');
    all.sort((a, b) => new Date(b.date) - new Date(a.date));
    const box = container.querySelector('#retHistory');
    if (!box) return;
    if (!all.length) {
      box.innerHTML = `<div class="empty-state" style="padding:22px;">مفيش مرتجعات لسه</div>`;
      return;
    }
    const nameOf = (d) => {
      const list = d.kind === 'customer' ? AppState.customers : AppState.suppliers;
      const p = list.find(x => x.id === d.partyId);
      return p ? p.name : 'كاش';
    };
    box.innerHTML = `
      <div class="table-wrap" style="border:none;">
        <table>
          <thead><tr><th>التاريخ</th><th>الرقم</th><th>النوع</th><th>الطرف</th><th>الأصناف</th><th>السبب</th><th>القيمة</th><th></th></tr></thead>
          <tbody>
            ${all.slice(0, 30).map(d => `
              <tr data-id="${d.id}" ${d.voided ? 'style="opacity:.55;"' : ''}>
                <td>${Utils.formatDate(d.date)}</td>
                <td class="strong">${d.number}${d.voided ? ' <span class="badge badge-danger">اتمسح</span>' : ''}</td>
                <td><span class="badge ${d.kind === 'customer' ? 'badge-ok' : 'badge-warn'}">${d.kind === 'customer' ? 'من عميل' : 'لمورد'}</span></td>
                <td>${Utils.escapeHtml(nameOf(d))}</td>
                <td class="muted" style="font-size:12px;">
                  ${d.lines.map(l => Utils.escapeHtml(l.name) + ' (' + Units.fmtQty(l.qty, l.unit) +
                    (l.mode === 'swap' ? ' · استبدال' : '') + (l.condition === 'damaged' ? ' · تالف' : '') + ')').join('، ')}
                </td>
                <td class="muted" style="font-size:12px;">${Utils.escapeHtml(d.reason || '—')}</td>
                <td class="strong">${d.total > 0 ? Utils.formatMoney(d.total) : '<span class="swap-tag">استبدال</span>'}</td>
                <td>${d.voided ? '' : '<button class="icon-btn void-ret" title="امسح المرتجع">🗑️</button>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    box.querySelectorAll('.void-ret').forEach(btn => btn.addEventListener('click', async (e) => {
      const id = Number(e.target.closest('tr').dataset.id);
      if (!(await Lock.require('مسح مرتجع'))) return;
      if (!(await Utils.confirmDialog(
        'هيترجع أثر المرتجع بالكامل: المخزن والتالف والفلوس وحساب الطرف. متأكد؟'))) return;
      try {
        await Services.voidReturn(id);
      } catch (err) {
        Utils.beep('error');
        await Utils.confirmDialog(err.message || 'المسح مانجحش');
        return;
      }
      await AppState.reloadItems(); await AppState.reloadParties(); await refreshShell();
      Utils.toast('اتمسح المرتجع', 'success');
      render(container);
    }));
  }

  return { render };
})();
