Modules.employees = (() => {
  /* شاشة الموظفين

     لكل موظف حساب زي دفتر: كل سطر يا "ليه" يا "عليه".
       ليه  : المرتب، العمولة، المكافأة
       عليه : السلفة، اللي صرفته له، الخصم
     الرصيد = اللي لسه مستحق له.

     يوم ١ من كل شهر بتقفل الشهر اللي فات: البرنامج بيحط المرتب
     والعمولة في حسابه ويسجّل مصروف "مرتبات" بقيمتهم — وكده الأرباح
     والخساير بتطلع صح، وانت بتشوف المستحق اللي هتقبضه له كام. */

  const TYPE_LABELS = {
    salary: 'مرتب', commission: 'عمولة', bonus: 'مكافأة',
    advance: 'سلفة', payment: 'صرف', deduction: 'خصم'
  };

  function balanceBadge(balance) {
    const b = Number(balance || 0);
    if (Math.abs(b) < 0.005) return '<span class="badge badge-muted">مفيش مستحق</span>';
    if (b > 0) return `<span class="badge badge-warn">${Utils.formatMoney(b)} مستحق له</span>`;
    return `<span class="badge badge-ok">${Utils.formatMoney(-b)} أخد زيادة</span>`;
  }

  // آخر شهر خلص — ده اللي المفروض يتقفل
  function lastMonthKey() {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function monthLabel(key) {
    const NAMES = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                   'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const [y, m] = String(key).split('-').map(Number);
    return (NAMES[m - 1] || key) + ' ' + y;
  }

  async function render(container) {
    const [employees, closings] = await Promise.all([
      DB.getAll('employees'), DB.getAll('payrollClosings')
    ]);
    employees.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));

    const active = employees.filter(e => e.active !== false);
    const owed = active.reduce((s, e) => s + Math.max(0, Number(e.balance || 0)), 0);
    const monthlyCost = active.reduce((s, e) => s + Number(e.salary || 0), 0);

    // مين لسه شهره اللي فات مش متقفّل؟
    const lm = lastMonthKey();
    const pending = active.filter(e =>
      !closings.some(c => !c.voided && Number(c.employeeId) === Number(e.id) && c.monthKey === lm));

    container.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:18px;">
        <div class="stat-tile"><div class="lbl">عدد الموظفين</div><div class="val">${active.length}</div></div>
        <div class="stat-tile negative"><div class="lbl">مرتبات الشهر</div><div class="val">${Utils.formatMoney(monthlyCost)}</div></div>
        <div class="stat-tile negative"><div class="lbl">مستحق للموظفين دلوقتي</div><div class="val">${Utils.formatMoney(owed)}</div></div>
      </div>

      ${pending.length ? `
        <div class="notice notice-warn" style="margin-bottom:18px;">
          <strong>لسه ما قفلتش شهر ${monthLabel(lm)}</strong> لـ
          ${pending.map(e => Utils.escapeHtml(e.name)).join('، ')}.
          <div class="hint" style="margin-top:4px;">التقفيل بيحسب المرتب والعمولة ويقولك هتقبضه كام.</div>
          <button class="btn btn-amber btn-sm" id="closeAllBtn" style="margin-top:10px;">اقفل الشهر للكل</button>
        </div>` : ''}

      <div class="section-head">
        <h3>الموظفين</h3>
        <button class="btn btn-amber" id="addEmpBtn">+ موظف جديد</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>الاسم</th><th>الوظيفة</th><th>التليفون</th>
              <th>المرتب</th><th>العمولة</th><th>الحساب</th><th></th>
            </tr>
          </thead>
          <tbody id="empBody">
            ${employees.length ? employees.map(e => `
              <tr data-id="${e.id}" ${e.active === false ? 'style="opacity:.5;"' : ''}>
                <td><button type="button" class="name-link open-emp">${Utils.escapeHtml(e.name)}</button>
                    ${e.active === false ? ' <span class="badge badge-muted">مش شغال</span>' : ''}</td>
                <td>${Utils.escapeHtml(e.job || '—')}</td>
                <td>${Utils.escapeHtml(e.phone || '—')}</td>
                <td>${Utils.formatMoney(e.salary)}</td>
                <td>${Number(e.commissionRate || 0) > 0
                      ? `<span class="badge badge-ok">${e.commissionRate}% من مبيعاته</span>`
                      : '<span class="muted">مفيش</span>'}</td>
                <td>${balanceBadge(e.balance)}</td>
                <td>
                  <button class="icon-btn adv-emp" title="سلفة">💵</button>
                  <button class="icon-btn pay-emp" title="اصرفله مستحق">💰</button>
                  <button class="icon-btn edit-emp" title="تعديل">✏️</button>
                  <button class="icon-btn del-emp" title="حذف">🗑️</button>
                </td>
              </tr>`).join('')
              : `<tr class="empty-row"><td colspan="7">مفيش موظفين مسجلين لسه — دوس "+ موظف جديد"</td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    const again = () => render(container);

    container.querySelector('#addEmpBtn').addEventListener('click', () => openEmpForm(null, again));

    const closeAll = container.querySelector('#closeAllBtn');
    if (closeAll) closeAll.addEventListener('click', () => openCloseMonthModal(pending, lm, again));

    container.querySelector('#empBody').addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      if (!tr || !tr.dataset.id) return;
      const id = Number(tr.dataset.id);
      const emp = employees.find(x => x.id === id);
      if (!emp) return;

      if (e.target.classList.contains('open-emp')) {
        openStatement(emp, again);
      } else if (e.target.classList.contains('edit-emp')) {
        openEmpForm(emp, again);
      } else if (e.target.classList.contains('adv-emp')) {
        openMoneyModal(emp, 'advance', again);
      } else if (e.target.classList.contains('pay-emp')) {
        openMoneyModal(emp, 'payment', again);
      } else if (e.target.classList.contains('del-emp')) {
        const moves = (await DB.getAll('employeeMoves')).filter(m => Number(m.employeeId) === id && !m.voided);
        if (moves.length) {
          Utils.toast('الموظف ده ليه حركات في حسابه — اقفله "مش شغال" بدل ما تمسحه', 'error');
          return;
        }
        if (!(await Utils.confirmDialog(`حذف "${emp.name}"؟`))) return;
        await DB.delete('employees', id);
        Utils.toast('تم الحذف', 'success');
        again();
      }
    });
  }

  // ---------- كارت الموظف ----------
  function openEmpForm(emp, onDone) {
    Utils.openModal({
      title: emp ? 'تعديل بيانات ' + emp.name : 'موظف جديد',
      bodyHtml: `
        <form id="empForm">
          <div class="field">
            <label>الاسم</label>
            <input type="text" id="fName" value="${Utils.escapeHtml(emp?.name || '')}" required autofocus>
          </div>
          <div class="field-row">
            <div class="field">
              <label>الوظيفة</label>
              <input type="text" id="fJob" value="${Utils.escapeHtml(emp?.job || '')}" list="jobList" placeholder="بائع / صنايعي / سواق">
              <datalist id="jobList">
                <option value="بائع"><option value="صنايعي"><option value="سواق"><option value="عامل"><option value="محاسب">
              </datalist>
            </div>
            <div class="field">
              <label>التليفون</label>
              <input type="text" id="fPhone" value="${Utils.escapeHtml(emp?.phone || '')}" inputmode="tel">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label>المرتب الشهري</label>
              <input type="number" id="fSalary" min="0" step="0.01" value="${emp?.salary ?? ''}" placeholder="0.00">
            </div>
            <div class="field">
              <label>عمولة على مبيعاته <span class="muted">(%)</span></label>
              <input type="number" id="fComm" min="0" max="100" step="0.01" value="${emp?.commissionRate ?? ''}" placeholder="سيبها فاضية لو مفيش عمولة">
            </div>
          </div>
          <div class="hint" id="commHint" style="margin:-8px 0 14px;"></div>
          <div class="field-row">
            <div class="field">
              <label>تاريخ الاستلام</label>
              <input type="date" id="fStart" value="${emp?.startDate ? Utils.dateKey(emp.startDate) : Utils.todayISO()}">
            </div>
            <div class="field">
              <label>الحالة</label>
              <select id="fActive">
                <option value="1" ${emp?.active !== false ? 'selected' : ''}>شغال</option>
                <option value="0" ${emp?.active === false ? 'selected' : ''}>مش شغال</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label>ملاحظات (اختياري)</label>
            <input type="text" id="fNote" value="${Utils.escapeHtml(emp?.note || '')}">
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" id="cancelEmp">إلغاء</button>
            <button type="submit" class="btn btn-amber">حفظ</button>
          </div>
        </form>`,
      onMount: (body, close) => {
        const salaryEl = body.querySelector('#fSalary');
        const commEl = body.querySelector('#fComm');
        const hint = body.querySelector('#commHint');
        function sync() {
          const rate = Number(commEl.value || 0);
          hint.textContent = rate > 0
            ? `لو باع بـ 100,000 ج.م في الشهر ياخد عمولة ${Utils.formatMoney(100000 * rate / 100)} فوق المرتب`
            : 'من غير عمولة — بياخد المرتب بس';
        }
        commEl.addEventListener('input', sync); sync();

        body.querySelector('#cancelEmp').addEventListener('click', close);
        body.querySelector('#empForm').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const name = body.querySelector('#fName').value.trim();
          if (!name) { Utils.toast('اكتب اسم الموظف', 'error'); return; }
          const startVal = body.querySelector('#fStart').value;
          const payload = {
            name,
            job: body.querySelector('#fJob').value.trim(),
            phone: body.querySelector('#fPhone').value.trim(),
            salary: Number(salaryEl.value || 0),
            commissionRate: Number(commEl.value || 0),
            startDate: startVal ? new Date(startVal + 'T12:00:00').toISOString() : Utils.nowISO(),
            active: body.querySelector('#fActive').value === '1',
            note: body.querySelector('#fNote').value.trim()
          };
          if (emp) { payload.id = emp.id; payload.balance = emp.balance || 0; }
          else payload.balance = 0;
          await DB.put('employees', payload);
          Utils.toast(emp ? 'اتحفظت البيانات' : 'اتسجل الموظف', 'success');
          close();
          onDone();
        });
      }
    });
  }

  // ---------- سلفة / صرف مستحق ----------
  function openMoneyModal(emp, kind, onDone) {
    const isAdv = kind === 'advance';
    const due = Math.max(0, Number(emp.balance || 0));
    Utils.openModal({
      title: (isAdv ? 'سلفة لـ ' : 'صرف مستحق لـ ') + emp.name,
      bodyHtml: `
        <form id="mForm">
          <div class="notice ${isAdv ? 'notice-warn' : 'notice-ok'}" style="margin-bottom:14px;line-height:1.9;">
            المستحق له دلوقتي: <strong>${Utils.formatMoney(due)}</strong>
            ${isAdv
              ? '<br><span class="muted">السلفة مش مصروف — دي فلوس من مرتبه بتخرج بدري، وهتتخصم من مستحقه.</span>'
              : '<br><span class="muted">هتخرج من الخزنة وتتخصم من مستحقه.</span>'}
          </div>
          <div class="field">
            <label>التاريخ</label>
            <input type="date" id="mDate" value="${Utils.todayISO()}">
          </div>
          <div class="field">
            <label>المبلغ</label>
            <input type="number" id="mAmount" min="0.01" step="0.01" value="${!isAdv && due > 0 ? due : ''}" required autofocus>
            ${!isAdv && due > 0 ? '<div class="hint">اكتب مبلغ أقل لو هتصرفله جزء بس</div>' : ''}
          </div>
          <div class="field">
            <label>ملاحظة (اختياري)</label>
            <input type="text" id="mNote" placeholder="${isAdv ? 'مثلاً: سلفة أول الشهر' : 'مثلاً: مرتب أغسطس'}">
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" id="cancelM">إلغاء</button>
            <button type="submit" class="btn ${isAdv ? 'btn-danger' : 'btn-amber'}">
              ${isAdv ? 'تسجيل السلفة' : 'صرف'}
            </button>
          </div>
        </form>`,
      onMount: (body, close) => {
        body.querySelector('#cancelM').addEventListener('click', close);
        body.querySelector('#mForm').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const amount = Number(body.querySelector('#mAmount').value || 0);
          if (amount <= 0) { Utils.toast('اكتب مبلغ صحيح', 'error'); return; }
          const dv = body.querySelector('#mDate').value;
          const date = dv ? new Date(dv + 'T12:00:00').toISOString() : Utils.nowISO();
          const note = body.querySelector('#mNote').value.trim();
          try {
            if (isAdv) await Services.employeeAdvance(emp.id, amount, note, date);
            else await Services.payEmployee(emp.id, amount, note, date);
            await refreshShell();
            Utils.toast(isAdv ? 'اتسجلت السلفة' : 'اتصرف المبلغ', 'success');
            close();
            onDone();
          } catch (err) {
            Utils.toast(err.message || 'التسجيل مانجحش', 'error');
          }
        });
      }
    });
  }

  // ---------- تقفيل الشهر ----------
  function openCloseMonthModal(list, monthKey, onDone) {
    Utils.openModal({
      title: 'تقفيل ' + monthLabel(monthKey),
      bodyHtml: `
        <div class="notice notice-ok" style="margin-bottom:14px;line-height:1.9;">
          هيتحسب لكل موظف <strong>المرتب + العمولة على مبيعاته</strong> في الشهر ده،
          ويتحطوا في حسابه، ويتسجلوا مصروف "مرتبات".
          <br><span class="muted">مفيش فلوس هتخرج من الخزنة دلوقتي — الفلوس بتخرج لما تصرفله.</span>
        </div>
        <div id="closePreview"><div class="empty-state" style="padding:14px;">بيحسب...</div></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="cancelC">إلغاء</button>
          <button type="button" class="btn btn-amber" id="doClose" disabled>اقفل الشهر</button>
        </div>`,
      onMount: async (body, close) => {
        body.querySelector('#cancelC').addEventListener('click', close);
        const box = body.querySelector('#closePreview');
        const btn = body.querySelector('#doClose');
        const { from, to } = Services.monthRange(monthKey);

        const rows = [];
        for (const e of list) {
          const sold = await Services.employeeSales(e.id, from, to);
          const rate = Number(e.commissionRate || 0);
          const salary = Number(e.salary || 0);
          const commission = Math.round((sold.total * rate / 100) * 100) / 100;
          rows.push({ e, sold, rate, salary, commission, total: salary + commission });
        }
        const grand = rows.reduce((s, r) => s + r.total, 0);

        box.innerHTML = `
          <div class="table-wrap">
            <table>
              <thead><tr><th>الموظف</th><th>مبيعاته</th><th>المرتب</th><th>العمولة</th><th>المستحق</th></tr></thead>
              <tbody>
                ${rows.map(r => `
                  <tr>
                    <td class="strong">${Utils.escapeHtml(r.e.name)}</td>
                    <td>${r.rate > 0 ? Utils.formatMoney(r.sold.total) + `<div class="unit-cost-sub">${r.sold.count} فاتورة</div>` : '<span class="muted">—</span>'}</td>
                    <td>${Utils.formatMoney(r.salary)}</td>
                    <td>${r.commission > 0 ? Utils.formatMoney(r.commission) + `<div class="unit-cost-sub">${r.rate}%</div>` : '<span class="muted">—</span>'}</td>
                    <td class="strong">${Utils.formatMoney(r.total)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="stat-tile negative" style="margin-top:14px;">
            <div class="lbl">إجمالي مرتبات ${monthLabel(monthKey)}</div>
            <div class="val">${Utils.formatMoney(grand)}</div>
          </div>`;

        btn.disabled = rows.every(r => r.total <= 0);
        btn.addEventListener('click', async () => {
          btn.disabled = true; btn.textContent = 'بيقفل...';
          const done = [], failed = [];
          for (const r of rows) {
            if (r.total <= 0) continue;
            try { await Services.closePayrollMonth(r.e.id, monthKey); done.push(r.e.name); }
            catch (err) { failed.push(r.e.name + ': ' + (err.message || '')); }
          }
          if (failed.length) Utils.toast(failed.join(' · '), 'error');
          if (done.length) Utils.toast('اتقفل الشهر لـ ' + done.join('، '), 'success');
          await refreshShell();
          close();
          onDone();
        });
      }
    });
  }

  // ---------- كشف حساب الموظف ----------
  async function openStatement(emp, onDone) {
    const [allMoves, allClosings] = await Promise.all([
      DB.getAll('employeeMoves'), DB.getAll('payrollClosings')
    ]);
    const moves = allMoves
      .filter(m => Number(m.employeeId) === Number(emp.id) && !m.voided)
      .sort((a, b) => {
        const d = new Date(a.date) - new Date(b.date);
        return d !== 0 ? d : (Number(a.id) - Number(b.id));
      });
    const closings = allClosings
      .filter(c => Number(c.employeeId) === Number(emp.id) && !c.voided)
      .sort((a, b) => (b.monthKey || '').localeCompare(a.monthKey || ''));

    let run = 0;
    const rows = moves.map(m => {
      const credit = m.dir === 'credit' ? Number(m.amount || 0) : 0;
      const debit = m.dir === 'debit' ? Number(m.amount || 0) : 0;
      run = Math.round((run + credit - debit) * 100) / 100;
      return { m, credit, debit, run };
    }).reverse();

    Utils.openModal({
      title: 'كشف حساب ' + emp.name,
      wide: true,
      bodyHtml: `
        <div class="grid grid-3" style="margin-bottom:16px;">
          <div class="stat-tile"><div class="lbl">المرتب الشهري</div><div class="val">${Utils.formatMoney(emp.salary)}</div></div>
          <div class="stat-tile"><div class="lbl">العمولة</div><div class="val">${Number(emp.commissionRate || 0) > 0 ? emp.commissionRate + '%' : '—'}</div></div>
          <div class="stat-tile ${Number(emp.balance || 0) > 0 ? 'negative' : ''}">
            <div class="lbl">المستحق له دلوقتي</div>
            <div class="val">${Utils.formatMoney(Math.max(0, Number(emp.balance || 0)))}</div>
          </div>
        </div>

        ${closings.length ? `
        <div class="section-head"><h3>الشهور المتقفّلة</h3></div>
        <div class="table-wrap" style="margin-bottom:18px;">
          <table>
            <thead><tr><th>الشهر</th><th>مبيعاته</th><th>المرتب</th><th>العمولة</th><th>الإجمالي</th><th></th></tr></thead>
            <tbody>
              ${closings.map(c => `
                <tr data-close="${c.id}">
                  <td class="strong">${monthLabel(c.monthKey)}</td>
                  <td>${Number(c.rate || 0) > 0 ? Utils.formatMoney(c.salesBase) : '<span class="muted">—</span>'}</td>
                  <td>${Utils.formatMoney(c.salary)}</td>
                  <td>${Utils.formatMoney(c.commission)}</td>
                  <td class="strong">${Utils.formatMoney(Number(c.salary || 0) + Number(c.commission || 0))}</td>
                  <td><button class="icon-btn undo-close" title="فك التقفيل">🗑️</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}

        <div class="section-head"><h3>حركة الحساب</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>التاريخ</th><th>البيان</th><th>ملاحظة</th><th>له</th><th>عليه</th><th>الرصيد</th><th></th></tr></thead>
            <tbody>
              ${rows.length ? rows.map(r => `
                <tr data-move="${r.m.id}">
                  <td>${Utils.formatDate(r.m.date)}</td>
                  <td><span class="badge badge-muted">${TYPE_LABELS[r.m.type] || r.m.type}</span></td>
                  <td class="muted" style="font-size:12px;">${Utils.escapeHtml(r.m.note || '—')}</td>
                  <td style="color:var(--success);font-weight:700;">${r.credit ? Utils.formatMoney(r.credit) : ''}</td>
                  <td style="color:var(--danger);font-weight:700;">${r.debit ? Utils.formatMoney(r.debit) : ''}</td>
                  <td>${Utils.formatMoney(r.run)}</td>
                  <td>${r.m.refType === 'payroll' ? '' : '<button class="icon-btn undo-move" title="امسح الحركة">🗑️</button>'}</td>
                </tr>`).join('')
                : `<tr class="empty-row"><td colspan="7">مفيش حركة على حسابه لسه</td></tr>`}
            </tbody>
          </table>
        </div>`,
      onMount: (body, close) => {
        body.addEventListener('click', async (e) => {
          if (e.target.classList.contains('undo-move')) {
            const id = Number(e.target.closest('tr').dataset.move);
            if (!(await Utils.confirmDialog('امسح الحركة دي؟ لو كانت سلفة أو صرف، الفلوس هترجع للخزنة.'))) return;
            try {
              await Services.voidEmployeeMove(id);
              await refreshShell();
              Utils.toast('اتمسحت', 'success');
              close(); onDone();
            } catch (err) { Utils.toast(err.message || 'المسح مانجحش', 'error'); }
          } else if (e.target.classList.contains('undo-close')) {
            const id = Number(e.target.closest('tr').dataset.close);
            if (!(await Utils.confirmDialog('فك تقفيل الشهر ده؟ المرتب والعمولة هيتشالوا من حسابه ومن المصروفات.'))) return;
            try {
              await Services.voidPayrollClosing(id);
              await refreshShell();
              Utils.toast('اتفك التقفيل', 'success');
              close(); onDone();
            } catch (err) { Utils.toast(err.message || 'مانجحش', 'error'); }
          }
        });
      }
    });
  }

  return { render };
})();
