Modules.assets = (() => {

  async function render(container) {
    const all = await DB.getAll('fixedAssets');
    all.sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));
    const totalValue = all.reduce((s, a) => s + a.cost, 0);

    container.innerHTML = `
      <div class="stat-tile" style="margin-bottom:18px;max-width:320px;">
        <div class="lbl">إجمالي قيمة الأصول الثابتة</div>
        <div class="val">${Utils.formatMoney(totalValue)}</div>
      </div>

      <div class="section-head">
        <div></div>
        <button class="btn btn-amber" id="addAssetBtn">+ إضافة أصل ثابت</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>الاسم</th><th>تاريخ الشراء</th><th>التكلفة</th><th>ملاحظات</th><th></th></tr></thead>
          <tbody id="assetBody">
            ${all.length ? all.map(a => `
              <tr data-id="${a.id}">
                <td style="font-weight:700;">${Utils.escapeHtml(a.name)}</td>
                <td>${Utils.formatDate(a.purchaseDate)}</td>
                <td>${Utils.formatMoney(a.cost)}</td>
                <td>${Utils.escapeHtml(a.notes || '—')}</td>
                <td><button class="icon-btn del-asset" title="حذف">🗑️</button></td>
              </tr>`).join('') : `<tr class="empty-row"><td colspan="5">مفيش أصول ثابتة مسجلة لسه (زي: عدد، ديكور، ماكينات، أجهزة)</td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    container.querySelector('#addAssetBtn').addEventListener('click', () => openAssetForm(container));
    container.querySelector('#assetBody').addEventListener('click', async (e) => {
      if (!e.target.classList.contains('del-asset')) return;
      const id = Number(e.target.closest('tr').dataset.id);
      const ok = await Utils.confirmDialog('حذف هذا الأصل الثابت؟');
      if (!ok) return;
      await DB.delete('fixedAssets', id);
      Utils.toast('تم الحذف', 'success');
      render(container);
    });
  }

  function openAssetForm(container) {
    Utils.openModal({
      title: 'إضافة أصل ثابت',
      bodyHtml: `
        <form id="assetForm">
          <div class="field"><label>الاسم</label><input type="text" id="aName" placeholder="مثلاً: دولاب عرض، ماكينة لحام" required autofocus></div>
          <div class="field-row">
            <div class="field"><label>تاريخ الشراء</label><input type="date" id="aDate" value="${Utils.todayISO()}"></div>
            <div class="field"><label>التكلفة</label><input type="number" id="aCost" min="0" step="0.01" required></div>
          </div>
          <div class="field"><label>ملاحظات</label><input type="text" id="aNotes"></div>
          <div class="form-actions"><button type="submit" class="btn btn-amber">حفظ</button></div>
        </form>`,
      onMount: (body, close) => {
        body.querySelector('#assetForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = body.querySelector('#aName').value.trim();
          const cost = Number(body.querySelector('#aCost').value || 0);
          if (!name || cost <= 0) { Utils.toast('البيانات ناقصة', 'error'); return; }
          await DB.add('fixedAssets', {
            name, cost,
            purchaseDate: body.querySelector('#aDate').value || Utils.todayISO(),
            notes: body.querySelector('#aNotes').value.trim()
          });
          Utils.toast('تم إضافة الأصل', 'success');
          close();
          render(container);
        });
      }
    });
  }

  return { render };
})();
