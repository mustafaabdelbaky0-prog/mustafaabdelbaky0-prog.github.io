Modules.inventory = (() => {

  const MOVE_LABELS = {
    purchase: { txt: 'شراء', cls: 'badge-ok' },
    sale: { txt: 'بيع', cls: 'badge-danger' },
    adjustment: { txt: 'تسوية جرد', cls: 'badge-muted' },
    return_in: { txt: 'مرتجع/إلغاء بيع', cls: 'badge-warn' },
    return_out: { txt: 'إلغاء شراء', cls: 'badge-warn' }
  };

  async function render(container) {
    await AppState.reloadItems();
    const totalValue = AppState.items.reduce((s, i) => s + (i.stock * i.costPrice), 0);
    const lowStock = AppState.items.filter(i => i.minStock && i.stock <= i.minStock && i.stock > 0);
    const outOfStock = AppState.items.filter(i => i.stock <= 0);

    container.innerHTML = `
      <div class="grid ${Auth.isSeller() ? 'grid-2' : 'grid-3'}" style="margin-bottom:18px;">
        ${Auth.isSeller() ? '' : `<div class="stat-tile"><div class="lbl">قيمة المخزون الحالية (بسعر التكلفة)</div><div class="val">${Utils.formatMoney(totalValue)}</div></div>`}
        <div class="stat-tile ${lowStock.length ? 'negative' : ''}"><div class="lbl">أصناف قاربت تخلص</div><div class="val">${lowStock.length}</div></div>
        <div class="stat-tile ${outOfStock.length ? 'negative' : ''}"><div class="lbl">أصناف نفدت</div><div class="val">${outOfStock.length}</div></div>
      </div>

      <div class="section-head">
        <div class="search-box" style="max-width:340px;">
          <input type="text" id="invSearch" placeholder="ابحث بالاسم أو الباركود...">
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>الباركود</th><th>الصنف</th><th>الرصيد</th><th>تالف/ضمان</th><th>الحد الأدنى</th>
            ${Auth.isSeller() ? '' : '<th>قيمة الرصيد</th>'}<th></th></tr></thead>
          <tbody id="invBody"></tbody>
        </table>
      </div>
    `;

    const tbody = container.querySelector('#invBody');
    function draw(list) {
      if (!list.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="${Auth.isSeller() ? 6 : 7}">مفيش أصناف</td></tr>`;
        return;
      }
      tbody.innerHTML = list.map(i => `
        <tr data-id="${i.id}">
          <td>${Utils.escapeHtml(i.barcode || '—')}</td>
          <td style="font-weight:700;">${Utils.escapeHtml(i.name)}</td>
          <td>${i.stock <= 0 ? '<span class="badge badge-danger">0</span>' : Units.fmtQty(i.stock, i.unit)}</td>
          <td>${i.damagedQty > 0 ? `<span class="badge badge-warn">${Units.fmtQty(i.damagedQty, i.unit)}</span>` : '<span class="muted">—</span>'}</td>
          <td>${Units.fmtQty(i.minStock || 0, i.unit)}</td>
          ${Auth.isSeller() ? '' : `<td>${Utils.formatMoney(i.stock * i.costPrice)}</td>`}
          <td>
            ${Auth.isSeller() ? '' : '<button class="icon-btn adj-btn" title="تسوية جرد">⚖️</button>'}
            <button class="icon-btn hist-btn" title="سجل الحركة">📜</button>
          </td>
        </tr>`).join('');
    }
    draw(AppState.items);

    container.querySelector('#invSearch').addEventListener('input', Utils.debounce((e) => {
      const q = e.target.value.trim().toLowerCase();
      draw(!q ? AppState.items : AppState.items.filter(i =>
        (i.name || '').toLowerCase().includes(q) || (i.barcode || '').toLowerCase().includes(q)));
    }, 150));

    tbody.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const item = AppState.items.find(i => i.id === Number(tr.dataset.id));
      if (e.target.classList.contains('adj-btn')) openAdjustModal(item, () => render(container));
      if (e.target.classList.contains('hist-btn')) openHistoryModal(item);
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
        body.querySelector('#adjForm').addEventListener('submit', async (e) => {
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
