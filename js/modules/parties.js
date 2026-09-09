Modules.parties = (() => {
  let activeTab = 'customers';
  let viewing = null;      // { kind, id } — فاتح حساب طرف معيّن
  let showVoided = false;  // يوري الحركات الملغية ولا يخبّيها

  /* الرصيد ممكن يبقى بالسالب — يعني الطرف ده دفع أكتر من اللي عليه
     (بيحصل مثلاً لما تلغي فاتورة بعد ما يكون دفعها). لازم يبان بوضوح
     مش يتعرض كأنه "لا يوجد"، عشان متنساش إن ليه فلوس عندك. */
  function balanceBadge(balance, isCustomer) {
    const b = Number(balance || 0);
    if (b > 0) {
      return `<span class="badge badge-warn">${Utils.formatMoney(b)}</span>`;
    }
    if (b < 0) {
      return `<span class="badge badge-credit" title="دفع أكتر من اللي عليه">
        ${isCustomer ? 'ليه عندك' : 'لينا عنده'} ${Utils.formatMoney(Math.abs(b))}</span>`;
    }
    return `<span class="badge badge-ok">مفيش</span>`;
  }

  async function render(container) {
    await AppState.reloadParties();
    // فاتح حساب طرف؟ نرسم شاشة الحساب بدل القايمة
    if (viewing) return renderAccount(container);
    // حسابات الموردين لصاحب المحل بس
    if (Auth.isSeller() && activeTab === 'suppliers') activeTab = 'customers';
    container.innerHTML = `
      <div class="tabs">
        <button data-tab="customers" class="${activeTab === 'customers' ? 'active' : ''}">العملاء (آجل)</button>
        ${Auth.isSeller() ? '' : `<button data-tab="suppliers" class="${activeTab === 'suppliers' ? 'active' : ''}">الموردين (آجل)</button>`}
      </div>
      <div class="section-head">
        <div></div>
        <button class="btn btn-amber" id="addPartyBtn"></button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>الاسم</th><th>التليفون</th><th id="balHead"></th><th></th></tr></thead>
          <tbody id="partyBody"></tbody>
        </table>
      </div>
    `;

    function storeName() { return activeTab; }

    /* الحسابات اللي فيها عمليات مكررة — بنعلّم عليها في القايمة
       عشان يشوفها من بره من غير ما يفتح كل حساب واحد واحد */
    let dupMap = new Map();
    try { dupMap = await Services.duplicatePaymentsAll(activeTab); } catch (e) { }

    function draw() {
      const list = AppState[activeTab];
      const isCust = activeTab === 'customers';
      container.querySelector('#balHead').textContent = isCust ? 'المديونية (له علينا)' : 'المستحق له (علينا له)';
      container.querySelector('#addPartyBtn').textContent = isCust ? '+ عميل جديد' : '+ مورد جديد';
      const tbody = container.querySelector('#partyBody');
      if (!list.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="4">${isCust ? 'مفيش عملاء مسجلين لسه' : 'مفيش موردين مسجلين لسه'}</td></tr>`;
        return;
      }
      tbody.innerHTML = list.map(p => `
        <tr data-id="${p.id}">
          <td><button type="button" class="name-link open-stmt">${Utils.escapeHtml(p.name)}</button>
            ${dupMap.get(p.id) ? `<span class="badge badge-danger dup-flag"
              title="فيه عمليات اتسجلت أكتر من مرة — افتح الحساب وشوفها">⚠️ ${dupMap.get(p.id)} مكرر</span>` : ''}</td>
          <td>${Utils.escapeHtml(p.phone || '—')}</td>
          <td>${balanceBadge(p.balance, isCust)}</td>
          <td>
            ${(p.balance || 0) > 0 ? `<button class="icon-btn settle-btn" title="${isCust ? 'تحصيل' : 'سداد'}">💰</button>` : ''}
            <button class="icon-btn edit-party" title="تعديل">✏️</button>
            <button class="icon-btn del-party" title="حذف">🗑️</button>
          </td>
        </tr>`).join('');
    }
    draw();

    container.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
      activeTab = b.dataset.tab;
      render(container);
    }));

    container.querySelector('#addPartyBtn').addEventListener('click', () => openPartyForm(activeTab, null, () => render(container)));

    container.querySelector('#partyBody').addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const id = Number(tr.dataset.id);
      const party = AppState[activeTab].find(p => p.id === id);
      if (e.target.classList.contains('open-stmt')) {
        viewing = { kind: activeTab, id };
        render(container);
      } else if (e.target.classList.contains('edit-party')) {
        openPartyForm(activeTab, party, () => render(container));
      } else if (e.target.classList.contains('del-party')) {
        if (party.balance) { Utils.toast('مينفعش تحذف طرف عليه أو له رصيد', 'error'); return; }
        const ok = await Utils.confirmDialog(`حذف "${party.name}"؟`);
        if (!ok) return;
        await DB.delete(activeTab, id);
        await AppState.reloadParties();
        draw();
        Utils.toast('تم الحذف', 'success');
      } else if (e.target.classList.contains('settle-btn')) {
        openSettleModal(activeTab, party, () => render(container));
      }
    });
  }

  /* ================= شاشة حساب الطرف =================

     قبل كده لما كان بيدوس على مورد كان بيفتحله كشف حساب للفرجة بس،
     ولو فيه حاجة غلط مكانش قدامه أي حاجة يعملها. دلوقتي كل حركة
     في الحساب قدامها الأزرار بتاعتها: يعدّلها، يلغيها، يفتح الفاتورة.
     وفوق: يسجّل دفعة (بأي تاريخ) أو يرد فلوس. */

  function money(v) { return Utils.formatMoney(Math.abs(Number(v || 0))); }

  // اسم الحركة وشكلها في الكشف
  function entryLabel(e, isCust) {
    if (e.kind === 'opening') return `<span class="pay-chip open-chip">رصيد افتتاحي</span>
      <div class="inv-sub">دين قديم من قبل البرنامج</div>`;
    if (e.kind === 'doc') return `<span class="stmt-link">${Utils.escapeHtml(e.number || '')}</span>
      ${e.voided ? '<span class="badge badge-danger">ملغاة</span>' : ''}
      <div class="inv-sub">إجمالي ${money(e.total)} · مدفوع وقتها ${money(e.paidNow)}</div>`;
    if (e.kind === 'return') return `<span class="pay-chip">${Utils.escapeHtml(e.number || 'مرتجع')}</span>
      <div class="inv-sub">مرتجع على الحساب</div>`;
    if (e.kind === 'reversal') return `<span class="badge badge-void">سطر إلغاء</span>
      <div class="inv-sub">${Utils.escapeHtml(e.note || '')}</div>`;
    if (e.kind === 'refund') return `<span class="pay-chip open-chip">${isCust ? 'رد فلوس للعميل' : 'استرداد من المورد'}</span>
      ${e.voided ? '<span class="badge badge-danger">ملغية</span>' : ''}
      <div class="inv-sub">${Utils.escapeHtml(e.note || '')}</div>`;
    return `<span class="pay-chip">${isCust ? 'تحصيل' : 'سداد'}</span>
      ${e.voided ? '<span class="badge badge-danger">ملغية</span>' : ''}
      <div class="inv-sub">${Utils.escapeHtml(e.note || '')}</div>`;
  }

  async function renderAccount(container) {
    const { kind, id } = viewing;
    const isCust = kind === 'customers';
    if (!isCust && !(await Auth.requireOwner('حساب المورد'))) { viewing = null; return render(container); }

    let led, dupGroups = [];
    try {
      led = await Services.partyLedger(kind, id);
      dupGroups = await Services.duplicatePayments(kind, id);
    }
    catch (err) { Utils.toast(err.message, 'error'); viewing = null; return render(container); }
    const dupExtra = dupGroups.reduce((s, g) => s + g.moves.length - 1, 0);
    const dupMoney = dupGroups.reduce((s, g) => s + g.amount * (g.moves.length - 1), 0);

    const p = led.party;
    const bal = Number(p.balance || 0);
    /* الرصيد المسجّل المفروض يساوي مجموع الحركات. لو مش متساويين
       يبقى فيه حاجة غلط ولازم يعرف — ده اللي بيحصل مثلاً لو عملية
       اتسجلت نص نص. مش بنخبّي المشكلة. */
    const drift = Math.round((led.computed - led.stored) * 100) / 100;

    const rows = led.entries.filter(e => showVoided || (!e.voided && e.kind !== 'reversal'));
    const hidden = led.entries.length - rows.length;

    const owedLabel = bal > 0
      ? (isCust ? 'له عندك دين' : 'عليك له')
      : bal < 0 ? (isCust ? 'ليه عندك فلوس' : 'لينا عنده فلوس') : 'الحساب مقفول';

    container.innerHTML = `
      <div class="acct-top">
        <button type="button" class="btn btn-ghost btn-sm" id="backList">← رجوع للقايمة</button>
        <button type="button" class="btn btn-ghost btn-sm" id="editInfo">✏️ الاسم والتليفون</button>
      </div>

      <div class="card acct-head">
        <div>
          <h3>${Utils.escapeHtml(p.name)}</h3>
          <div class="hint">${Utils.escapeHtml(p.phone || 'مفيش تليفون مسجّل')}</div>
        </div>
        <div class="acct-bal ${bal > 0 ? 'owe' : bal < 0 ? 'credit' : ''}">
          <span class="acct-bal-lbl">${owedLabel}</span>
          <strong>${money(bal)}</strong>
        </div>
        <div class="acct-actions">
          <button class="btn btn-amber" id="actPay">${isCust ? '＋ تحصيل منه' : '＋ سداد له'}</button>
          <button class="btn btn-ghost" id="actRefund">↩︎ ${isCust ? 'رد فلوس له' : 'استرداد منه'}</button>
        </div>
      </div>

      ${dupExtra > 0 ? `
      <div class="notice-danger" id="dupBox">
        <strong>فيه ${dupExtra} ${dupExtra === 1 ? 'عملية' : 'عمليات'} شكلها اتسجلت أكتر من مرة بالغلط</strong>
        <div class="hint">
          ${dupGroups.map(g => `${g.moves.length} مرة بمبلغ ${money(g.amount)}`).join(' · ')}
          — بمجموع ${money(dupMoney)} زيادة.
          ده بيحصل لما تدوس "حفظ" أكتر من مرة وهو بطيء.
        </div>
        <button type="button" class="btn btn-sm btn-danger" id="dropDups">
          سيب واحدة من كل مجموعة وألغي الباقي
        </button>
      </div>` : ''}

      ${Math.abs(drift) > 0.005 ? `
      <div class="notice-danger" id="driftBox">
        <strong>الرصيد المسجّل مش مطابق لمجموع الحركات</strong>
        <div class="hint">المسجّل ${money(led.stored)} · ومجموع الحركات ${money(led.computed)}
          · الفرق ${money(drift)}</div>
        <button type="button" class="btn btn-sm btn-danger" id="fixDrift">ظبّط الرصيد على مجموع الحركات</button>
      </div>` : ''}

      <div class="section-head">
        <label class="void-toggle">
          <input type="checkbox" id="showVoid" ${showVoided ? 'checked' : ''}>
          وريني الملغي كمان ${hidden > 0 ? `(${hidden} مخبّي)` : ''}
        </label>
        <span class="hint">${rows.length} حركة</span>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>التاريخ</th><th>البيان</th>
            <th class="num-cell">${isCust ? 'اتباع له' : 'اشتريت منه'}</th>
            <th class="num-cell">${isCust ? 'دفع' : 'دفعت له'}</th>
            <th class="num-cell">الرصيد</th><th></th>
          </tr></thead>
          <tbody id="ledBody">
            ${rows.length ? rows.map(e => `
              <tr class="stmt-row ${e.voided || e.kind === 'reversal' ? 'voided' : ''}"
                  ${e.docId && e.kind === 'doc' ? `data-doc="${e.docId}"` : ''}
                  ${e.moveId ? `data-move="${e.moveId}"` : ''}>
                <td>${Utils.formatDate(e.date)}</td>
                <td>${entryLabel(e, isCust)}</td>
                <td class="num-cell debit">${e.debit ? money(e.debit) : ''}</td>
                <td class="num-cell credit">${e.credit ? money(e.credit) : ''}</td>
                <td class="num-cell strong">${money(e.running)}</td>
                <td class="num-cell">
                  ${(e.kind === 'pay' || e.kind === 'refund') && !e.voided ? `
                    <button class="icon-btn edit-move" title="تعديل">✏️</button>
                    <button class="icon-btn void-move" title="إلغاء">🗑️</button>` : ''}
                  ${e.kind === 'doc' ? '<button class="icon-btn open-doc" title="افتح الفاتورة">🧾</button>' : ''}
                </td>
              </tr>`).join('')
            : '<tr class="empty-row"><td colspan="6">مفيش حركات على الحساب ده لسه</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    const back = () => { activeTab = kind; viewing = null; render(container); };
    container.querySelector('#backList').addEventListener('click', back);
    container.querySelector('#editInfo').addEventListener('click', () =>
      openPartyForm(kind, p, () => render(container)));
    container.querySelector('#showVoid').addEventListener('change', (e) => {
      showVoided = e.target.checked; render(container);
    });
    container.querySelector('#actPay').addEventListener('click', () =>
      openSettleModal(kind, p, () => render(container)));
    container.querySelector('#actRefund').addEventListener('click', () =>
      openRefundModal(kind, p, () => render(container)));

    const dropDups = container.querySelector('#dropDups');
    if (dropDups) dropDups.addEventListener('click', async () => {
      const ok = await Utils.confirmDialog(
        `هنسيب أول عملية في كل مجموعة ونلغي اللي بعدها (${dupExtra} عملية).\n\n` +
        `${money(dupMoney)} هترجع للخزنة، والرصيد هيتظبط.\n\n` +
        `الملغي هيفضل باين في الدفتر — مش بنمسح حاجة.`);
      if (!ok) return;
      try {
        const res = await Services.dropDuplicatePayments(kind, id);
        await AppState.reloadParties();
        await refreshShell();
        Utils.toast(`اتلغى ${res.removed} · رجع ${money(res.amount)} للخزنة`, 'success');
        render(container);
      } catch (err) { Utils.toast(err.message, 'error'); }
    });

    const fix = container.querySelector('#fixDrift');
    if (fix) fix.addEventListener('click', async () => {
      const ok = await Utils.confirmDialog(
        `هنخلي الرصيد المسجّل = ${money(led.computed)} (مجموع كل الحركات).\n\n` +
        `ده بيصلّح الرقم بس — الحركات نفسها هتفضل زي ما هي.`);
      if (!ok) return;
      const row = await DB.get(kind, id);
      row.balance = led.computed;
      await DB.put(kind, row);
      await AppState.reloadParties();
      Utils.toast('الرصيد اتظبط', 'success');
      render(container);
    });

    container.querySelector('#ledBody').addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const moveId = Number(tr.dataset.move);
      if (e.target.classList.contains('open-doc')) {
        Views.showInvoice(isCust ? 'sales' : 'purchases', Number(tr.dataset.doc));
      } else if (e.target.classList.contains('void-move')) {
        const ent = led.entries.find(x => Number(x.moveId) === moveId);
        const ok = await Utils.confirmDialog(
          `هتلغي عملية بمبلغ ${money(ent.amount)}؟\n\n` +
          `الفلوس هترجع للخزنة، والرصيد هيرجع زي ما كان.\n` +
          `العملية هتفضل باينة في الدفتر إنها اتلغت.`);
        if (!ok) return;
        try {
          await Services.voidPartyPayment(moveId);
          await AppState.reloadParties();
          await refreshShell();
          Utils.toast('العملية اتلغت والفلوس رجعت', 'success');
          render(container);
        } catch (err) { Utils.toast(err.message, 'error'); }
      } else if (e.target.classList.contains('edit-move')) {
        const ent = led.entries.find(x => Number(x.moveId) === moveId);
        openEditMoveModal(ent, () => render(container));
      }
    });
  }

  /* تعديل دفعة: المبلغ أو التاريخ أو البيان */
  function openEditMoveModal(ent, onDone) {
    Utils.openModal({
      title: 'تعديل العملية',
      bodyHtml: `
        <form id="editMoveForm">
          <div class="field"><label>المبلغ</label>
            <input type="number" id="emAmount" min="0.01" step="0.01"
                   value="${Number(ent.amount || 0)}" inputmode="decimal" autofocus></div>
          <div class="field"><label>التاريخ</label>
            <input type="date" id="emDate" value="${String(ent.date || '').slice(0, 10)}"></div>
          <div class="field"><label>البيان</label>
            <input type="text" id="emNote" value="${Utils.escapeHtml(ent.note || '')}"></div>
          <div class="hint">التعديل بيتسجّل في الدفتر: القديمة بتترجع والجديدة بتتكتب،
            عشان يفضل باين إن فيه تعديل حصل.</div>
          <div class="form-actions">
            <button type="submit" class="btn btn-amber">احفظ التعديل</button>
          </div>
        </form>`,
      onMount: (body, close) => {
        Utils.guardSubmit(body.querySelector('#editMoveForm'), async () => {
          const amount = Number(body.querySelector('#emAmount').value || 0);
          if (!(amount > 0)) { Utils.toast('اكتب مبلغ صحيح', 'error'); return; }
          const dayStr = body.querySelector('#emDate').value;
          // تاريخ من غير وقت بيخلي الترتيب يلخبط — بناخد وقت الأصلية
          const date = dayStr ? dayStr + String(ent.date || '').slice(10) : ent.date;
          await Services.editPartyPayment(ent.moveId, {
            amount, date, note: body.querySelector('#emNote').value.trim()
          });
          await AppState.reloadParties();
          await refreshShell();
          Utils.toast('العملية اتعدلت', 'success');
          close();
          onDone();
        });
      }
    });
  }

  /* رد الفلوس: المورد رجّعلك، أو انت رجّعت لعميل */
  function openRefundModal(kind, party, onDone) {
    const isCust = kind === 'customers';
    const bal = Number(party.balance || 0);
    Utils.openModal({
      title: isCust ? `رد فلوس لـ ${party.name}` : `استرداد فلوس من ${party.name}`,
      bodyHtml: `
        <form id="refundForm">
          <p class="muted" style="font-size:13px;">الرصيد الحالي: <strong>${money(bal)}</strong>
            ${bal < 0 ? (isCust ? ' (ليه عندك)' : ' (لينا عنده)') : ''}</p>
          <div class="field"><label>المبلغ</label>
            <input type="number" id="rfAmount" min="0.01" step="0.01"
                   value="${bal < 0 ? Math.abs(bal) : ''}" inputmode="decimal" autofocus></div>
          <div class="field"><label>التاريخ</label>
            <input type="date" id="rfDate" value="${Utils.todayISO()}"></div>
          <div class="field"><label>البيان</label>
            <input type="text" id="rfNote"
                   value="${isCust ? 'رد فلوس لـ ' : 'استرداد من '}${Utils.escapeHtml(party.name)}"></div>
          <div class="hint">${isCust
            ? 'فلوس هتخرج من الخزنة وترجع للعميل، والدين بتاعه هيزيد بنفس المبلغ.'
            : 'فلوس هتدخل الخزنة من المورد، واللي انت دافعه زيادة هيقل بنفس المبلغ.'}</div>
          <div class="form-actions">
            <button type="submit" class="btn btn-amber">تسجيل</button>
          </div>
        </form>`,
      onMount: (body, close) => {
        Utils.guardSubmit(body.querySelector('#refundForm'), async () => {
          const amount = Number(body.querySelector('#rfAmount').value || 0);
          if (!(amount > 0)) { Utils.toast('اكتب مبلغ صحيح', 'error'); return; }
          const day = body.querySelector('#rfDate').value;
          await Services.refundParty(kind, party.id, amount,
            body.querySelector('#rfNote').value.trim(),
            day ? day + 'T' + new Date().toISOString().slice(11) : undefined);
          await AppState.reloadParties();
          await refreshShell();
          Utils.toast('اتسجّل', 'success');
          close();
          onDone();
        });
      }
    });
  }

  function openPartyForm(store, party, onDone) {
    return new Promise((resolve) => {
      const isCust = store === 'customers';
      const { close } = Utils.openModal({
        title: party ? 'تعديل بيانات' : (isCust ? 'عميل جديد' : 'مورد جديد'),
        bodyHtml: `
          <form id="partyForm">
            <div class="field"><label>الاسم</label><input type="text" id="pName" value="${Utils.escapeHtml(party?.name || '')}" required autofocus></div>
            <div class="field"><label>التليفون</label><input type="text" id="pPhone" value="${Utils.escapeHtml(party?.phone || '')}"></div>
            ${party ? '' : `
            <div class="field">
              <label>رصيد افتتاحي <span class="muted">(دين قديم من قبل البرنامج)</span></label>
              <input type="number" id="pOpening" min="0" step="0.01" placeholder="0.00" inputmode="decimal">
              <div class="hint">${isCust
                ? 'لو العميل ده عليه فلوس ليك من قبل ما تستخدم البرنامج، اكتبها هنا.'
                : 'لو انت عليك فلوس للمورد ده من قبل البرنامج، اكتبها هنا.'}
                المبلغ ده مش هيتحسب في الخزنة — هو دين قديم بس.</div>
            </div>`}
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" id="cancelParty">إلغاء</button>
              <button type="submit" class="btn btn-amber">حفظ</button>
            </div>
          </form>`,
        onMount: (body) => {
          body.querySelector('#cancelParty').addEventListener('click', () => { close(); resolve(null); });
          Utils.guardSubmit(body.querySelector('#partyForm'), async () => {
            const name = body.querySelector('#pName').value.trim();
            if (!name) { Utils.toast('الاسم مطلوب', 'error'); return; }
            const payload = { name, phone: body.querySelector('#pPhone').value.trim() };
            if (party) {
              payload.id = party.id;
              payload.balance = party.balance || 0;
              payload.openingBalance = party.openingBalance || 0;
            } else {
              // الرصيد الافتتاحي دين قديم — بيتسجل على الطرف من غير ما يمس الخزنة
              const opening = Number(body.querySelector('#pOpening').value || 0);
              payload.balance = opening;
              payload.openingBalance = opening;
              payload.openingDate = Utils.nowISO();
            }
            const id = await DB.put(store, payload);
            await AppState.reloadParties();
            Utils.toast('تم الحفظ', 'success');
            close();
            if (onDone) onDone();
            resolve(AppState[store].find(p => p.id === (party ? party.id : id)));
          });
        }
      });
    });
  }

  function openSettleModal(store, party, onDone) {
    const isCust = store === 'customers';
    const bal = Number(party.balance || 0);
    Utils.openModal({
      title: `${isCust ? 'تحصيل من' : 'سداد لـ'} ${party.name}`,
      bodyHtml: `
        <form id="settleForm">
          <p class="muted" style="font-size:13px;">الرصيد الحالي: <strong>${money(bal)}</strong></p>
          <div class="field">
            <label>المبلغ</label>
            <input type="number" id="settleAmount" min="0.01" step="0.01"
                   value="${bal > 0 ? bal : ''}" inputmode="decimal" autofocus>
            <span class="hint">لو ${isCust ? 'دفعلك' : 'دفعت'} أكتر من الرصيد، الزيادة هتتسجّل ${isCust ? 'أمانة عندك' : 'مقدّم عند المورد'}</span>
          </div>
          <div class="field">
            <label>التاريخ</label>
            <input type="date" id="settleDate" value="${Utils.todayISO()}">
            <span class="hint">لو الدفعة اتدفعت من كام يوم وناسي تكتبها، غيّر التاريخ هنا
              وهي هتتحط في مكانها الصح في الدفتر.</span>
          </div>
          <div class="field">
            <label>البيان</label>
            <input type="text" id="settleNote"
                   value="${isCust ? 'تحصيل من ' : 'سداد لـ '}${Utils.escapeHtml(party.name)}">
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-amber">${isCust ? 'تسجيل التحصيل' : 'تسجيل السداد'}</button>
          </div>
        </form>`,
      onMount: (body, close) => {
        Utils.guardSubmit(body.querySelector('#settleForm'), async () => {
          const amount = Number(body.querySelector('#settleAmount').value || 0);
          if (amount <= 0) { Utils.toast('اكتب مبلغ صحيح', 'error'); return; }

          /* حماية من تسجيل نفس الدفعة مرتين. حصلت فعلاً: دفعة
             اتسجلت ١١ مرة لأن الحفظ كان بيعلّق فدوس كذا مرة. */
          const dups = await Services.recentSamePayment(store, party.id, amount);
          if (dups.length) {
            const ok = await Utils.confirmDialog(
              `انتبه: فيه ${dups.length === 1 ? 'عملية' : dups.length + ' عمليات'} ` +
              `بنفس المبلغ (${money(amount)}) اتسجلت لـ ${party.name} من شوية.\n\n` +
              `آخر واحدة: ${Utils.formatDateTime(dups[dups.length - 1].date)}\n\n` +
              `أكيد دي دفعة تانية غيرها؟`);
            if (!ok) return;
          }

          /* الزيادة عن الرصيد مسموحة — بتحصل كتير في المحل — بس
             لازم يعرف إنها أمانة مش إيراد، عشان ميحسبهاش ربح */
          const extra = Math.round((amount - bal) * 100) / 100;
          if (extra > 0.005) {
            const ok = await Utils.confirmDialog(
              `الرصيد ${money(bal)} والمبلغ ${money(amount)}.\n\n` +
              `الزيادة ${money(extra)} هتتسجّل ` +
              (isCust ? 'أمانة عندك للعميل — تخصمها من مشترياته الجاية أو ترجّعهاله.'
                      : 'مقدّم عند المورد — يتخصم من فواتيرك الجاية.') +
              `\n\nنكمّل؟`);
            if (!ok) return;
          }

          const day = body.querySelector('#settleDate').value;
          const date = day ? day + 'T' + new Date().toISOString().slice(11) : undefined;
          const note = body.querySelector('#settleNote').value.trim();
          if (isCust) await Services.collectFromCustomer(party.id, amount, note, date);
          else await Services.payToSupplier(party.id, amount, note, date);
          await AppState.reloadParties();
          await refreshShell();
          Utils.toast('تم التسجيل', 'success');
          close();
          onDone();
        });
      }
    });
  }

  /* openAccount: عشان أي شاشة تانية تقدر تفتح حساب الطرف على طول.
     بنظبط التبويب كمان عشان لما يدوس "رجوع" يلاقي نفسه في
     القايمة الصح — مش في العملاء وهو كان جوّه مورد. */
  function openAccount(kind, id) { activeTab = kind; viewing = { kind, id }; }

  return { render, openPartyForm, openAccount };
})();
