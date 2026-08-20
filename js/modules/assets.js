Modules.assets = (() => {
  /* الأصول الثابتة: العدد والأجهزة والديكور والعربية.

     الحاجات دي بتقلّ قيمتها كل سنة (إهلاك). الإهلاك مصروف حقيقي
     على المحل حتى لو مفيش فلوس بتخرج — من غيره الأرباح بتبان أعلى
     من الحقيقة، وقيمة المحل في الورق بتفضل أكبر من قيمته الفعلية. */

  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  function monthLabel(key) {
    const [y, m] = String(key).split('-').map(Number);
    return (MONTHS[m - 1] || key) + ' ' + y;
  }

  function lastMonthKey() {
    const n = new Date();
    const d = new Date(n.getFullYear(), n.getMonth() - 1, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  async function render(container) {
    const all = await DB.getAll('fixedAssets');
    all.sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));
    const acc = await Services.accumulatedDepreciation();
    const posted = (await DB.getAll('expenses'))
      .filter(e => e.source === 'depreciation')
      .sort((a, b) => (b.monthKey || '').localeCompare(a.monthKey || ''));

    const totalCost = all.reduce((s, a) => s + Number(a.cost || 0), 0);
    const totalAcc = all.reduce((s, a) => s + Number(acc[a.id] || 0), 0);
    const netValue = Math.round((totalCost - totalAcc) * 100) / 100;
    const monthlyTotal = all.reduce((s, a) => {
      const remaining = Number(a.cost || 0) - Number(acc[a.id] || 0);
      return s + (remaining > 0.005 ? Services.monthlyDepreciation(a) : 0);
    }, 0);

    const lm = lastMonthKey();
    const lmDone = posted.some(e => e.monthKey === lm);
    const plan = await Services.depreciationPlan(lm);

    container.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:18px;">
        <div class="stat-tile"><div class="lbl">التكلفة الأصلية</div><div class="val">${Utils.formatMoney(totalCost)}</div></div>
        <div class="stat-tile negative"><div class="lbl">مجمّع الإهلاك</div><div class="val">${Utils.formatMoney(totalAcc)}</div></div>
        <div class="stat-tile"><div class="lbl">القيمة الحالية (الدفترية)</div><div class="val">${Utils.formatMoney(netValue)}</div>
          <div class="sub">الإهلاك الشهري: ${Utils.formatMoney(monthlyTotal)}</div></div>
      </div>

      ${!lmDone && plan.total > 0 ? `
        <div class="notice notice-warn" style="margin-bottom:18px;">
          <strong>لسه ما سجّلتش إهلاك ${monthLabel(lm)}</strong> —
          قيمته <strong>${Utils.formatMoney(plan.total)}</strong>.
          <div class="hint" style="margin-top:4px;">
            هيتسجّل مصروف باسم "إهلاك أصول" من غير ما تخرج فلوس من الخزنة،
            عشان الأرباح تطلع صح.
          </div>
          <button class="btn btn-amber btn-sm" id="depBtn" style="margin-top:10px;">سجّل إهلاك ${monthLabel(lm)}</button>
        </div>` : ''}

      <div class="section-head">
        <h3>الأصول الثابتة</h3>
        <button class="btn btn-amber" id="addAssetBtn">+ إضافة أصل ثابت</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>الاسم</th><th>تاريخ الشراء</th><th>التكلفة</th>
            <th>العمر</th><th>إهلاك الشهر</th><th>اتهلك</th><th>القيمة الحالية</th><th></th>
          </tr></thead>
          <tbody id="assetBody">
            ${all.length ? all.map(a => {
              const done = Number(acc[a.id] || 0);
              const net = Math.round((Number(a.cost || 0) - done) * 100) / 100;
              const full = net <= 0.005;
              return `
              <tr data-id="${a.id}">
                <td style="font-weight:700;">${Utils.escapeHtml(a.name)}
                  ${a.notes ? `<div class="unit-cost-sub">${Utils.escapeHtml(a.notes)}</div>` : ''}</td>
                <td>${Utils.formatDate(a.purchaseDate)}</td>
                <td>${Utils.formatMoney(a.cost)}</td>
                <td>${Number(a.usefulLife || Services.DEFAULT_LIFE_YEARS)} سنة</td>
                <td>${full ? '<span class="muted">—</span>' : Utils.formatMoney(Services.monthlyDepreciation(a))}</td>
                <td style="color:var(--danger);">${Utils.formatMoney(done)}</td>
                <td class="strong">${Utils.formatMoney(net)}
                  ${full ? '<div class="unit-cost-sub">اتهلك بالكامل</div>' : ''}</td>
                <td>
                  <button class="icon-btn edit-asset" title="تعديل">✏️</button>
                  <button class="icon-btn del-asset" title="حذف">🗑️</button>
                </td>
              </tr>`; }).join('')
              : `<tr class="empty-row"><td colspan="8">مفيش أصول ثابتة مسجلة لسه (زي: عدد، ديكور، ماكينات، أجهزة، عربية)</td></tr>`}
          </tbody>
        </table>
      </div>

      ${posted.length ? `
      <div class="card" style="margin-top:18px;">
        <div class="section-head"><h3>الإهلاك المسجّل</h3></div>
        <div class="table-wrap" style="border:none;">
          <table>
            <thead><tr><th>الشهر</th><th>القيمة</th><th>التفاصيل</th><th></th></tr></thead>
            <tbody id="depBody">
              ${posted.map(e => `
                <tr data-exp="${e.id}">
                  <td class="strong">${monthLabel(e.monthKey)}</td>
                  <td style="color:var(--danger);font-weight:700;">${Utils.formatMoney(e.amount)}</td>
                  <td class="muted" style="font-size:12px;">
                    ${(e.lines || []).map(l => Utils.escapeHtml(l.name) + ' ' + Utils.formatMoney(l.amount)).join('، ') || '—'}
                  </td>
                  <td><button class="icon-btn undo-dep" title="امسح قيد الإهلاك">🗑️</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}
    `;

    const again = () => render(container);

    container.querySelector('#addAssetBtn').addEventListener('click', () => openAssetForm(null, again));

    const depBtn = container.querySelector('#depBtn');
    if (depBtn) depBtn.addEventListener('click', async () => {
      const ok = await Utils.confirmDialog(
        `تسجيل إهلاك ${monthLabel(lm)} بقيمة ${Utils.formatMoney(plan.total)}؟\n\n` +
        plan.lines.map(l => `• ${l.name}: ${Utils.formatMoney(l.amount)}`).join('\n') +
        '\n\nمفيش فلوس هتخرج من الخزنة — ده مجرد نقص في قيمة العدد والأجهزة.');
      if (!ok) return;
      try {
        await Services.postDepreciation(lm);
        Utils.toast('اتسجل إهلاك ' + monthLabel(lm), 'success');
        again();
      } catch (e) { Utils.toast(e.message || 'مانجحش', 'error'); }
    });

    container.querySelector('#assetBody').addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      if (!tr || !tr.dataset.id) return;
      const id = Number(tr.dataset.id);
      const asset = all.find(a => a.id === id);
      if (e.target.classList.contains('edit-asset')) {
        openAssetForm(asset, again);
      } else if (e.target.classList.contains('del-asset')) {
        if (Number(acc[id] || 0) > 0) {
          Utils.toast('الأصل ده اتسجّل عليه إهلاك — امسح قيود الإهلاك الأول', 'error');
          return;
        }
        if (!(await Utils.confirmDialog('حذف هذا الأصل الثابت؟'))) return;
        await DB.delete('fixedAssets', id);
        Utils.toast('تم الحذف', 'success');
        again();
      }
    });

    const depBody = container.querySelector('#depBody');
    if (depBody) depBody.addEventListener('click', async (e) => {
      if (!e.target.classList.contains('undo-dep')) return;
      const id = Number(e.target.closest('tr').dataset.exp);
      if (!(await Utils.confirmDialog('امسح قيد الإهلاك ده؟ هيتشال من المصروفات كمان.'))) return;
      try {
        await Services.voidDepreciation(id);
        Utils.toast('اتمسح', 'success');
        again();
      } catch (err) { Utils.toast(err.message || 'مانجحش', 'error'); }
    });
  }

  function openAssetForm(asset, onDone) {
    Utils.openModal({
      title: asset ? 'تعديل ' + asset.name : 'إضافة أصل ثابت',
      bodyHtml: `
        <form id="assetForm">
          <div class="field"><label>الاسم</label>
            <input type="text" id="aName" value="${Utils.escapeHtml(asset?.name || '')}" placeholder="مثلاً: دولاب عرض، ماكينة لحام، عربية" required autofocus></div>
          <div class="field-row">
            <div class="field"><label>تاريخ الشراء</label>
              <input type="date" id="aDate" value="${asset ? Utils.dateKey(asset.purchaseDate) : Utils.todayISO()}"></div>
            <div class="field"><label>التكلفة</label>
              <input type="number" id="aCost" min="0" step="0.01" value="${asset?.cost ?? ''}" required></div>
            <div class="field"><label>هيعيش كام سنة؟</label>
              <input type="number" id="aLife" min="1" max="50" step="1" value="${asset?.usefulLife ?? Services.DEFAULT_LIFE_YEARS}">
            </div>
          </div>
          <div class="hint" id="depHint" style="margin:-8px 0 14px;"></div>
          <div class="field"><label>ملاحظات</label>
            <input type="text" id="aNotes" value="${Utils.escapeHtml(asset?.notes || '')}"></div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" id="aCancel">إلغاء</button>
            <button type="submit" class="btn btn-amber">حفظ</button>
          </div>
        </form>`,
      onMount: (body, close) => {
        const costEl = body.querySelector('#aCost');
        const lifeEl = body.querySelector('#aLife');
        const hint = body.querySelector('#depHint');
        function sync() {
          const c = Number(costEl.value || 0), y = Number(lifeEl.value || 0);
          hint.textContent = (c > 0 && y > 0)
            ? `يعني بينزل من قيمته ${Utils.formatMoney(c / (y * 12))} كل شهر — وده بيتحسب مصروف`
            : 'اكتب التكلفة وعدد السنين عشان نحسب الإهلاك';
        }
        costEl.addEventListener('input', sync);
        lifeEl.addEventListener('input', sync);
        sync();

        body.querySelector('#aCancel').addEventListener('click', close);
        body.querySelector('#assetForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = body.querySelector('#aName').value.trim();
          const cost = Number(costEl.value || 0);
          if (!name || cost <= 0) { Utils.toast('البيانات ناقصة', 'error'); return; }
          const payload = {
            name, cost,
            usefulLife: Math.max(1, Number(lifeEl.value || Services.DEFAULT_LIFE_YEARS)),
            purchaseDate: body.querySelector('#aDate').value || Utils.todayISO(),
            notes: body.querySelector('#aNotes').value.trim()
          };
          if (asset) payload.id = asset.id;
          await DB.put('fixedAssets', payload);
          Utils.toast(asset ? 'اتحفظ التعديل' : 'تم إضافة الأصل', 'success');
          close();
          onDone();
        });
      }
    });
  }

  return { render };
})();
