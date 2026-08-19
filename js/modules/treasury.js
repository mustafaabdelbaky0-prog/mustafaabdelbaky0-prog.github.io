Modules.treasury = (() => {

  const SOURCE_LABELS = {
    sale: 'بيع', purchase: 'شراء', expense: 'مصروف',
    deposit: 'إيداع', withdrawal: 'سحب', collect: 'تحصيل من عميل', pay: 'سداد لمورد'
  };

  async function render(container) {
    const balance = await Services.getCashBalance();
    const all = await DB.getAll('treasury');
    all.sort((a, b) => new Date(b.date) - new Date(a.date));

    const todayStr = Utils.todayISO();
    const todayIn = all.filter(m => Utils.dateKey(m.date) === todayStr && m.direction === 'in').reduce((s, m) => s + m.amount, 0);
    const todayOut = all.filter(m => Utils.dateKey(m.date) === todayStr && m.direction === 'out').reduce((s, m) => s + m.amount, 0);

    container.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:18px;">
        <div class="stat-tile"><div class="lbl">رصيد الخزنة الحالي</div><div class="val">${Utils.formatMoney(balance)}</div></div>
        <div class="stat-tile positive"><div class="lbl">داخل النهاردة</div><div class="val">${Utils.formatMoney(todayIn)}</div></div>
        <div class="stat-tile negative"><div class="lbl">خارج النهاردة</div><div class="val">${Utils.formatMoney(todayOut)}</div></div>
      </div>

      <div class="section-head">
        <h3>سجل حركة الخزنة</h3>
        <div class="tag-row">
          <button class="btn btn-success" id="depositBtn">+ إيداع</button>
          <button class="btn btn-danger" id="withdrawBtn">- سحب</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>التاريخ</th><th>البيان</th><th>ملاحظة</th><th>داخل</th><th>خارج</th><th>الرصيد بعدها</th></tr></thead>
          <tbody>
            ${all.length ? all.map(m => `
              <tr>
                <td>${Utils.formatDateTime(m.date)}</td>
                <td><span class="badge badge-muted">${SOURCE_LABELS[m.source] || m.source}</span></td>
                <td>${Utils.escapeHtml(m.note || '—')}</td>
                <td style="color:var(--success);font-weight:700;">${m.direction === 'in' ? Utils.formatMoney(m.amount) : ''}</td>
                <td style="color:var(--danger);font-weight:700;">${m.direction === 'out' ? Utils.formatMoney(m.amount) : ''}</td>
                <td>${Utils.formatMoney(m.balanceAfter)}</td>
              </tr>`).join('') : `<tr class="empty-row"><td colspan="6">مفيش حركة على الخزنة لسه</td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    container.querySelector('#depositBtn').addEventListener('click', () => openMoveModal('in', container));
    container.querySelector('#withdrawBtn').addEventListener('click', () => openMoveModal('out', container));
  }

  function openMoveModal(direction, container) {
    const isIn = direction === 'in';
    Utils.openModal({
      title: isIn ? 'إيداع في الخزنة' : 'سحب من الخزنة',
      bodyHtml: `
        <form id="moveForm">
          <div class="field">
            <label>المبلغ</label>
            <input type="number" id="mAmount" min="0.01" step="0.01" autofocus>
          </div>
          <div class="field">
            <label>ملاحظة (اختياري)</label>
            <input type="text" id="mNote" placeholder="${isIn ? 'مثلاً: ضخ رأس مال إضافي' : 'مثلاً: سحب شخصي'}">
          </div>
          <div class="form-actions">
            <button type="submit" class="btn ${isIn ? 'btn-success' : 'btn-danger'}">${isIn ? 'تسجيل الإيداع' : 'تسجيل السحب'}</button>
          </div>
        </form>`,
      onMount: (body, close) => {
        body.querySelector('#moveForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const amount = Number(body.querySelector('#mAmount').value || 0);
          if (amount <= 0) { Utils.toast('اكتب مبلغ صحيح', 'error'); return; }
          await Services.manualTreasuryMove(direction, amount, body.querySelector('#mNote').value.trim());
          await refreshShell();
          Utils.toast('تم التسجيل', 'success');
          close();
          render(container);
        });
      }
    });
  }

  return { render };
})();
