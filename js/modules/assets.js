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
    const maint = await Services.assetMaintenance();     // صيانة وقطع غيار كل ماكينة
    const burden = await Services.assetBurdens();        // الماكينة بتكلّف الوحدة كام
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

      <div class="notice notice-info" style="margin-bottom:14px;line-height:1.9;font-size:13.5px;">
        <strong>ماكينة جت في فاتورة مورد؟</strong> في فاتورة الشرا اكتب في خانة التصنيف
        <span class="badge badge-muted">أصل ثابت</span> وهتتسجل هنا لوحدها (والمورد والخزنة بيتحاسبوا من الفاتورة عادي).
        قطع الغيار والصيانة: <span class="badge badge-muted">صيانة وقطع غيار</span> واختار الماكينة —
        أو من زرار 🔧 هنا لو دفعتها كاش.
        <div class="hint" style="margin-top:4px;">اربط الماكينة بتصنيف (مثلاً «مفاتيح») وهنقولك كل مفتاح بيتحمّل منها كام فوق سعر الخامة.</div>
      </div>

      <div class="section-head">
        <h3>الأصول الثابتة</h3>
        <button class="btn btn-amber" id="addAssetBtn">+ إضافة أصل ثابت</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>الاسم</th><th>تاريخ الشراء</th><th>التكلفة</th>
            <th>العمر</th><th>إهلاك الشهر</th><th>صيانة وقطع غيار</th><th>القيمة الحالية</th>
            <th>بتكلّف الوحدة كام؟</th><th></th>
          </tr></thead>
          <tbody id="assetBody">
            ${all.length ? all.map(a => {
              const done = Number(acc[a.id] || 0);
              const net = Math.round((Number(a.cost || 0) - done) * 100) / 100;
              const full = net <= 0.005;
              const m = Number(maint[a.id] || 0);
              const b = burden[a.id] || {};
              return `
              <tr data-id="${a.id}">
                <td style="font-weight:700;">${Utils.escapeHtml(a.name)}
                  ${a.notes ? `<div class="unit-cost-sub">${Utils.escapeHtml(a.notes)}</div>` : ''}</td>
                <td>${Utils.formatDate(a.purchaseDate)}</td>
                <td>${Utils.formatMoney(a.cost)}</td>
                <td>${Number(a.usefulLife || Services.DEFAULT_LIFE_YEARS)} سنة</td>
                <td>${full ? '<span class="muted">—</span>' : Utils.formatMoney(Services.monthlyDepreciation(a))}</td>
                <td>${m > 0
                      ? `<button type="button" class="link-btn maint-hist" title="شوف تفاصيل الصيانة">${Utils.formatMoney(m)}</button>
                         <div class="unit-cost-sub">≈ ${Utils.formatMoney(b.monthlyMaint || 0)} في الشهر</div>`
                      : '<span class="muted">—</span>'}</td>
                <td class="strong">${Utils.formatMoney(net)}
                  ${full ? '<div class="unit-cost-sub">اتهلك بالكامل — ولسه بيتحسب في تكلفة الوحدة</div>' : ''}</td>
                <td>${burdenCell(a, b)}</td>
                <td style="white-space:nowrap;">
                  <button class="icon-btn maint-asset" title="سجّل صيانة / قطع غيار دفعتها كاش">🔧</button>
                  <button class="icon-btn edit-asset" title="تعديل">✏️</button>
                  <button class="icon-btn del-asset" title="حذف">🗑️</button>
                </td>
              </tr>`; }).join('')
              : `<tr class="empty-row"><td colspan="9">مفيش أصول ثابتة مسجلة لسه (زي: عدد، ديكور، ماكينات، أجهزة، عربية)</td></tr>`}
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
      } else if (e.target.classList.contains('maint-asset')) {
        openMaintForm(asset, again);
      } else if (e.target.classList.contains('maint-hist')) {
        openMaintHistory(asset);
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

  /* خانة "بتكلّف الوحدة كام": الماكينة مربوطة بتصنيف؟ نقول كل وحدة
     من التصنيف ده بتتحمّل كام (إهلاك + صيانة في الشهر ÷ اللي بيتباع في الشهر) */
  function burdenCell(a, b) {
    if (!b.cat) return `<span class="muted" title="اضغط ✏️ واختار «بتخدم إيه»">اربطها بتصنيف</span>`;
    if (b.perUnit == null) {
      return `<span class="muted">${Utils.escapeHtml(b.cat)}: لسه مفيش بيع في آخر ${b.windowDays} يوم</span>`;
    }
    return `
      <div class="strong" style="color:#2F4A6B;">${Utils.formatMoney(b.perUnit)} لكل ${Utils.escapeHtml(b.unit)} ${Utils.escapeHtml(b.cat)}</div>
      <div class="unit-cost-sub" title="إهلاك ${Utils.formatMoney(b.monthlyDep)} + صيانة ${Utils.formatMoney(b.monthlyMaint)} في الشهر ÷ ${b.unitsPerMonth} ${Utils.escapeHtml(b.unit)} في الشهر">
        (${Utils.formatMoney(b.monthlyDep + b.monthlyMaint)} في الشهر ÷ ${b.unitsPerMonth} ${Utils.escapeHtml(b.unit)}) — حطّها فوق سعر الخامة
      </div>`;
  }

  // صيانة أو قطع غيار اتدفعت كاش دلوقتي (اللي جاية في فاتورة مورد بتتسجل من فاتورة الشرا)
  function openMaintForm(asset, onDone) {
    Utils.openModal({
      title: '🔧 صيانة / قطع غيار: ' + asset.name,
      bodyHtml: `
        <form id="maintForm" novalidate>
          <div class="field-row">
            <div class="field"><label>المبلغ</label>
              <input type="number" id="mAmount" min="0" step="0.01" inputmode="decimal" placeholder="0.00" autofocus></div>
            <div class="field"><label>التاريخ</label>
              <input type="date" id="mDate" value="${Utils.todayISO()}"></div>
          </div>
          <div class="field"><label>إيه اللي اتعمل؟</label>
            <input type="text" id="mNote" placeholder="مثلاً: سلاح جديد، زيت، فني صيانة"></div>
          <div class="hint" style="margin:-6px 0 14px;">الفلوس هتخرج من الخزنة كمصروف باسم «صيانة وقطع غيار» وهتتحسب على الماكينة دي.</div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" id="mCancel">إلغاء</button>
            <button type="submit" class="btn btn-amber">سجّل</button>
          </div>
        </form>`,
      onMount: (body, close) => {
        body.querySelector('#mCancel').addEventListener('click', close);
        Utils.guardSubmit(body.querySelector('#maintForm'), async (e) => {
          e.preventDefault();
          const amount = Number(body.querySelector('#mAmount').value || 0);
          if (!(amount > 0)) { Utils.toast('اكتب المبلغ', 'error'); return; }
          const day = body.querySelector('#mDate').value || Utils.todayISO();
          const note = body.querySelector('#mNote').value.trim();
          await Services.saveExpense({
            category: Services.MAINT_CATEGORY, amount, assetId: asset.id,
            description: (note ? note + ' — ' : '') + asset.name,
            date: day === Utils.todayISO() ? Utils.nowISO() : new Date(day + 'T12:00:00').toISOString()
          });
          Utils.toast('اتسجلت الصيانة على ' + asset.name, 'success');
          close();
          onDone();
        });
      }
    });
  }

  async function openMaintHistory(asset) {
    const list = (await DB.getAll('expenses'))
      .filter(e => Number(e.assetId) === Number(asset.id) && e.source !== 'depreciation')
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    const total = list.reduce((s, e) => s + Number(e.amount || 0), 0);
    Utils.openModal({
      title: 'صيانة وقطع غيار: ' + asset.name,
      wide: true,
      bodyHtml: `
        <p class="muted" style="font-size:13px;margin-bottom:10px;">الإجمالي: <strong>${Utils.formatMoney(total)}</strong> في ${list.length} مرة</p>
        <div class="table-wrap" style="border:none;">
          <table>
            <thead><tr><th>التاريخ</th><th>إيه اللي اتعمل</th><th>المبلغ</th><th>اتدفعت إزاي</th></tr></thead>
            <tbody>
              ${list.length ? list.map(e => `
                <tr>
                  <td>${Utils.formatDate(e.date)}</td>
                  <td>${Utils.escapeHtml(e.description || e.category || '')}</td>
                  <td style="font-weight:700;color:var(--danger);">${Utils.formatMoney(e.amount)}</td>
                  <td class="muted" style="font-size:12px;">${e.source === 'purchase' ? 'في فاتورة مورد' : 'كاش من الخزنة'}</td>
                </tr>`).join('') : `<tr class="empty-row"><td colspan="4">مفيش صيانة مسجلة</td></tr>`}
            </tbody>
          </table>
        </div>`
    });
  }

  function openAssetForm(asset, onDone) {
    const cats = AppState.categorySuggestions();
    const cur = String(asset?.servesCategory || '').trim();
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
          <div class="field"><label>بتخدم إيه؟ (عشان نحسب كل وحدة بتتحمّل منها كام)</label>
            <select id="aServes">
              <option value="">— مش مرتبطة ببضاعة (ديكور، عربية، دولاب…) —</option>
              ${cats.concat(cur && !cats.includes(cur) ? [cur] : []).map(c =>
                `<option value="${Utils.escapeHtml(c)}" ${c === cur ? 'selected' : ''}>${Utils.escapeHtml(c)}</option>`).join('')}
            </select>
            <div class="hint">مثلاً ماكينة المفاتيح بتخدم «مفاتيح» — إهلاكها وصيانتها بيتقسموا على المفاتيح اللي بتتباع.</div>
          </div>
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
        Utils.guardSubmit(body.querySelector('#assetForm'), async (e) => {
          e.preventDefault();
          const name = body.querySelector('#aName').value.trim();
          const cost = Number(costEl.value || 0);
          if (!name || cost <= 0) { Utils.toast('البيانات ناقصة', 'error'); return; }
          const payload = Object.assign({}, asset || {}, {
            name, cost,
            usefulLife: Math.max(1, Number(lifeEl.value || Services.DEFAULT_LIFE_YEARS)),
            purchaseDate: body.querySelector('#aDate').value || Utils.todayISO(),
            servesCategory: body.querySelector('#aServes').value || '',
            notes: body.querySelector('#aNotes').value.trim()
          });
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
