Modules.expenses = (() => {
  let saving = false;
  const CATEGORIES =['إيجار', 'كهرباء ومياه', 'مرتبات', 'مواصلات ونقل', 'صيانة', 'أدوات مكتبية', 'ضيافة', 'أخرى'];

  async function render(container) {
    await AppState.reloadParties();
    const allEmployees = await DB.getAll('employees');
    const employees = allEmployees
      .filter(e => e.active !== false)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
    const all = await DB.getAll('expenses');
    all.sort((a, b) => new Date(b.date) - new Date(a.date));
    const monthTotal = all.filter(e => Utils.dateKey(e.date).slice(0, 7) === Utils.todayISO().slice(0, 7)).reduce((s, e) => s + e.amount, 0);

    /* الدفعات للموردين وسلف الموظفين مش مصروفات، بس بنعرضها في نفس
       السجل عشان ميحصلش لخبطة لما يسجل دفعة ومايلاقيهاش. */
    const pays = (await DB.getAll('treasury'))
      .filter(t => ['pay', 'advance', 'salary'].includes(t.source))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 30)
      .map(t => {
        let who = 'مورد';
        if (t.source === 'pay') {
          const s = AppState.suppliers.find(x => x.id === t.refId);
          who = s ? s.name : 'مورد';
        } else {
          const e = allEmployees.find(x => x.id === t.refId);
          who = (e ? e.name : 'موظف') + (t.source === 'advance' ? ' (سلفة)' : ' (صرف)');
        }
        return { date: t.date, name: who, amount: t.amount, note: t.note || '' };
      });

    container.innerHTML = `
      <div class="grid form-layout">
        <div class="card">
          <div class="section-head"><h3>تسجيل مصروف</h3></div>
          <form id="expForm">
            <div class="field">
              <label>التاريخ</label>
              <input type="date" id="eDate" value="${Utils.todayISO()}">
              <div class="hint">لو صرفت الفلوس امبارح وبتسجّلها النهاردة، غيّر التاريخ</div>
            </div>
            <div class="field">
              <label>النوع / البيان</label>
              <input type="text" id="eCategory" list="expCatList" placeholder="اختار أو اكتب اللي انت عايزه" autocomplete="off">
              <datalist id="expCatList">${CATEGORIES.map(c => `<option value="${c}">`).join('')}</datalist>
            </div>
            <div class="field">
              <label>دفعة لمورد؟ <span class="muted">(سيبها فاضية لو مصروف عادي)</span></label>
              <input type="text" id="eSupplier" list="expSupList" placeholder="اسم المورد" autocomplete="off">
              <datalist id="expSupList">
                ${AppState.suppliers.map(s => `<option value="${Utils.escapeHtml(s.name)}">`).join('')}
              </datalist>
              <div class="hint" id="supHint"></div>
            </div>
            ${employees.length ? `
            <div class="field">
              <label>سلفة لموظف؟ <span class="muted">(سيبها فاضية لو مصروف عادي)</span></label>
              <select id="eEmployee">
                <option value="">—</option>
                ${employees.map(e => `<option value="${e.id}">${Utils.escapeHtml(e.name)}</option>`).join('')}
              </select>
              <div class="hint" id="empHint"></div>
            </div>` : ''}
            <div class="field">
              <label>الوصف (اختياري)</label>
              <input type="text" id="eDesc" placeholder="تفاصيل إضافية">
            </div>
            <div class="field">
              <label>المبلغ</label>
              <input type="number" id="eAmount" min="0.01" step="0.01" required autofocus>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-amber btn-block" id="expSave">تسجيل المصروف</button>
            </div>
          </form>
          <div class="stat-tile negative" style="margin-top:16px;">
            <div class="lbl">إجمالي مصروفات الشهر الحالي</div>
            <div class="val">${Utils.formatMoney(monthTotal)}</div>
          </div>
        </div>

        <div class="card">
          <div class="section-head"><h3>سجل المصروفات</h3></div>
          ${pays.length ? `
          <div class="notice notice-ok" style="margin-bottom:12px;line-height:1.9;">
            <strong>آخر الدفعات للموردين والموظفين</strong>
            <div class="muted" style="font-size:12px;margin:2px 0 8px;">
              دي نزلت من الخزنة ومن حساب صاحبها — ومش محسوبة في المصروفات.
            </div>
            ${pays.slice(0, 5).map(p => `
              <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:3px 0;">
                <span>${Utils.formatDate(p.date)} · ${Utils.escapeHtml(p.name)}</span>
                <strong>${Utils.formatMoney(p.amount)}</strong>
              </div>`).join('')}
          </div>` : ''}
          <div class="table-wrap" style="border:none;">
            <table>
              <thead><tr><th>التاريخ</th><th>النوع</th><th>الوصف</th><th>المبلغ</th><th></th></tr></thead>
              <tbody id="expBody">
                ${all.length ? all.map(e => `
                  <tr data-id="${e.id}">
                    <td>${Utils.formatDateTime(e.date)}</td>
                    <td><span class="badge badge-muted">${Utils.escapeHtml(e.category)}</span></td>
                    <td>${Utils.escapeHtml(e.description || '—')}</td>
                    <td style="font-weight:700;color:var(--danger);">${Utils.formatMoney(e.amount)}</td>
                    <td>${e.source === 'payroll'
                      ? '<button class="icon-btn locked-exp" title="مرتب من تقفيل شهر — امسحه من كشف حساب الموظف" data-why="ده مرتب موظف من تقفيل الشهر — امسحه من كشف حساب الموظف">🔒</button>'
                      : (e.source === 'depreciation'
                        ? '<button class="icon-btn locked-exp" title="إهلاك أصول" data-why="ده إهلاك أصول ثابتة — امسحه من شاشة الأصول الثابتة">🔒</button>'
                        : '<button class="icon-btn del-exp" title="حذف">🗑️</button>')}</td>
                  </tr>`).join('') : `<tr class="empty-row"><td colspan="5">مفيش مصروفات مسجلة لسه</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    /* لما يكتب اسم مورد، بنوضحله إن دي دفعة مش مصروف —
       وبنوريه رصيد المورد عشان يعرف باقي عليه كام. */
    function findSupplier() {
      const name = (container.querySelector('#eSupplier').value || '').trim();
      if (!name || Services.isCashName(name)) return null;
      return AppState.suppliers.find(s => (s.name || '').trim() === name) || { name, isNew: true };
    }
    function updateSupHint() {
      const hint = container.querySelector('#supHint');
      const btn = container.querySelector('#expSave');
      const sup = findSupplier();
      if (!sup) {
        hint.innerHTML = '';
        btn.textContent = 'تسجيل المصروف';
        return;
      }
      const bal = sup.isNew ? 0 : Number(sup.balance || 0);
      hint.innerHTML =
        `دي <strong>دفعة لحساب ${Utils.escapeHtml(sup.name)}</strong> — هتنزل من الخزنة ومن حسابه.` +
        (sup.isNew ? '<br>مورد جديد — هيتعمل لوحده.'
                   : `<br>الباقي له دلوقتي: <strong>${Utils.formatMoney(bal)}</strong>`) +
        '<br><span class="muted">مش هتتحسب مصروف، لأن البضاعة اتحسبت عليك يوم ما اشتريتها.</span>';
      btn.textContent = 'تسجيل الدفعة';
    }
    container.querySelector('#eSupplier').addEventListener('input', updateSupHint);
    container.querySelector('#eSupplier').addEventListener('change', updateSupHint);

    /* السلفة للموظف زي الدفعة للمورد بالظبط: فلوس بتخرج من الخزنة
       وتتخصم من حسابه، ومش بتتحسب مصروف — المصروف بيتسجل يوم
       تقفيل الشهر بمرتبه كامل. */
    const empSel = container.querySelector('#eEmployee');
    function findEmployee() {
      if (!empSel || !empSel.value) return null;
      return employees.find(x => String(x.id) === empSel.value) || null;
    }
    function updateEmpHint() {
      if (!empSel) return;
      const hint = container.querySelector('#empHint');
      const btn = container.querySelector('#expSave');
      const emp = findEmployee();
      const supEl = container.querySelector('#eSupplier');
      if (!emp) { hint.innerHTML = ''; updateSupHint(); return; }
      if (supEl.value.trim()) supEl.value = '';   // واحد بس في المرة
      const due = Math.max(0, Number(emp.balance || 0));
      hint.innerHTML =
        `دي <strong>سلفة لـ ${Utils.escapeHtml(emp.name)}</strong> — هتنزل من الخزنة ومن مستحقه.` +
        `<br>المستحق له دلوقتي: <strong>${Utils.formatMoney(due)}</strong>` +
        '<br><span class="muted">مش هتتحسب مصروف — دي فلوس من مرتبه، والمرتب بيتسجل مصروف يوم تقفيل الشهر.</span>';
      btn.textContent = 'تسجيل السلفة';
    }
    if (empSel) empSel.addEventListener('change', updateEmpHint);

    container.querySelector('#expForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (saving) return;   // منع التسجيل مرتين بدوستين سريعتين
      const amount = Number(container.querySelector('#eAmount').value || 0);
      const category = container.querySelector('#eCategory').value.trim();
      const desc = container.querySelector('#eDesc').value.trim();
      const sup = findSupplier();
      const dateVal = container.querySelector('#eDate').value;
      // بنثبّت الوقت على نص اليوم عشان التاريخ ما يزحلقش يوم بفرق التوقيت
      const date = dateVal ? new Date(dateVal + 'T12:00:00').toISOString() : Utils.nowISO();

      const emp = findEmployee();
      if (!sup && !emp && !category) { Utils.toast('اكتب نوع المصروف', 'error'); return; }
      if (amount <= 0) { Utils.toast('اكتب مبلغ صحيح', 'error'); return; }

      saving = true;
      const btn = container.querySelector('#expSave');
      const oldTxt = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'بيسجل...'; }
      try {
        if (emp) {
          const note = [category, desc].filter(Boolean).join(' — ') || 'سلفة';
          await Services.employeeAdvance(emp.id, amount, note, date);
          Utils.toast('اتسجلت السلفة ونزلت من مستحق ' + emp.name, 'success');
        } else if (sup) {
          const supplierId = await Services.resolveParty('suppliers', sup.name);
          const note = [category, desc].filter(Boolean).join(' — ') || ('دفعة لـ ' + sup.name);
          await Services.payToSupplier(supplierId, amount, note, date);
          await AppState.reloadParties();
          Utils.toast('اتسجلت الدفعة ونزلت من حساب ' + sup.name, 'success');
        } else {
          await Services.saveExpense({ category, description: desc, amount, date });
          Utils.toast('تم تسجيل المصروف', 'success');
        }
        await refreshShell();
        render(container);
      } catch (err) {
        Utils.toast('التسجيل مانجحش: ' + (err.message || ''), 'error');
        if (btn) { btn.disabled = false; btn.textContent = oldTxt; }
      } finally {
        saving = false;
      }
    });

    container.querySelector('#expBody').addEventListener('click', async (e) => {
      if (e.target.classList.contains('locked-exp')) {
        Utils.toast(e.target.dataset.why || 'المصروف ده مربوط بمستند تاني', 'info');
        return;
      }
      if (!e.target.classList.contains('del-exp')) return;
      const id = Number(e.target.closest('tr').dataset.id);
      const ok = await Utils.confirmDialog('حذف هذا المصروف؟ هيترد مبلغه للخزنة.');
      if (!ok) return;
      await Services.deleteExpense(id);
      await refreshShell();
      Utils.toast('تم الحذف', 'success');
      render(container);
    });
  }

  return { render };
})();
