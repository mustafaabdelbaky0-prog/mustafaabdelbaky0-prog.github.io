Modules.items = (() => {

  function stockBadge(item) {
    if (item.stock <= 0) return `<span class="badge badge-danger">نفذ</span>`;
    if (item.minStock && item.stock <= item.minStock) return `<span class="badge badge-warn">منخفض</span>`;
    return `<span class="badge badge-ok">متوفر</span>`;
  }

  function rowHtml(item) {
    return `
      <tr data-id="${item.id}">
        <td>${Utils.escapeHtml(item.barcode || '—')}</td>
        <td style="font-weight:700;">${Utils.escapeHtml(item.name)}</td>
        <td>${Utils.escapeHtml(item.category || '—')}</td>
        <td>${Utils.escapeHtml(item.unit || 'قطعة')}</td>
        ${Auth.isSeller() ? '' : `<td>${Utils.formatMoney(item.costPrice)}</td>`}
        <td>${Utils.formatMoney(item.salePrice)}</td>
        <td>${Units.fmtQty(item.stock, item.unit)}</td>
        <td>${stockBadge(item)}</td>
        <td>
          ${Auth.isSeller() ? '' : `
            <button class="icon-btn edit-item" title="تعديل">✏️</button>
            <button class="icon-btn del-item" title="حذف">🗑️</button>`}
        </td>
      </tr>`;
  }

  async function render(container) {
    await AppState.reloadItems();
    container.innerHTML = `
      <div class="section-head">
        <div class="search-box" style="max-width:340px;">
          <input type="text" id="itemSearch" placeholder="ابحث بالاسم أو الباركود...">
        </div>
        ${Auth.isSeller() ? '' : '<button class="btn btn-amber" id="addItemBtn">+ إضافة صنف جديد</button>'}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>الباركود</th><th>الاسم</th><th>التصنيف</th><th>الوحدة</th>
            ${Auth.isSeller() ? '' : '<th>سعر التكلفة</th>'}
            <th>سعر البيع</th><th>الرصيد</th><th>الحالة</th><th></th>
          </tr></thead>
          <tbody id="itemsBody"></tbody>
        </table>
      </div>
    `;

    const tbody = container.querySelector('#itemsBody');

    function draw(list) {
      if (!list.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="${Auth.isSeller() ? 8 : 9}">مفيش أصناف مسجلة لسه</td></tr>`;
        return;
      }
      tbody.innerHTML = list.map(rowHtml).join('');
    }
    draw(AppState.items);

    container.querySelector('#itemSearch').addEventListener('input', Utils.debounce((e) => {
      const q = e.target.value.trim().toLowerCase();
      const list = !q ? AppState.items : AppState.items.filter(i =>
        (i.name || '').toLowerCase().includes(q) || (i.barcode || '').toLowerCase().includes(q)
      );
      draw(list);
    }, 150));

    const addBtn = container.querySelector('#addItemBtn');
    if (addBtn) addBtn.addEventListener('click', () => openItemForm());

    tbody.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const id = Number(tr.dataset.id);
      const item = AppState.items.find(i => i.id === id);
      if (e.target.classList.contains('edit-item')) {
        openItemForm(item);
      } else if (e.target.classList.contains('del-item')) {
        const ok = await Utils.confirmDialog(`متأكد من حذف الصنف "${item.name}"؟`);
        if (!ok) return;
        await DB.delete('items', id);
        await AppState.reloadItems();
        draw(AppState.items);
        Utils.toast('تم حذف الصنف', 'success');
      }
    });
  }

  function formHtml(item) {
    return `
      <div class="field">
        <label>الباركود</label>
        <div class="search-row">
          <input type="text" id="fBarcode" value="${Utils.escapeHtml(item?.barcode || '')}" placeholder="صوّر الباركود أو اكتبه" style="flex:1;">
          ${Scanner.buttonHtml('fScanBtn')}
        </div>
        <button type="button" id="genBarcodeBtn" class="btn btn-ghost btn-sm" style="margin-top:8px;">الصنف مالوش باركود — ولّد رقم</button>
      </div>
      <div class="field">
        <label>اسم الصنف</label>
        <input type="text" id="fName" value="${Utils.escapeHtml(item?.name || '')}" required autofocus>
      </div>
      <div class="field-row">
        <div class="field">
          <label>التصنيف</label>
          <input type="text" id="fCategory" value="${Utils.escapeHtml(item?.category || '')}" placeholder="كهرباء / حدايد / مفاتيح..." list="catList">
          <datalist id="catList">
            <option value="كهرباء"><option value="حدايد"><option value="مفاتيح"><option value="أدوات"><option value="سباكة">
          </datalist>
        </div>
        <div class="field">
          <label>الوحدة (بيتباع بإيه؟)</label>
          <select id="fUnit">${Units.optionsHtml(item?.unit || 'قطعة')}</select>
          <div class="hint" id="unitHint"></div>
        </div>
      </div>
      <div class="field">
        <label>الكرتونة/الشيكارة فيها كام؟ (اختياري)</label>
        <input type="number" id="fPackSize" min="0" step="0.01" value="${item?.packSize ?? ''}" placeholder="مثال: 50 — سيبها فاضية لو مش بتشتري بالكرتونة">
        <div class="hint">لو كتبتها، وقت الشراء هيحسبلك تكلفة الوحدة لوحده</div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>سعر التكلفة (شراء)</label>
          <input type="number" id="fCost" min="0" step="0.01" value="${item?.costPrice ?? ''}">
        </div>
        <div class="field">
          <label>سعر البيع</label>
          <input type="number" id="fPrice" min="0" step="0.01" value="${item?.salePrice ?? ''}" required>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>${item ? 'الرصيد الحالي' : 'رصيد أول المدة'}</label>
          <input type="number" id="fStock" step="0.01" value="${item?.stock ?? 0}" ${item ? 'disabled' : ''}>
          ${item ? '<div class="hint">لتعديل الرصيد استخدم "تسوية جرد" من شاشة المخزون</div>' : ''}
        </div>
        <div class="field">
          <label>حد التنبيه الأدنى</label>
          <input type="number" id="fMinStock" min="0" step="0.01" value="${item?.minStock ?? 0}">
        </div>
      </div>
    `;
  }

  // opens the item form; resolves with the saved item (used by sales/purchases quick-add)
  // prefill: string (treated as barcode) or {barcode, name}
  function openItemForm(item, prefill) {
    const pre = typeof prefill === 'string' ? { barcode: prefill } : (prefill || {});
    return new Promise((resolve) => {
      const { close } = Utils.openModal({
        title: item ? 'تعديل صنف' : 'إضافة صنف جديد',
        bodyHtml: `
          <form id="itemForm">
            ${formHtml(item)}
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" id="cancelItem">إلغاء</button>
              <button type="submit" class="btn btn-amber">${item ? 'حفظ التعديل' : 'إضافة الصنف'}</button>
            </div>
          </form>`,
        onMount: (body) => {
          if (pre.barcode) body.querySelector('#fBarcode').value = pre.barcode;
          if (pre.name) body.querySelector('#fName').value = pre.name;
          body.querySelector('#cancelItem').addEventListener('click', () => { close(); resolve(null); });
          body.querySelector('#genBarcodeBtn').addEventListener('click', () => {
            body.querySelector('#fBarcode').value = Utils.genInternalBarcode();
          });
          body.querySelector('#fScanBtn').addEventListener('click', async () => {
            const code = await Scanner.scan();
            if (code) body.querySelector('#fBarcode').value = code;
          });

          // نوضّح للمستخدم إن الوحدة دي بتقبل كسور ولا لأ
          const unitSel = body.querySelector('#fUnit');
          const unitHint = body.querySelector('#unitHint');
          const stockInput = body.querySelector('#fStock');
          function syncUnit() {
            const u = unitSel.value;
            const dec = Units.allowsDecimals(u);
            unitHint.textContent = dec ? `بيتباع بالكسور (زي ٢.٥ ${u})` : `بيتباع بالعدد الصحيح`;
            if (stockInput) stockInput.step = Units.step(u);
          }
          unitSel.addEventListener('change', syncUnit);
          syncUnit();
          body.querySelector('#itemForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = body.querySelector('#fName').value.trim();
            if (!name) { Utils.toast('اسم الصنف مطلوب', 'error'); return; }
            let barcode = body.querySelector('#fBarcode').value.trim();
            if (!barcode) barcode = Utils.genInternalBarcode();

            const existing = AppState.items.find(i => i.barcode === barcode && i.id !== item?.id);
            if (existing) { Utils.toast('في صنف تاني بنفس الباركود: ' + existing.name, 'error'); return; }

            const packSize = Number(body.querySelector('#fPackSize').value || 0);
            const payload = {
              barcode, name,
              category: body.querySelector('#fCategory').value.trim(),
              unit: body.querySelector('#fUnit').value || 'قطعة',
              packSize: packSize > 0 ? packSize : null,
              costPrice: Number(body.querySelector('#fCost').value || 0),
              salePrice: Number(body.querySelector('#fPrice').value || 0),
              minStock: Number(body.querySelector('#fMinStock').value || 0),
              active: true
            };
            if (item) {
              payload.id = item.id;
              payload.stock = item.stock;
            } else {
              payload.stock = Number(body.querySelector('#fStock').value || 0);
            }
            const newId = await DB.put('items', payload);

            // لو الصنف اتسجل برصيد أول المدة، بنسجله كحركة كمان عشان سجل
            // حركة الصنف يفضل مفسّر للكمية اللي عنده (من غير كده الرصيد بيظهر من العدم)
            if (!item && payload.stock > 0) {
              await DB.add('stockMovements', {
                itemId: newId, type: 'adjustment', qty: payload.stock,
                unitCost: payload.costPrice || 0, date: Utils.nowISO(),
                refType: 'opening', refId: null, note: 'رصيد أول المدة'
              });
            }

            await AppState.reloadItems();
            Utils.toast(item ? 'تم حفظ التعديل' : 'تم إضافة الصنف', 'success');
            close();
            const saved = AppState.items.find(i => i.id === (item ? item.id : newId));
            resolve(saved);
          });
        }
      });
    });
  }

  return { render, openItemForm };
})();
