Modules.parties = (() => {
  let activeTab = 'customers';

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
          <td><button type="button" class="name-link open-stmt">${Utils.escapeHtml(p.name)}</button></td>
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
        Views.showStatement(activeTab, id);
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
          body.querySelector('#partyForm').addEventListener('submit', async (e) => {
            e.preventDefault();
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
    Utils.openModal({
      title: `${isCust ? 'تحصيل من' : 'سداد لـ'} ${party.name}`,
      bodyHtml: `
        <form id="settleForm">
          <p class="muted" style="font-size:13px;">الرصيد الحالي: <strong>${Utils.formatMoney(party.balance)}</strong></p>
          <div class="field">
            <label>المبلغ</label>
            <input type="number" id="settleAmount" min="0.01" max="${party.balance}" step="0.01" value="${party.balance}" autofocus>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-amber">${isCust ? 'تسجيل التحصيل' : 'تسجيل السداد'}</button>
          </div>
        </form>`,
      onMount: (body, close) => {
        body.querySelector('#settleForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const amount = Number(body.querySelector('#settleAmount').value || 0);
          if (amount <= 0 || amount > party.balance) { Utils.toast('مبلغ غير صحيح', 'error'); return; }
          if (isCust) await Services.collectFromCustomer(party.id, amount, 'تحصيل من ' + party.name);
          else await Services.payToSupplier(party.id, amount, 'سداد لـ ' + party.name);
          await AppState.reloadParties();
          await refreshShell();
          Utils.toast('تم التسجيل', 'success');
          close();
          onDone();
        });
      }
    });
  }

  return { render, openPartyForm };
})();
