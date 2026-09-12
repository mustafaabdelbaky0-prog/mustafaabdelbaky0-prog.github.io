/* مقارنة أسعار الموردين

   السؤال اللي الشاشة دي بترد عليه: "الصنف ده بشتريه من مين أرخص؟"

   البرنامج عنده الإجابة أصلاً — كل فاتورة شراء فيها اسم المورد
   وسعر الوحدة. إحنا بس بنقلبها جدول: كل صنف في سطر، وتحته
   الموردين اللي جبته منهم، الأرخص بالأخضر والأغلى بالأحمر.

   بناخد آخر سعر من كل مورد (مش المتوسط) — لأن الأسعار بتتغيّر
   والمهم هو السعر اللي هيبيعهولك النهاردة. وبنقول له السعر ده من
   إمتى، عشان يعرف لو بقى قديم. */

Modules.pricecompare = (() => {

  let q = '';
  let onlyMulti = true;    // نوري الأصناف اللي من أكتر من مورد بس

  const money = (n) => Utils.formatMoney(n);

  /* بيبني: لكل صنف ← لكل مورد ← آخر سعر وحدة وتاريخه وعدد المرات */
  function build(purchases, supMap) {
    const byItem = new Map();

    for (const p of purchases) {
      if (p.voided) continue;
      const supId = Number(p.supplierId || 0);
      // فاتورة من غير مورد (كاش) مالهاش لازمة في المقارنة
      if (!supId || !supMap.has(supId)) continue;
      const when = new Date(p.date).getTime();

      for (const l of (p.lines || [])) {
        const id = Number(l.itemId || 0);
        const cost = Number(l.cost || 0);
        if (!id || !(cost > 0)) continue;      // السطر اللي سعره لسه ناقص مش بيدخل المقارنة

        if (!byItem.has(id)) byItem.set(id, { id, name: l.name || '', unit: l.unit || '', sups: new Map() });
        const row = byItem.get(id);
        if (l.name) row.name = l.name;
        if (l.unit) row.unit = l.unit;

        const cur = row.sups.get(supId);
        if (!cur) {
          row.sups.set(supId, { supId, cost, when, times: 1, first: cost });
        } else {
          cur.times++;
          if (when >= cur.when) { cur.when = when; cur.cost = cost; }   // آخر سعر
        }
      }
    }

    // بنحسب الأرخص والأغلى لكل صنف
    const out = [];
    for (const row of byItem.values()) {
      const sups = [...row.sups.values()].sort((a, b) => a.cost - b.cost);
      if (!sups.length) continue;
      const min = sups[0].cost, max = sups[sups.length - 1].cost;
      out.push({
        ...row, sups, min, max,
        gap: Math.round((max - min) * 100) / 100,
        gapPct: min > 0 ? Math.round(((max - min) / min) * 1000) / 10 : 0,
        count: sups.length
      });
    }
    // اللي فيه فرق أكبر الأول — ده اللي هيوفّر فيه فلوس
    out.sort((a, b) => (b.count - a.count) || (b.gap - a.gap));
    return out;
  }

  async function render(container) {
    await AppState.reloadItems();
    await AppState.reloadParties();
    const purchases = await DB.getAll('purchases');
    const supMap = new Map(AppState.suppliers.map(s => [Number(s.id), s.name]));
    const all = build(purchases, supMap);

    const multi = all.filter(r => r.count > 1);
    // كام جنيه ممكن يوفّرهم لو اشترى دايمًا من الأرخص
    const saveable = Math.round(multi.reduce((s, r) => s + r.gap, 0) * 100) / 100;

    let list = onlyMulti ? multi : all;
    if (q.trim()) list = list.filter(r => Search.matches(r.name, q));

    container.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:18px;">
        <div class="stat-tile"><div class="lbl">أصناف اشتريتها من أكتر من مورد</div>
          <div class="val">${multi.length}</div>
          <div class="sub">من ${all.length} صنف ليهم فواتير شراء</div></div>
        <div class="stat-tile ${saveable > 0 ? 'positive' : ''}"><div class="lbl">فرق السعر لو اشتريت من الأرخص</div>
          <div class="val">${money(saveable)}</div>
          <div class="sub">على وحدة واحدة من كل صنف</div></div>
        <div class="stat-tile"><div class="lbl">عدد الموردين</div>
          <div class="val">${AppState.suppliers.length}</div>
          <div class="sub">اللي ليهم فواتير</div></div>
      </div>

      <div class="card" style="padding:14px;margin-bottom:14px;">
        <div class="filter-row">
          <div class="field" style="margin:0;flex:2;min-width:200px;">
            <label>ابحث باسم الصنف</label>
            <input type="text" id="pcSearch" value="${Utils.escapeHtml(q)}" placeholder="سلك / مفتاح / كشاف..." autocomplete="off">
          </div>
          <label class="void-toggle" style="margin:0;align-self:end;padding-bottom:10px;">
            <input type="checkbox" id="pcMulti" ${onlyMulti ? 'checked' : ''}>
            <span>الأصناف اللي من أكتر من مورد بس</span>
          </label>
        </div>
      </div>

      ${list.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>الصنف</th><th>الوحدة</th><th>الموردين والأسعار</th>
            <th>الفرق</th>
          </tr></thead>
          <tbody id="pcBody">
            ${list.map(r => `
            <tr>
              <td style="font-weight:700;">${Utils.escapeHtml(r.name)}</td>
              <td>${Utils.escapeHtml(r.unit || '—')}</td>
              <td>
                <div class="price-cmp">
                  ${r.sups.map(s => {
                    const best = r.count > 1 && Math.abs(s.cost - r.min) < 0.005;
                    const worst = r.count > 1 && Math.abs(s.cost - r.max) < 0.005 && r.gap > 0.005;
                    return `
                    <div class="pc-chip ${best ? 'best' : (worst ? 'worst' : '')}">
                      <span class="pc-sup">${Utils.escapeHtml(supMap.get(s.supId) || '—')}</span>
                      <span class="pc-cost">${money(s.cost)}</span>
                      <span class="pc-when">${Utils.formatDate(new Date(s.when).toISOString())}${
                        s.times > 1 ? ` · ${s.times} مرات` : ''}</span>
                    </div>`;
                  }).join('')}
                </div>
              </td>
              <td>${r.count > 1 && r.gap > 0.005
                    ? `<div class="pc-gap">${money(r.gap)}</div>
                       <div class="unit-cost-sub">أغلى بـ ${r.gapPct}%</div>`
                    : '<span class="muted">—</span>'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : `
      <div class="empty-state" style="padding:28px;">
        <div class="ic">🧮</div>
        ${needle ? 'مفيش صنف بالاسم ده'
          : (onlyMulti
            ? 'لسه مفيش صنف اشتريته من أكتر من مورد.<br><span class="muted">أول ما تشتري نفس الصنف من مورد تاني هيظهر هنا لوحده.</span>'
            : 'لسه مفيش فواتير شراء بأسعار.')}
      </div>`}

      <div class="notice notice-ok" style="margin-top:14px;line-height:1.9;">
        الجدول بيتعمل لوحده من فواتير الشراء — مفيش حاجة تكتبها.
        بناخد <strong>آخر سعر</strong> من كل مورد، والتاريخ جنبه عشان تعرف لو بقى قديم.
        السطور اللي سعرها لسه ناقص في الفاتورة مش بتدخل المقارنة.
      </div>
    `;

    const s = container.querySelector('#pcSearch');
    s.addEventListener('input', Utils.debounce(() => {
      q = s.value;
      render(container).then(() => {
        const el = container.querySelector('#pcSearch');
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      });
    }, 200));
    container.querySelector('#pcMulti').addEventListener('change', (e) => {
      onlyMulti = e.target.checked;
      render(container);
    });
  }

  return { render, build };
})();
