Modules.reports = (() => {
  let period = 'today';
  let customFrom = Utils.todayISO();
  let customTo = Utils.todayISO();

  function rangeFor(p) {
    const now = new Date();
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    let start = new Date(now); start.setHours(0, 0, 0, 0);
    if (p === 'week') start.setDate(start.getDate() - 6);
    if (p === 'month') start.setDate(1);
    if (p === 'all') start = new Date(2000, 0, 1);
    if (p === 'custom') {
      start = new Date(customFrom + 'T00:00:00');
      const e = new Date(customTo + 'T23:59:59');
      return { start, end: e };
    }
    return { start, end };
  }

  function inRange(dateStr, start, end) {
    const d = new Date(dateStr);
    return d >= start && d <= end;
  }

  async function render(container) {
    await AppState.reloadItems();
    await AppState.reloadParties();
    const [sales, purchases, expenses, returns, cashBalance] = await Promise.all([
      DB.getAll('sales'), DB.getAll('purchases'), DB.getAll('expenses'),
      DB.getAll('returns'), Services.getCashBalance()
    ]);

    container.innerHTML = `
      <div class="tabs" id="periodTabs">
        <button data-p="today" class="${period === 'today' ? 'active' : ''}">اليوم</button>
        <button data-p="week" class="${period === 'week' ? 'active' : ''}">آخر 7 أيام</button>
        <button data-p="month" class="${period === 'month' ? 'active' : ''}">الشهر الحالي</button>
        <button data-p="all" class="${period === 'all' ? 'active' : ''}">من البداية</button>
        <button data-p="custom" class="${period === 'custom' ? 'active' : ''}">فترة مخصصة</button>
      </div>
      <div id="customRange" style="display:${period === 'custom' ? 'flex' : 'none'};gap:12px;margin-bottom:16px;align-items:end;">
        <div class="field" style="margin:0;"><label>من</label><input type="date" id="fFrom" value="${customFrom}"></div>
        <div class="field" style="margin:0;"><label>إلى</label><input type="date" id="fTo" value="${customTo}"></div>
        <button class="btn btn-ghost" id="applyRange">تطبيق</button>
      </div>

      <div id="statsArea"></div>
    `;

    container.querySelector('#periodTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      period = btn.dataset.p;
      render(container);
    });
    const applyBtn = container.querySelector('#applyRange');
    if (applyBtn) applyBtn.addEventListener('click', () => {
      customFrom = container.querySelector('#fFrom').value;
      customTo = container.querySelector('#fTo').value;
      render(container);
    });

    drawStats(container, { sales, purchases, expenses, returns, cashBalance });
  }

  function drawStats(container, { sales, purchases, expenses, returns, cashBalance }) {
    const { start, end } = rangeFor(period);
    const salesInRange = sales.filter(s => !s.voided && inRange(s.date, start, end));
    const expensesInRange = expenses.filter(e => inRange(e.date, start, end));
    const purchasesInRange = purchases.filter(p => !p.voided && inRange(p.date, start, end));

    /* المرتجعات لازم تتطرح من المبيعات، وإلا الربح بيبان أعلى من الحقيقة.
       بنطرح قيمة اللي رجع (بسعر البيع) من الإيراد، وتكلفته من تكلفة
       البضاعة المباعة — لأن البضاعة رجعت للمخزن فمش محسوبة عليك. */
    const custReturns = (returns || []).filter(r => r.kind === 'customer' && inRange(r.date, start, end));
    let returnedValue = 0, returnedCost = 0;
    for (const r of custReturns) {
      for (const l of (r.lines || [])) {
        if (l.mode === 'swap') continue;            // استبدال — مفيش فلوس ولا إيراد اتغير
        const qty = Number(l.qty || 0);
        returnedValue += qty * Number(l.price || 0);
        const it = AppState.items.find(i => i.id === l.itemId);
        returnedCost += qty * Number((it && it.costPrice) || 0);
      }
    }

    const grossRevenue = salesInRange.reduce((s, sale) => s + sale.total, 0);
    const grossCogs = salesInRange.reduce((s, sale) => s + sale.lines.reduce((ls, l) => ls + l.qty * (l.cost || 0), 0), 0);
    const revenue = Math.round((grossRevenue - returnedValue) * 100) / 100;
    const cogs = Math.round((grossCogs - returnedCost) * 100) / 100;
    const grossProfit = revenue - cogs;
    const totalExpenses = expensesInRange.reduce((s, e) => s + e.amount, 0);
    const netProfit = grossProfit - totalExpenses;
    const purchasesTotal = purchasesInRange.reduce((s, p) => s + p.total, 0);

    const inventoryValue = AppState.items.reduce((s, i) => s + (i.stock * i.costPrice), 0);
    const receivable = AppState.customers.reduce((s, c) => s + (c.balance || 0), 0);
    const payable = AppState.suppliers.reduce((s, s2) => s + (s2.balance || 0), 0);

    const lowStock = AppState.items.filter(i => i.minStock && i.stock <= i.minStock);

    // الربح لكل صنف — بنجمع المبيعات ونطرح تكلفتها عشان نعرف مين اللي بيكسّب فعلاً
    const salesByItem = {};
    salesInRange.forEach(sale => sale.lines.forEach(l => {
      const sold = Math.max(0, l.qty - (l.returnedQty || 0));   // المرتجع مش بيع
      if (!salesByItem[l.itemId]) {
        salesByItem[l.itemId] = { name: l.name, unit: l.unit, qty: 0, total: 0, cost: 0 };
      }
      const e = salesByItem[l.itemId];
      e.qty += sold;
      e.total += sold * l.price;
      e.cost += sold * (l.cost || 0);
    }));
    const itemStats = Object.values(salesByItem).map(e => ({
      ...e, profit: e.total - e.cost,
      margin: e.total > 0 ? ((e.total - e.cost) / e.total) * 100 : 0
    })).filter(e => e.qty > 0);

    const topItems = itemStats.slice().sort((a, b) => b.total - a.total).slice(0, 6);
    const maxTop = topItems.length ? topItems[0].total : 1;
    const byProfit = itemStats.slice().sort((a, b) => b.profit - a.profit);

    const box = container.querySelector('#statsArea');
    box.innerHTML = `
      <div class="grid grid-4" style="margin-bottom:16px;">
        <div class="stat-tile positive"><div class="lbl">إجمالي المبيعات</div><div class="val">${Utils.formatMoney(revenue)}</div>
          <div class="sub">${salesInRange.length} فاتورة${returnedValue > 0 ? ` · بعد خصم مرتجع ${Utils.formatMoney(returnedValue)}` : ''}</div></div>
        <div class="stat-tile"><div class="lbl">تكلفة البضاعة المباعة</div><div class="val">${Utils.formatMoney(cogs)}</div></div>
        <div class="stat-tile"><div class="lbl">مجمل الربح</div><div class="val">${Utils.formatMoney(grossProfit)}</div></div>
        <div class="stat-tile negative"><div class="lbl">إجمالي المصروفات</div><div class="val">${Utils.formatMoney(totalExpenses)}</div></div>
      </div>

      <div class="grid grid-2" style="margin-bottom:16px;">
        <div class="stat-tile ${netProfit >= 0 ? 'positive' : 'negative'}" style="padding:24px;">
          <div class="lbl" style="font-size:14px;">${netProfit >= 0 ? 'صافي الربح' : 'صافي الخسارة'} في الفترة دي</div>
          <div class="val" style="font-size:34px;">${Utils.formatMoney(Math.abs(netProfit))}</div>
          <div class="sub">مبيعات (${Utils.formatMoney(revenue)}) − تكلفة البضاعة (${Utils.formatMoney(cogs)}) − مصروفات (${Utils.formatMoney(totalExpenses)})</div>
        </div>
        <div class="stat-tile" style="padding:24px;">
          <div class="lbl" style="font-size:14px;">رصيد الخزنة الحالي</div>
          <div class="val" style="font-size:34px;">${Utils.formatMoney(cashBalance)}</div>
          <div class="sub">إجمالي المشتريات في الفترة: ${Utils.formatMoney(purchasesTotal)}</div>
        </div>
      </div>

      <div class="grid grid-3" style="margin-bottom:16px;">
        <div class="stat-tile"><div class="lbl">قيمة المخزون الحالية</div><div class="val">${Utils.formatMoney(inventoryValue)}</div></div>
        <div class="stat-tile ${receivable > 0 ? 'negative' : ''}"><div class="lbl">مستحق لينا عند العملاء</div><div class="val">${Utils.formatMoney(receivable)}</div></div>
        <div class="stat-tile ${payable > 0 ? 'negative' : ''}"><div class="lbl">مستحق علينا للموردين</div><div class="val">${Utils.formatMoney(payable)}</div></div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="section-head"><h3>الأصناف الأكثر مبيعًا في الفترة</h3></div>
          ${topItems.length ? topItems.map(t => `
            <div style="margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
                <span style="font-weight:700;">${Utils.escapeHtml(t.name)}</span>
                <span class="muted">${t.qty} × — ${Utils.formatMoney(t.total)}</span>
              </div>
              <div style="background:var(--steel-light);border-radius:6px;height:8px;overflow:hidden;">
                <div style="background:var(--amber);height:100%;width:${Math.max(4, (t.total / maxTop) * 100)}%;"></div>
              </div>
            </div>`).join('') : `<div class="empty-state" style="padding:20px;">مفيش مبيعات في الفترة دي</div>`}
        </div>

        <div class="card">
          <div class="section-head"><h3>تنبيهات المخزون</h3></div>
          <!-- placeholder-stock-alerts -->
          ${lowStock.length ? `
            <div class="table-wrap" style="border:none;max-height:280px;overflow-y:auto;">
              <table>
                <tbody>
                  ${lowStock.map(i => `
                    <tr>
                      <td style="font-weight:700;">${Utils.escapeHtml(i.name)}</td>
                      <td>${i.stock <= 0 ? '<span class="badge badge-danger">نفذ</span>' : `<span class="badge badge-warn">باقي ${i.stock}</span>`}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>` : `<div class="empty-state" style="padding:20px;"><div class="ic">✅</div>مفيش نواقص حاليًا</div>`}
        </div>
      </div>

      <div class="card" style="margin-top:16px;">
        <div class="section-head">
          <h3>الربح لكل صنف — مين اللي بيكسّبك؟</h3>
          <span class="muted" style="font-size:12px;">في الفترة المختارة</span>
        </div>
        ${byProfit.length ? `
          <div class="table-wrap" style="border:none;max-height:420px;overflow-y:auto;">
            <table>
              <thead><tr>
                <th>الصنف</th><th>اتباع</th><th>المبيعات</th>
                <th>التكلفة</th><th>الربح</th><th>نسبة الربح</th>
              </tr></thead>
              <tbody>
                ${byProfit.map(e => `
                  <tr>
                    <td style="font-weight:700;">${Utils.escapeHtml(e.name)}</td>
                    <td>${Units.fmtQty(e.qty, e.unit)}</td>
                    <td>${Utils.formatMoney(e.total)}</td>
                    <td class="muted">${Utils.formatMoney(e.cost)}</td>
                    <td class="strong" style="color:${e.profit >= 0 ? 'var(--success)' : 'var(--danger)'};">
                      ${Utils.formatMoney(e.profit)}</td>
                    <td>
                      <span class="badge ${e.margin >= 20 ? 'badge-ok' : (e.margin > 0 ? 'badge-warn' : 'badge-danger')}">
                        ${Math.round(e.margin)}%
                      </span>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="hint" style="margin-top:10px;">
            نسبة الربح بتقولك كل 100 جنيه مبيعات بتكسّب منها كام. الأصناف اللي نسبتها قليلة
            يا إما سعرها محتاج مراجعة يا إما مش مستاهلة تشغّل فيها فلوسك.
          </div>
        ` : `<div class="empty-state" style="padding:26px;">مفيش مبيعات في الفترة دي</div>`}
      </div>
    `;
  }

  return { render };
})();
