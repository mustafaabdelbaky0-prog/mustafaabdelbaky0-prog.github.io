Modules.treasury = (() => {

  const SOURCE_LABELS = {
    sale: 'بيع', purchase: 'شراء', expense: 'مصروف',
    deposit: 'إيداع', withdrawal: 'سحب', collect: 'تحصيل من عميل', pay: 'سداد لمورد',
    advance: 'سلفة موظف', salary: 'صرف لموظف', adjust: 'تسوية'
  };

  // الحركة دي جاية منين — وتتعدّل من فين
  const SOURCE_ORIGIN = {
    sale: 'دي من فاتورة بيع — عدّلها أو امسحها من نقطة البيع',
    purchase: 'دي من فاتورة شراء — عدّلها أو امسحها من المشتريات',
    expense: 'ده مصروف — امسحه من شاشة المصروفات',
    collect: 'ده تحصيل من عميل — من شاشة العملاء والموردين',
    pay: 'ده سداد لمورد — من شاشة العملاء والموردين',
    advance: 'دي سلفة موظف — من كشف حساب الموظف',
    salary: 'ده صرف لموظف — من كشف حساب الموظف',
    adjust: 'دي تسوية تلقائية — مش بتتعدّل بالإيد'
  };

  // الفلاتر بتفضل زي ما سيبتها وانت بتروح وترجع للشاشة
  let q = '', fromDate = '', toDate = '';

  function matches(m, names) {
    if (fromDate && Utils.dateKey(m.date) < fromDate) return false;
    if (toDate && Utils.dateKey(m.date) > toDate) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [
      m.name || '', m.note || '', SOURCE_LABELS[m.source] || m.source || '',
      names.get(String(m.id)) || '', String(m.amount || '')
    ].join(' ').toLowerCase().includes(needle);
  }

  async function render(container) {
    const balance = await Services.getCashBalance();
    const all = await DB.getAll('treasury');
    all.sort((a, b) => new Date(b.date) - new Date(a.date));

    /* الحركات اللي جاية من مستند مالهاش "اسم" متكتب، فبنجيب اسم
       الطرف المرتبط بيها عشان البحث بالاسم يلاقيها هي كمان. */
    const [custs, sups, emps] = await Promise.all([
      DB.getAll('customers'), DB.getAll('suppliers'), DB.getAll('employees')
    ]);
    const mapOf = (list) => new Map(list.map(x => [Number(x.id), x.name]));
    const cMap = mapOf(custs), sMap = mapOf(sups), eMap = mapOf(emps);
    const linked = new Map();
    for (const m of all) {
      let n = '';
      if (m.source === 'collect') n = cMap.get(Number(m.refId)) || '';
      else if (m.source === 'pay') n = sMap.get(Number(m.refId)) || '';
      else if (['advance', 'salary', 'adjust'].includes(m.source)) n = eMap.get(Number(m.refId)) || '';
      linked.set(String(m.id), n);
    }

    const shown = all.filter(m => matches(m, linked));
    const filtering = !!(q || fromDate || toDate);
    const shownIn = shown.filter(m => m.direction === 'in').reduce((s, m) => s + m.amount, 0);
    const shownOut = shown.filter(m => m.direction === 'out').reduce((s, m) => s + m.amount, 0);

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

      <div class="card" style="padding:14px;margin-bottom:14px;">
        <div class="filter-row">
          <div class="field" style="margin:0;flex:2;min-width:190px;">
            <label>بحث بالاسم أو البيان</label>
            <input type="text" id="trQ" value="${Utils.escapeHtml(q)}" placeholder="اكتب اسم أو مبلغ أو نوع الحركة" autocomplete="off">
          </div>
          <div class="field" style="margin:0;min-width:150px;">
            <label>من تاريخ</label>
            <input type="date" id="trFrom" value="${fromDate}">
          </div>
          <div class="field" style="margin:0;min-width:150px;">
            <label>لغاية</label>
            <input type="date" id="trTo" value="${toDate}">
          </div>
          <button class="btn btn-ghost" id="trClear" ${filtering ? '' : 'disabled'}>امسح البحث</button>
        </div>
        ${filtering ? `
          <div class="notice notice-ok" style="margin:12px 0 0;line-height:1.9;">
            <strong>${shown.length}</strong> حركة طلعت في البحث ·
            داخل <strong style="color:var(--success);">${Utils.formatMoney(shownIn)}</strong> ·
            خارج <strong style="color:var(--danger);">${Utils.formatMoney(shownOut)}</strong>
          </div>` : ''}
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr><th>التاريخ</th><th>البيان</th><th>الاسم</th><th>ملاحظة</th><th>داخل</th><th>خارج</th><th>الرصيد بعدها</th><th></th></tr></thead>
          <tbody id="trBody">
            ${shown.length ? shown.map(m => {
              const manual = Services.isManualMove(m);
              const who = (m.name || '').trim() || linked.get(String(m.id)) || '';
              return `
              <tr data-id="${m.id}">
                <td>${Utils.formatDateTime(m.date)}</td>
                <td><span class="badge badge-muted">${SOURCE_LABELS[m.source] || m.source}</span></td>
                <td>${who ? Utils.escapeHtml(who) : '<span class="muted">—</span>'}</td>
                <td>${Utils.escapeHtml(m.note || '—')}</td>
                <td style="color:var(--success);font-weight:700;">${m.direction === 'in' ? Utils.formatMoney(m.amount) : ''}</td>
                <td style="color:var(--danger);font-weight:700;">${m.direction === 'out' ? Utils.formatMoney(m.amount) : ''}</td>
                <td>${Utils.formatMoney(m.balanceAfter)}</td>
                <td>
                  ${manual
                    ? `<button class="icon-btn edit-move" title="تعديل">✏️</button>
                       <button class="icon-btn del-move" title="حذف">🗑️</button>`
                    : `<button class="icon-btn why-move" title="${Utils.escapeHtml(SOURCE_ORIGIN[m.source] || 'حركة مربوطة بمستند')}">🔒</button>`}
                </td>
              </tr>`; }).join('')
              : `<tr class="empty-row"><td colspan="8">${filtering ? 'مفيش حركة بالمواصفات دي' : 'مفيش حركة على الخزنة لسه'}</td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    await drawDayClose(container);

    container.querySelector('#depositBtn').addEventListener('click', () => openMoveModal('in', container));
    container.querySelector('#withdrawBtn').addEventListener('click', () => openMoveModal('out', container));

    // ---------- البحث ----------
    const qEl = container.querySelector('#trQ');
    let timer = null;
    qEl.addEventListener('input', () => {
      clearTimeout(timer);
      // بنستنى شوية عشان الجدول مايترسمش مع كل حرف
      timer = setTimeout(() => {
        q = qEl.value;
        render(container).then(() => {
          const el = container.querySelector('#trQ');
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        });
      }, 250);
    });
    container.querySelector('#trFrom').addEventListener('change', (e) => { fromDate = e.target.value; render(container); });
    container.querySelector('#trTo').addEventListener('change', (e) => { toDate = e.target.value; render(container); });
    container.querySelector('#trClear').addEventListener('click', () => {
      q = ''; fromDate = ''; toDate = ''; render(container);
    });

    // ---------- تعديل / حذف ----------
    container.querySelector('#trBody').addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      if (!tr || !tr.dataset.id) return;
      const id = Number(tr.dataset.id);
      const move = all.find(m => Number(m.id) === id);
      if (!move) return;

      if (e.target.classList.contains('why-move')) {
        Utils.toast(SOURCE_ORIGIN[move.source] || 'الحركة دي مربوطة بمستند — عدّلها من مكانها', 'info');
      } else if (e.target.classList.contains('edit-move')) {
        openMoveModal(move.direction, container, move);
      } else if (e.target.classList.contains('del-move')) {
        const ok = await Utils.confirmDialog(
          `تمسح الحركة دي؟\n\n${SOURCE_LABELS[move.source]} · ${Utils.formatMoney(move.amount)}` +
          `${move.name ? ' · ' + move.name : ''}\n\nرصيد الخزنة هيتظبط لوحده.`);
        if (!ok) return;
        try {
          await Services.deleteTreasuryMove(id);
          await refreshShell();
          Utils.toast('اتمسحت الحركة', 'success');
          render(container);
        } catch (err) { Utils.toast(err.message || 'المسح مانجحش', 'error'); }
      }
    });
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

  function openMoveModal(direction, container, editMove) {
    const isIn = direction === 'in';
    const editing = !!editMove;
    Utils.openModal({
      title: editing
        ? 'تعديل حركة الخزنة'
        : (isIn ? 'إيداع في الخزنة' : 'سحب من الخزنة'),
      bodyHtml: `
        <form id="moveForm">
          <div class="field">
            <label>نوع الحركة</label>
            <select id="mDir">
              <option value="in" ${isIn ? 'selected' : ''}>إيداع (فلوس داخلة)</option>
              <option value="out" ${!isIn ? 'selected' : ''}>سحب (فلوس خارجة)</option>
            </select>
          </div>
          <div class="field">
            <label>الفلوس دي إيه؟</label>
            <select id="mKind">
              <option value="">حركة عادية</option>
              <option value="capital" ${editing && editMove.kind === 'capital' ? 'selected' : ''}>رأس مال — فلوس من جيبي للمحل</option>
              <option value="drawings" ${editing && editMove.kind === 'drawings' ? 'selected' : ''}>مسحوبات شخصية — فلوس من المحل ليا</option>
            </select>
            <div class="hint" id="kindHint"></div>
          </div>
          <div class="field">
            <label>التاريخ</label>
            <input type="date" id="mDate" value="${editing ? Utils.dateKey(editMove.date) : Utils.todayISO()}">
          </div>
          <div class="field">
            <label>الاسم <span class="muted">(مين؟ — عشان تلاقيها بالبحث بعدين)</span></label>
            <input type="text" id="mName" value="${editing ? Utils.escapeHtml(editMove.name || '') : ''}" placeholder="مثلاً: مصطفى / محل الجيران" autocomplete="off">
          </div>
          <div class="field">
            <label>المبلغ</label>
            <input type="number" id="mAmount" min="0.01" step="0.01" value="${editing ? editMove.amount : ''}" ${editing ? '' : 'autofocus'}>
          </div>
          <div class="field">
            <label>ملاحظة (اختياري)</label>
            <input type="text" id="mNote" value="${editing ? Utils.escapeHtml(editMove.note || '') : ''}" placeholder="${isIn ? 'مثلاً: ضخ رأس مال إضافي' : 'مثلاً: سحب شخصي'}">
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" id="mCancel">إلغاء</button>
            <button type="submit" class="btn btn-amber" id="mSave">${editing ? 'حفظ التعديل' : 'تسجيل'}</button>
          </div>
        </form>`,
      onMount: (body, close) => {
        const dirEl = body.querySelector('#mDir');
        const kindEl = body.querySelector('#mKind');
        const kindHint = body.querySelector('#kindHint');
        const saveBtn = body.querySelector('#mSave');

        /* التفرقة دي مهمة في الحسابات: رأس المال والمسحوبات مش مصروف
           ولا إيراد — دول حساب صاحب المحل، وبيبانوا في المركز المالي. */
        function syncKind() {
          const k = kindEl.value;
          // رأس المال دايمًا داخل، والمسحوبات دايمًا خارجة
          if (k === 'capital') dirEl.value = 'in';
          if (k === 'drawings') dirEl.value = 'out';
          dirEl.disabled = !!k;
          kindHint.textContent = k === 'capital'
            ? 'هتزوّد رأس مالك في المحل — مش إيراد ومش هتتحسب ربح'
            : (k === 'drawings'
              ? 'هتقلّل حقك في المحل — مش مصروف ومش هتقلّل الأرباح'
              : '');
          syncBtn();
        }
        function syncBtn() {
          if (editing) return;
          const inNow = dirEl.value === 'in';
          saveBtn.textContent = inNow ? 'تسجيل الإيداع' : 'تسجيل السحب';
          saveBtn.className = 'btn ' + (inNow ? 'btn-success' : 'btn-danger');
        }
        dirEl.addEventListener('change', syncBtn);
        kindEl.addEventListener('change', syncKind);
        syncKind();
        body.querySelector('#mCancel').addEventListener('click', close);

        body.querySelector('#moveForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const amount = Number(body.querySelector('#mAmount').value || 0);
          if (amount <= 0) { Utils.toast('اكتب مبلغ صحيح', 'error'); return; }
          const dv = body.querySelector('#mDate').value;
          const date = dv ? new Date(dv + 'T12:00:00').toISOString() : Utils.nowISO();
          const name = body.querySelector('#mName').value.trim();
          const note = body.querySelector('#mNote').value.trim();
          const dir = dirEl.value;
          const kind = kindEl.value || null;
          try {
            if (editing) await Services.updateTreasuryMove(editMove.id, { direction: dir, amount, name, note, date, kind });
            else await Services.manualTreasuryMove(dir, amount, note, name, date, kind);
            await refreshShell();
            Utils.toast(editing ? 'اتعدّلت الحركة' : 'تم التسجيل', 'success');
            close();
            render(container);
          } catch (err) {
            Utils.toast(err.message || 'مانجحش', 'error');
          }
        });
      }
    });
  }

  return { render };
})();
