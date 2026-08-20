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

      <div class="card daycard" id="dayCard" style="margin-bottom:18px;">
        <div class="section-head"><h3>تقفيل اليومية</h3></div>
        <div id="dayBody"><div class="empty-state" style="padding:16px;">بيجمّع حركة اليوم...</div></div>
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

    await drawDayClose(container);

    container.querySelector('#depositBtn').addEventListener('click', () => openMoveModal('in', container));
    container.querySelector('#withdrawBtn').addEventListener('click', () => openMoveModal('out', container));
  }

  /* تقفيل اليومية: بيوريك حركة اليوم، وبتكتب اللي عديته في الدرج فعلاً،
     والبرنامج بيقولك في فرق ولا لأ وبيظبط الرصيد عليه. */
  async function drawDayClose(container) {
    const box = container.querySelector('#dayBody');
    if (!box) return;
    const s = await Services.daySummary();

    if (s.closed) {
      const d = s.closed;
      const kind = Math.abs(d.difference) < 0.005 ? 'ok' : (d.difference > 0 ? 'over' : 'short');
      box.innerHTML = `
        <div class="notice ${kind === 'ok' ? 'notice-ok' : 'notice-warn'}" style="line-height:2;">
          <strong>اليوم اتقفل ${Utils.formatDateTime(d.closedAt)}</strong><br>
          البرنامج كان بيقول <strong>${Utils.formatMoney(d.expected)}</strong> ·
          والدرج كان فيه <strong>${Utils.formatMoney(d.counted)}</strong>
          ${kind === 'ok'
            ? '<br>مظبوط بالمليم.'
            : `<br><strong style="color:var(--danger);">فرق ${Utils.formatMoney(Math.abs(d.difference))} ${d.difference > 0 ? 'زيادة' : 'ناقص'}</strong> — واترصد في الخزنة.`}
          ${d.note ? `<br><span class="muted">${Utils.escapeHtml(d.note)}</span>` : ''}
        </div>`;
      return;
    }

    box.innerHTML = `
      <div class="day-grid">
        <div class="day-cell"><span>فواتير النهاردة</span><strong>${s.invoices}</strong></div>
        <div class="day-cell"><span>مبيعات</span><strong>${Utils.formatMoney(s.salesTotal)}</strong></div>
        <div class="day-cell"><span>مرتجعات</span><strong>${Utils.formatMoney(s.returns)}</strong></div>
        <div class="day-cell"><span>مصروفات</span><strong>${Utils.formatMoney(s.expenses)}</strong></div>
        <div class="day-cell in"><span>داخل الخزنة</span><strong>${Utils.formatMoney(s.cashIn)}</strong></div>
        <div class="day-cell out"><span>خارج الخزنة</span><strong>${Utils.formatMoney(s.cashOut)}</strong></div>
      </div>

      <div class="day-close-row">
        <div class="field" style="margin:0;">
          <label>المفروض في الدرج دلوقتي</label>
          <input type="text" id="dcExpected" value="${Utils.formatMoney(s.expected)}" readonly>
        </div>
        <div class="field" style="margin:0;">
          <label>عدّ الدرج واكتب اللي لقيته</label>
          <input type="number" id="dcCounted" step="0.01" min="0" placeholder="0.00" inputmode="decimal">
        </div>
        <button class="btn btn-amber" id="dcSave">اقفل اليومية</button>
      </div>
      <div id="dcDiff" class="hint" style="margin-top:8px;"></div>`;

    const countedEl = box.querySelector('#dcCounted');
    const diffEl = box.querySelector('#dcDiff');

    function showDiff() {
      const v = countedEl.value.trim();
      if (v === '') { diffEl.innerHTML = ''; return; }
      const diff = Math.round((Number(v || 0) - s.expected) * 100) / 100;
      if (Math.abs(diff) < 0.005) {
        diffEl.innerHTML = '<span style="color:var(--success);font-weight:700;">مظبوط بالمليم ✓</span>';
      } else {
        diffEl.innerHTML =
          `<span style="color:var(--danger);font-weight:700;">فرق ${Utils.formatMoney(Math.abs(diff))} ` +
          `${diff > 0 ? 'زيادة عن' : 'ناقص عن'} اللي في البرنامج</span>` +
          `<br><span class="muted">هيتسجل في الخزنة عشان الرصيد يبقى مطابق للفلوس اللي معاك.</span>`;
      }
    }
    countedEl.addEventListener('input', showDiff);

    box.querySelector('#dcSave').addEventListener('click', async () => {
      const v = countedEl.value.trim();
      if (v === '') { Utils.toast('اكتب اللي عديته في الدرج', 'error'); countedEl.focus(); return; }
      const counted = Number(v);
      const diff = Math.round((counted - s.expected) * 100) / 100;
      let note = '';
      if (Math.abs(diff) > 0.005) {
        const goOn = await Utils.confirmDialog(
          `فيه فرق ${Utils.formatMoney(Math.abs(diff))} ${diff > 0 ? 'زيادة' : 'ناقص'}.\n` +
          `هيتسجل في الخزنة عشان الرصيد يبقى مطابق للدرج. تكمل؟`);
        if (!goOn) return;
      }
      try {
        await Services.closeDay({ counted, note });
        await refreshShell();
        Utils.toast('اتقفلت اليومية', 'success');
        render(container);
      } catch (e) {
        Utils.toast(e.message || 'التقفيل مانجحش', 'error');
      }
    });
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
