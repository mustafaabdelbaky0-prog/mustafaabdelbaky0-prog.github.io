Modules.expenses = (() => {
  let saving = false;
  const CATEGORIES =['إيجار', 'كهرباء ومياه', 'مرتبات', 'مواصلات ونقل', 'صيانة', 'أدوات مكتبية', 'ضيافة', 'أخرى'];

  async function render(container) {
    const all = await DB.getAll('expenses');
    all.sort((a, b) => new Date(b.date) - new Date(a.date));
    const monthTotal = all.filter(e => Utils.dateKey(e.date).slice(0, 7) === Utils.todayISO().slice(0, 7)).reduce((s, e) => s + e.amount, 0);

    container.innerHTML = `
      <div class="grid form-layout">
        <div class="card">
          <div class="section-head"><h3>تسجيل مصروف</h3></div>
          <form id="expForm">
            <div class="field">
              <label>النوع / البيان</label>
              <input type="text" id="eCategory" list="expCatList" placeholder="اختار أو اكتب اللي انت عايزه" autocomplete="off">
              <datalist id="expCatList">${CATEGORIES.map(c => `<option value="${c}">`).join('')}</datalist>
              <div class="hint">تقدر تكتب أي حاجة — زي "دفعة ممدوح" — والمبلغ هينزل من الخزنة لوحده</div>
            </div>
            <div class="field">
              <label>الوصف (اختياري)</label>
              <input type="text" id="eDesc" placeholder="تفاصيل إضافية">
            </div>
            <div class="field">
              <label>المبلغ</label>
              <input type="number" id="eAmount" min="0.01" step="0.01" required autofocus>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-amber btn-block">تسجيل المصروف</button>
            </div>
          </form>
          <div class="stat-tile negative" style="margin-top:16px;">
            <div class="lbl">إجمالي مصروفات الشهر الحالي</div>
            <div class="val">${Utils.formatMoney(monthTotal)}</div>
          </div>
        </div>

        <div class="card">
          <div class="section-head"><h3>سجل المصروفات</h3></div>
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
                    <td><button class="icon-btn del-exp" title="حذف">🗑️</button></td>
                  </tr>`).join('') : `<tr class="empty-row"><td colspan="5">مفيش مصروفات مسجلة لسه</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#expForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (saving) return;   // منع التسجيل مرتين بدوستين سريعتين
      const amount = Number(container.querySelector('#eAmount').value || 0);
      const category = container.querySelector('#eCategory').value.trim();
      if (!category) { Utils.toast('اكتب نوع المصروف', 'error'); return; }
      if (amount <= 0) { Utils.toast('اكتب مبلغ صحيح', 'error'); return; }

      saving = true;
      const btn = container.querySelector('#expForm button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'بيسجل...'; }
      try {
        await Services.saveExpense({
          category,
          description: container.querySelector('#eDesc').value.trim(),
          amount
        });
        await refreshShell();
        Utils.toast('تم تسجيل المصروف', 'success');
        render(container);
      } catch (err) {
        Utils.toast('التسجيل مانجحش', 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'تسجيل المصروف'; }
      } finally {
        saving = false;
      }
    });

    container.querySelector('#expBody').addEventListener('click', async (e) => {
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
