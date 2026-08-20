Modules.finance = (() => {
  /* المركز المالي — الصورة الكاملة للمحل في لحظة واحدة.

     المعادلة: الأصول = الالتزامات + حقوق الملكية.
     يعني كل اللي تحت إيدك (فلوس + بضاعة + فلوس عند الناس + عدد وأجهزة)
     = اللي عليك (للموردين وللموظفين) + اللي يخصك انت فعلاً.

     وتحتها النسب اللي بتقول المحل ماشي كويس ولا لأ. */

  let ratioPeriod = 'month';

  function rangeFor(p) {
    const now = new Date();
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    let start = new Date(now); start.setHours(0, 0, 0, 0);
    if (p === 'month') start.setDate(1);
    if (p === 'quarter') start.setMonth(start.getMonth() - 2, 1);
    if (p === 'year') start = new Date(now.getFullYear(), 0, 1);
    if (p === 'all') start = new Date(2000, 0, 1);
    return { start, end };
  }

  const PERIOD_LABEL = { month: 'الشهر الحالي', quarter: 'آخر ٣ شهور', year: 'السنة', all: 'من البداية' };

  function pct(n) { return (Math.round(n * 10) / 10).toFixed(1) + '%'; }

  // تقييم النسبة: كويسة / متوسطة / وحشة
  function judge(value, good, ok) {
    if (value >= good) return 'ok';
    if (value >= ok) return 'warn';
    return 'danger';
  }

  function ratioCard(title, value, verdict, explain) {
    const cls = verdict === 'ok' ? 'badge-ok' : (verdict === 'warn' ? 'badge-warn' : 'badge-danger');
    return `
      <div class="ratio-card">
        <div class="ratio-head">
          <span class="ratio-title">${title}</span>
          <span class="badge ${cls}">${value}</span>
        </div>
        <div class="ratio-explain">${explain}</div>
      </div>`;
  }

  async function render(container) {
    const [pos, aging, sales, expenses, returns, items, movements] = await Promise.all([
      Services.financialPosition(), Services.receivableAging(),
      DB.getAll('sales'), DB.getAll('expenses'), DB.getAll('returns'),
      DB.getAll('items'), DB.getAll('stockMovements')
    ]);

    const { start, end } = rangeFor(ratioPeriod);
    const inRange = (d) => { const x = new Date(d); return x >= start && x <= end; };

    const periodSales = sales.filter(s => !s.voided && inRange(s.date));
    const periodExp = expenses.filter(e => inRange(e.date));

    // الإيراد والتكلفة بنفس منطق شاشة الرئيسية بالظبط
    let returnedValue = 0, returnedCost = 0, damagedLoss = 0;
    for (const r of returns.filter(r => r.kind === 'customer' && !r.voided && inRange(r.date))) {
      for (const l of (r.lines || [])) {
        if (l.mode === 'swap') continue;
        const qty = Number(l.qty || 0);
        const it = items.find(i => i.id === l.itemId);
        const unitCost = Number((it && it.costPrice) || 0);
        returnedValue += qty * Number(l.price || 0);
        if (l.condition === 'damaged') damagedLoss += qty * unitCost;
        else returnedCost += qty * unitCost;
      }
    }

    // عجز الجرد بيتحسب تكلفة زي شاشة الرئيسية بالظبط
    let shrinkage = 0;
    for (const m of movements) {
      if (m.refType !== 'adjustment' || !inRange(m.date)) continue;
      shrinkage += -Number(m.qty || 0) * Number(m.unitCost || 0);
    }
    shrinkage = Math.round(shrinkage * 100) / 100;

    const revenue = Math.round((periodSales.reduce((s, x) => s + Number(x.total || 0), 0) - returnedValue) * 100) / 100;
    const cogs = Math.round((periodSales.reduce((s, x) =>
      s + (x.lines || []).reduce((ls, l) => ls + Number(l.qty || 0) * Number(l.cost || 0), 0), 0)
      - returnedCost + shrinkage) * 100) / 100;
    const grossProfit = Math.round((revenue - cogs) * 100) / 100;
    const totalExpenses = Math.round(periodExp.reduce((s, e) => s + Number(e.amount || 0), 0) * 100) / 100;
    const netProfit = Math.round((grossProfit - totalExpenses) * 100) / 100;

    const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
    const expRatio = revenue > 0 ? (totalExpenses / revenue) * 100 : 0;
    const avgInvoice = periodSales.length ? revenue / periodSales.length : 0;
    // معدل دوران المخزون: البضاعة بتلف كام مرة في الفترة
    const turnover = pos.inventory > 0 ? cogs / pos.inventory : 0;
    // نسبة السيولة: الأصول المتداولة ÷ الالتزامات
    const liquid = pos.totalLiabilities > 0
      ? (pos.cash + pos.inventory + pos.receivable) / pos.totalLiabilities : 0;

    const balanced = Math.abs(pos.totalAssets - (pos.totalLiabilities + pos.equity)) < 0.05;

    container.innerHTML = `
      <div class="section-head"><h3>المركز المالي — المحل ده فيه كام؟</h3></div>

      <div class="grid grid-2" style="margin-bottom:16px;">
        <div class="card">
          <div class="section-head" style="margin-bottom:10px;"><h3 style="font-size:15px;">اللي تحت إيدك (الأصول)</h3></div>
          <table class="mini-table">
            <tr><td>فلوس في الخزنة</td><td>${Utils.formatMoney(pos.cash)}</td></tr>
            <tr><td>بضاعة في المخزن (بالتكلفة)</td><td>${Utils.formatMoney(pos.inventory)}</td></tr>
            <tr><td>فلوس عند العملاء</td><td>${Utils.formatMoney(pos.receivable)}</td></tr>
            <tr><td>عدد وأجهزة (بعد الإهلاك)</td><td>${Utils.formatMoney(pos.assetsNet)}
              ${pos.accumDep > 0 ? `<div class="unit-cost-sub">أصلها ${Utils.formatMoney(pos.assetsCost)} · اتهلك ${Utils.formatMoney(pos.accumDep)}</div>` : ''}</td></tr>
            <tr class="mini-total"><td>الإجمالي</td><td>${Utils.formatMoney(pos.totalAssets)}</td></tr>
          </table>
        </div>

        <div class="card">
          <div class="section-head" style="margin-bottom:10px;"><h3 style="font-size:15px;">اللي عليك (الالتزامات)</h3></div>
          <table class="mini-table">
            <tr><td>مستحق للموردين</td><td>${Utils.formatMoney(pos.payable)}</td></tr>
            <tr><td>مستحق للموظفين</td><td>${Utils.formatMoney(pos.employeeDues)}</td></tr>
            <tr class="mini-total"><td>الإجمالي</td><td>${Utils.formatMoney(pos.totalLiabilities)}</td></tr>
          </table>

          <div class="section-head" style="margin:18px 0 10px;"><h3 style="font-size:15px;">اللي يخصك (حقوق الملكية)</h3></div>
          <table class="mini-table">
            <tr><td>رأس المال اللي حطيته</td><td>${Utils.formatMoney(pos.capital)}</td></tr>
            <tr><td>مسحوبات شخصية</td><td style="color:var(--danger);">− ${Utils.formatMoney(pos.drawings)}</td></tr>
            <tr><td>أرباح سايبها في المحل</td><td>${Utils.formatMoney(pos.retained)}</td></tr>
            <tr class="mini-total"><td>صافي حقك في المحل</td><td>${Utils.formatMoney(pos.equity)}</td></tr>
          </table>
        </div>
      </div>

      <div class="notice ${balanced ? 'notice-ok' : 'notice-warn'}" style="margin-bottom:22px;line-height:1.9;">
        ${balanced
          ? `<strong>الميزانية متوازنة ✓</strong><br>
             الأصول ${Utils.formatMoney(pos.totalAssets)} = الالتزامات ${Utils.formatMoney(pos.totalLiabilities)}
             + حقك ${Utils.formatMoney(pos.equity)}`
          : `<strong>⚠️ فيه فرق في الميزانية</strong> — كلّمني عشان أراجعها`}
        ${pos.capital === 0 ? `<br><span class="muted">ملحوظة: لسه ما سجّلتش رأس مال. لما تحط فلوس من جيبك في المحل، سجّلها من الخزنة كـ "رأس مال" عشان الأرقام دي تبقى دقيقة.</span>` : ''}
      </div>

      <div class="section-head">
        <h3>النسب — المحل ماشي كويس؟</h3>
        <div class="tabs" id="ratioTabs" style="margin:0;">
          ${Object.keys(PERIOD_LABEL).map(k =>
            `<button data-p="${k}" class="${ratioPeriod === k ? 'active' : ''}">${PERIOD_LABEL[k]}</button>`).join('')}
        </div>
      </div>

      ${revenue > 0 ? `
      <div class="ratio-grid">
        ${ratioCard('هامش الربح الإجمالي', pct(grossMargin), judge(grossMargin, 25, 15),
          `كل ١٠٠ جنيه مبيعات بتكسّب منها <strong>${Utils.formatMoney(grossMargin)}</strong> قبل المصاريف.
           في محلات الأدوات الكهربائية الطبيعي بين ٢٠٪ و٣٥٪.`)}
        ${ratioCard('هامش الربح الصافي', pct(netMargin), judge(netMargin, 10, 5),
          `بعد كل المصاريف بيفضل معاك <strong>${Utils.formatMoney(netMargin)}</strong> من كل ١٠٠ جنيه.
           تحت ٥٪ يبقى المصاريف واكلة الربح.`)}
        ${ratioCard('المصاريف من المبيعات', pct(expRatio), judge(100 - expRatio, 85, 75),
          `المصاريف بتاكل <strong>${pct(expRatio)}</strong> من مبيعاتك.
           كل ما تقل كل ما كان أحسن.`)}
        ${ratioCard('دوران المخزون', (Math.round(turnover * 100) / 100) + ' مرة',
          judge(turnover, 1, 0.4),
          `البضاعة اللي في المخزن بتتباع وتتجدد <strong>${Math.round(turnover * 100) / 100}</strong> مرة في الفترة دي.
           الرقم القليل معناه فلوسك نايمة في بضاعة راكدة.`)}
        ${ratioCard('نسبة السيولة', (Math.round(liquid * 100) / 100),
          pos.totalLiabilities === 0 ? 'ok' : judge(liquid, 2, 1.2),
          pos.totalLiabilities === 0
            ? 'مفيش عليك أي التزامات — وضعك مريح.'
            : `عندك <strong>${Math.round(liquid * 100) / 100}</strong> جنيه أصول متداولة مقابل كل جنيه عليك.
               أقل من ١ يبقى فيه ضغط.`)}
        ${ratioCard('متوسط الفاتورة', Utils.formatMoney(avgInvoice), 'ok',
          `${periodSales.length} فاتورة في الفترة دي، متوسط الواحدة <strong>${Utils.formatMoney(avgInvoice)}</strong>.`)}
      </div>

      <div class="card" style="margin-top:16px;">
        <div class="section-head"><h3>الأرباح والخساير — ${PERIOD_LABEL[ratioPeriod]}</h3></div>
        <table class="mini-table">
          <tr><td>المبيعات (بعد المرتجعات)</td><td>${Utils.formatMoney(revenue)}</td></tr>
          <tr><td>− تكلفة البضاعة المباعة</td><td style="color:var(--danger);">${Utils.formatMoney(cogs)}</td></tr>
          <tr class="mini-total"><td>مجمل الربح</td><td>${Utils.formatMoney(grossProfit)}</td></tr>
          <tr><td>− المصروفات</td><td style="color:var(--danger);">${Utils.formatMoney(totalExpenses)}</td></tr>
          ${damagedLoss > 0 ? `<tr><td class="muted">منها خسارة بضاعة تالفة (محسوبة في التكلفة)</td><td class="muted">${Utils.formatMoney(damagedLoss)}</td></tr>` : ''}
          ${Math.abs(shrinkage) > 0.005 ? `<tr><td class="muted">${shrinkage > 0 ? 'منها عجز جرد' : 'بعد زيادة جرد'}</td><td class="muted">${Utils.formatMoney(Math.abs(shrinkage))}</td></tr>` : ''}
          <tr class="mini-total ${netProfit >= 0 ? '' : 'bad'}">
            <td>${netProfit >= 0 ? 'صافي الربح' : 'صافي الخسارة'}</td>
            <td>${Utils.formatMoney(Math.abs(netProfit))}</td></tr>
        </table>
      </div>
      ` : `<div class="empty-state" style="padding:30px;">مفيش مبيعات في الفترة دي عشان نحسب النسب</div>`}

      ${aging.rows.length ? `
      <div class="card" style="margin-top:16px;">
        <div class="section-head">
          <h3>أعمار الديون — مين مأخر عليك</h3>
          <span class="muted" style="font-size:12px;">${Utils.formatMoney(pos.receivable)} إجمالي</span>
        </div>
        <div class="grid grid-4" style="margin-bottom:14px;">
          <div class="stat-tile"><div class="lbl">أقل من شهر</div><div class="val">${Utils.formatMoney(aging.totals.d0_30)}</div></div>
          <div class="stat-tile"><div class="lbl">شهر لشهرين</div><div class="val">${Utils.formatMoney(aging.totals.d31_60)}</div></div>
          <div class="stat-tile negative"><div class="lbl">شهرين لتلاتة</div><div class="val">${Utils.formatMoney(aging.totals.d61_90)}</div></div>
          <div class="stat-tile negative"><div class="lbl">أكتر من ٣ شهور</div><div class="val">${Utils.formatMoney(aging.totals.over90)}</div></div>
        </div>
        <div class="table-wrap" style="border:none;max-height:320px;overflow-y:auto;">
          <table>
            <thead><tr><th>العميل</th><th>التليفون</th><th>المبلغ</th><th>من إمتى</th></tr></thead>
            <tbody>
              ${aging.rows.map(r => `
                <tr>
                  <td style="font-weight:700;">${Utils.escapeHtml(r.name)}</td>
                  <td>${Utils.escapeHtml(r.phone || '—')}</td>
                  <td class="strong">${Utils.formatMoney(r.balance)}</td>
                  <td><span class="badge ${r.bucket === 'over90' ? 'badge-danger' : (r.bucket === 'd61_90' ? 'badge-warn' : 'badge-muted')}">
                    ${r.days > 0 ? r.days + ' يوم' : 'النهاردة'}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}
    `;

    container.querySelector('#ratioTabs').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      ratioPeriod = b.dataset.p;
      render(container);
    });
  }

  return { render };
})();
