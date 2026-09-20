/* المصروفات — دوسة واحدة وخلاص.

   الشكوى: الشاشة القديمة كانت فورم من ٦ خانات (تاريخ، نوع، مورد؟،
   موظف؟، وصف، مبلغ) عشان يسجّل "شاي بعشرة". صاحب المحل بيصرف كل شوية
   (شاي، قهوة، سكر، حاجة ساقعة، فطار) — فلازم التسجيل يبقى بسرعة
   الصرف نفسه.

   الحل: أزرار سريعة. كل زرار عليه اسم المصروف وسعره المعتاد، دوسة
   واحدة تسجّله على طول بتاريخ النهارده، ومعاها "تراجع" لو دوس
   بالغلط. الأزرار بتاعته هو: يضيف، يعدّل السعر، يمسح.

   ولو مصروف مش على الأزرار: خانتين بس — إيه وبكام.

   دفعات الموردين وسلف الموظفين مبقتش هنا — دي مش مصروفات وكانت
   هي اللي بتلخبطه. ليها مكانها: حساب المورد، وشاشة الموظفين. */
Modules.expenses = (() => {
  const PRESETS_KEY = 'expensePresets';
  const DEFAULT_PRESETS = [
    { name: 'شاي', amount: 10, icon: '🍵' },
    { name: 'قهوة', amount: 15, icon: '☕' },
    { name: 'سكر', amount: 60, icon: '🍬' },
    { name: 'حاجة ساقعة', amount: 15, icon: '🥤' },
    { name: 'فطار', amount: 50, icon: '🥙' },
    { name: 'غدا', amount: 80, icon: '🍽️' },
    { name: 'مواصلات', amount: 0, icon: '🚕' },
    { name: 'نضافة', amount: 0, icon: '🧹' }
  ];

  let editMode = false;
  let lastUndo = null;      // { id, timer } — آخر مصروف اتسجل، عشان "تراجع"

  async function loadPresets() {
    const rec = await DB.get('settings', PRESETS_KEY);
    const list = rec && Array.isArray(rec.value) ? rec.value : null;
    return list && list.length ? list : DEFAULT_PRESETS.map(p => Object.assign({}, p));
  }
  async function savePresets(list) {
    await DB.put('settings', { key: PRESETS_KEY, value: list });
  }

  // بنثبّت الوقت على نص اليوم عشان التاريخ ما يزحلقش يوم بفرق التوقيت
  function dayToISO(dayStr) {
    return dayStr ? new Date(dayStr + 'T12:00:00').toISOString() : Utils.nowISO();
  }

  function lockedWhy(e) {
    if (e.source === 'payroll') return 'ده مرتب موظف من تقفيل الشهر — امسحه من كشف حساب الموظف';
    if (e.source === 'depreciation') return 'ده إهلاك أصول ثابتة — امسحه من شاشة الأصول الثابتة';
    return '';
  }

  function delBtn(e) {
    const why = lockedWhy(e);
    return why
      ? `<button type="button" class="icon-btn locked-exp" data-why="${Utils.escapeHtml(why)}">🔒</button>`
      : '<button type="button" class="icon-btn del-exp" title="امسح">🗑️</button>';
  }

  function nameCell(e) {
    return Utils.escapeHtml(e.category) +
      (e.description ? ' <span class="muted">· ' + Utils.escapeHtml(e.description) + '</span>' : '');
  }

  async function render(container) {
    const presets = await loadPresets();
    const all = await DB.getAll('expenses');
    all.sort((a, b) => new Date(b.date) - new Date(a.date) || Number(b.id) - Number(a.id));
    const today = Utils.todayISO();
    const month = today.slice(0, 7);
    const todayList = all.filter(e => Utils.dateKey(e.date) === today);
    const older = all.filter(e => Utils.dateKey(e.date) !== today).slice(0, 60);
    const todayTotal = todayList.reduce((s, e) => s + Number(e.amount || 0), 0);
    const monthTotal = all.filter(e => Utils.dateKey(e.date).slice(0, 7) === month)
                          .reduce((s, e) => s + Number(e.amount || 0), 0);

    container.innerHTML = `
      <div id="expRoot">
      <div class="card">
        <div class="section-head">
          <h3>مصروف سريع — دوسة واحدة</h3>
          <button type="button" class="btn btn-ghost btn-sm" id="editPresets">${editMode ? '✅ خلصت التعديل' : '✏️ عدّل الأزرار'}</button>
        </div>

        <div class="qx-amount">
          <label for="qxAmount">مبلغ مختلف المرة دي؟</label>
          <input type="number" id="qxAmount" min="0.01" step="0.01" inputmode="decimal"
                 placeholder="سيبه فاضي = السعر اللي على الزرار">
        </div>

        <div class="qx-grid" id="qxGrid">
          ${presets.map((p, i) => `
            <button type="button" class="qx-btn${editMode ? ' editing' : ''}" data-i="${i}">
              <span class="qx-icon">${Utils.escapeHtml(p.icon || '💸')}</span>
              <span class="qx-name">${Utils.escapeHtml(p.name)}</span>
              <span class="qx-price">${Number(p.amount) > 0 ? Utils.formatMoney(p.amount) : 'بيسأل عن المبلغ'}</span>
              ${editMode ? '<span class="qx-edit">✏️ دوس تعدّل أو تمسح</span>' : ''}
            </button>`).join('')}
          ${editMode ? '<button type="button" class="qx-btn qx-add" id="qxAdd"><span class="qx-icon">＋</span><span class="qx-name">زرار جديد</span></button>' : ''}
        </div>

        <div id="qxUndo" class="qx-undo" hidden></div>

        <details class="qx-other">
          <summary>مصروف تاني مش على الأزرار</summary>
          <form id="expForm" class="qx-form" novalidate>
            <div class="field" style="flex:2;">
              <label>إيه</label>
              <input type="text" id="eCategory" placeholder="مثلاً: لمبة للمحل، سباك، كرتونة مية" autocomplete="off">
            </div>
            <div class="field">
              <label>بكام</label>
              <input type="number" id="eAmount" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00">
            </div>
            <div class="field">
              <label>التاريخ</label>
              <input type="date" id="eDate" value="${today}">
            </div>
            <button type="submit" class="btn btn-amber" id="expSave">سجّل</button>
          </form>
        </details>

        <div class="hint" style="margin-top:10px;line-height:1.9;">
          دفعة لمورد؟ من <strong>العملاء والموردين</strong> ← اسم المورد ← سداد.
          سلفة لموظف؟ من شاشة <strong>الموظفين</strong>. دول مش مصروفات.
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:16px;">
        <div class="card">
          <div class="section-head">
            <h3>مصاريف النهارده</h3>
            <strong style="color:var(--danger);font-size:16px;">${Utils.formatMoney(todayTotal)}</strong>
          </div>
          ${todayList.length ? `
          <div class="qx-today">
            ${todayList.map(e => `
              <div class="qx-row" data-id="${e.id}">
                <span class="qx-row-time">${new Date(e.date).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}</span>
                <span class="qx-row-name">${nameCell(e)}</span>
                <span class="qx-row-amt">${Utils.formatMoney(e.amount)}</span>
                ${delBtn(e)}
              </div>`).join('')}
          </div>` : '<div class="empty-state" style="padding:16px;"><div class="ic">☕</div>لسه مفيش مصاريف النهارده</div>'}
          <div class="stat-tile negative" style="margin-top:14px;">
            <div class="lbl">إجمالي مصروفات الشهر</div>
            <div class="val">${Utils.formatMoney(monthTotal)}</div>
          </div>
        </div>

        <div class="card">
          <div class="section-head"><h3>الأيام اللي فاتت</h3><span class="hint">آخر ٦٠ مصروف</span></div>
          <div class="table-wrap" style="border:none;">
            <table>
              <thead><tr><th>التاريخ</th><th>إيه</th><th>بكام</th><th></th></tr></thead>
              <tbody id="expBody">
                ${older.length ? older.map(e => `
                  <tr data-id="${e.id}">
                    <td>${Utils.formatDate(e.date)}</td>
                    <td>${nameCell(e)}</td>
                    <td style="font-weight:700;color:var(--danger);">${Utils.formatMoney(e.amount)}</td>
                    <td>${delBtn(e)}</td>
                  </tr>`).join('') : '<tr class="empty-row"><td colspan="4">مفيش مصاريف قديمة</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      </div>
    `;

    // ---------- الأزرار السريعة ----------
    container.querySelector('#editPresets').addEventListener('click', () => {
      editMode = !editMode; render(container);
    });

    container.querySelector('#qxGrid').addEventListener('click', async (e) => {
      const btn = e.target.closest('.qx-btn');
      if (!btn) return;
      if (btn.id === 'qxAdd') { openPresetDialog(null, presets, container); return; }
      const p = presets[Number(btn.dataset.i)];
      if (!p) return;
      if (editMode) { openPresetDialog(Number(btn.dataset.i), presets, container); return; }
      await quickAdd(container, p);
    });

    // Enter في خانة المبلغ المختلف = مفيش حاجة تتسجل من غير ما يدوس زرار
    container.querySelector('#qxAmount').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); Utils.toast('دلوقتي دوس على زرار المصروف', 'info'); }
    });

    // ---------- الفورم الصغيرة ----------
    Utils.guardSubmit(container.querySelector('#expForm'), async () => {
      const category = container.querySelector('#eCategory').value.trim();
      const amount = Number(container.querySelector('#eAmount').value || 0);
      if (!category) { container.querySelector('#eCategory').focus(); throw new Error('اكتب إيه المصروف'); }
      if (!(amount > 0)) { container.querySelector('#eAmount').focus(); throw new Error('اكتب المبلغ'); }
      const date = dayToISO(container.querySelector('#eDate').value);
      const id = await Services.saveExpense({ category, description: '', amount, date });
      await refreshShell();
      await render(container);
      showUndo(container, id, category, amount);
    });

    // ---------- مسح ----------
    // على #expRoot مش على الحاوية: الشاشة بتتعاد رسمها بعد كل دوسة،
    // ولو ربطنا على الحاوية كل رسمة كانت بتضيف سماعة فوق اللي قبلها
    container.querySelector('#expRoot').addEventListener('click', async (e) => {
      if (e.target.classList.contains('locked-exp')) {
        Utils.toast(e.target.dataset.why || 'المصروف ده مربوط بمستند تاني', 'info');
        return;
      }
      if (!e.target.classList.contains('del-exp')) return;
      const row = e.target.closest('[data-id]');
      const id = Number(row.dataset.id);
      if (!(await Utils.confirmDialog('تمسح المصروف ده؟ فلوسه هترجع للخزنة.'))) return;
      try { await Services.deleteExpense(id); } catch (err) { Utils.toast(err.message, 'error'); return; }
      await refreshShell();
      Utils.toast('اتمسح ورجعت فلوسه للخزنة', 'success');
      render(container);
    });
  }

  /* دوسة على زرار سريع: بنسجّل على طول. المبلغ من الخانة لو كاتب،
     وإلا سعر الزرار. لو الاتنين فاضيين بنطلب المبلغ بس. */
  async function quickAdd(container, p) {
    const box = container.querySelector('#qxAmount');
    let amount = Number(box.value || 0);
    if (!(amount > 0)) amount = Number(p.amount || 0);
    if (!(amount > 0)) {
      Utils.toast('اكتب المبلغ فوق وبعدين دوس "' + p.name + '" تاني', 'info');
      box.focus();
      return;
    }
    container.querySelectorAll('.qx-btn').forEach(b => b.disabled = true);
    try {
      const id = await Services.saveExpense({ category: p.name, description: '', amount, date: Utils.nowISO() });
      Utils.beep('ok');
      await refreshShell();
      await render(container);
      showUndo(container, id, p.name, amount);
    } catch (err) {
      Utils.toast('مااتسجلش: ' + (err.message || ''), 'error');
      container.querySelectorAll('.qx-btn').forEach(b => b.disabled = false);
    }
  }

  /* شريط "اتسجل … — تراجع" لمدة ١٠ ثواني. التراجع بيمسح المصروف
     وبيرجّع فلوسه للخزنة — عشان الدوسة بالغلط ماتبقاش مشكلة. */
  function showUndo(container, id, name, amount) {
    const bar = container.querySelector('#qxUndo');
    if (!bar) return;
    if (lastUndo && lastUndo.timer) clearTimeout(lastUndo.timer);
    bar.hidden = false;
    bar.innerHTML = `✅ اتسجل <strong>${Utils.escapeHtml(name)}</strong> ${Utils.formatMoney(amount)}
      <button type="button" class="btn btn-ghost btn-sm" id="qxUndoBtn">↩︎ تراجع</button>`;
    bar.querySelector('#qxUndoBtn').addEventListener('click', async () => {
      try {
        await Services.deleteExpense(id);
        await refreshShell();
        Utils.toast('اتلغى ورجعت الفلوس للخزنة', 'success');
        lastUndo = null;
        render(container);
      } catch (err) { Utils.toast(err.message, 'error'); }
    });
    lastUndo = { id, timer: setTimeout(() => { if (bar.isConnected) bar.hidden = true; }, 10000) };
  }

  /* إضافة / تعديل / مسح زرار سريع */
  function openPresetDialog(index, presets, container) {
    const p = index != null ? presets[index] : { name: '', amount: '', icon: '' };
    Utils.openModal({
      title: index != null ? 'عدّل الزرار' : 'زرار جديد',
      bodyHtml: `
        <form id="presetForm" novalidate>
          <div class="field-row">
            <div class="field" style="flex:2;"><label>الاسم</label>
              <input type="text" id="ppName" value="${Utils.escapeHtml(p.name)}" placeholder="مثلاً: شاي" autofocus></div>
            <div class="field"><label>السعر المعتاد</label>
              <input type="number" id="ppAmount" min="0" step="0.01" inputmode="decimal"
                     value="${Number(p.amount) > 0 ? p.amount : ''}" placeholder="فاضي = يسأل كل مرة"></div>
            <div class="field" style="max-width:90px;"><label>رمز</label>
              <input type="text" id="ppIcon" value="${Utils.escapeHtml(p.icon || '')}" placeholder="☕" maxlength="4"></div>
          </div>
          <div class="hint">سيب السعر فاضي لو بيختلف كل مرة (زي المواصلات) — هيطلب منك المبلغ وقتها.</div>
          <div class="form-actions">
            ${index != null ? '<button type="button" class="btn btn-danger" id="ppDel">🗑️ امسح الزرار</button>' : ''}
            <button type="submit" class="btn btn-amber">حفظ</button>
          </div>
        </form>`,
      onMount: (body, close) => {
        const del = body.querySelector('#ppDel');
        if (del) del.addEventListener('click', async () => {
          presets.splice(index, 1);
          await savePresets(presets);
          close(); render(container);
        });
        Utils.guardSubmit(body.querySelector('#presetForm'), async () => {
          const name = body.querySelector('#ppName').value.trim();
          if (!name) throw new Error('اكتب اسم الزرار');
          const item = { name, amount: Number(body.querySelector('#ppAmount').value || 0),
                         icon: body.querySelector('#ppIcon').value.trim() };
          if (index != null) presets[index] = item; else presets.push(item);
          await savePresets(presets);
          close(); render(container);
        });
      }
    });
  }

  return { render };
})();
