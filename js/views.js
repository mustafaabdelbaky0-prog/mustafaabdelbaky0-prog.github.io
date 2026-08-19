/* شاشات العرض المشتركة:
   - كشف حساب العميل/المورد (فواتير + دفعات + رصيد جاري)
   - تفاصيل الفاتورة (بنودها)
   الاتنين بيتفتحوا من أكتر من مكان، عشان كده هنا مش جوه شاشة معينة. */

const Views = (() => {

  const DOC_LABEL = { sales: 'فاتورة بيع', purchases: 'فاتورة شراء' };

  // الرصيد السالب معناه إنه دفع أكتر من اللي عليه
  function balanceLabel(balance, isCustomer) {
    const b = Number(balance || 0);
    if (b < 0) return isCustomer ? 'ليه عندك (دفع زيادة)' : 'لينا عنده (دفعنا زيادة)';
    return isCustomer ? 'المطلوب منه' : 'المطلوب ليه';
  }

  // ---------- تفاصيل الفاتورة ----------
  async function showInvoice(kind /* 'sales' | 'purchases' */, id) {
    // فاتورة الشراء بتوضح التكلفة — لصاحب المحل بس
    if (kind === 'purchases' && !(await Auth.requireOwner('تفاصيل فاتورة الشراء'))) return;

    const doc = await DB.get(kind, id);
    if (!doc) { Utils.toast('الفاتورة مش موجودة', 'error'); return; }

    const isSale = kind === 'sales';
    const partyStore = isSale ? 'customers' : 'suppliers';
    const partyId = isSale ? doc.customerId : doc.supplierId;
    const party = partyId ? await DB.get(partyStore, partyId) : null;
    const partyName = party ? party.name : 'كاش';

    const lines = doc.lines || [];
    const rowsHtml = lines.map((l, i) => {
      const price = isSale ? l.price : l.cost;
      const packNote = l.packQty
        ? `<div class="inv-sub">${l.packQty} ${Utils.escapeHtml(l.packName || 'عبوة')} × ${Utils.formatMoney(l.packCost)} — الواحدة ${l.packSize} ${Utils.escapeHtml(l.unit || '')}</div>`
        : '';
      const retNote = l.returnedQty
        ? `<div class="inv-sub warn">اترجع منها ${Units.fmtQty(l.returnedQty, l.unit)}</div>` : '';
      return `
        <tr>
          <td>${i + 1}</td>
          <td><div class="inv-item">${Utils.escapeHtml(l.name)}</div>${packNote}${retNote}</td>
          <td>${Units.fmtQty(l.qty, l.unit)}</td>
          <td>${Utils.formatMoney(price)}</td>
          <td class="strong">${Utils.formatMoney(l.qty * price)}</td>
        </tr>`;
    }).join('');

    const retHistory = (doc.returns || []).length
      ? `<div class="notice" style="margin-top:12px;">
           <strong>مرتجعات على الفاتورة دي:</strong><br>
           ${doc.returns.map(r => `${Utils.formatDate(r.date)} — ${r.lines.map(l => Utils.escapeHtml(l.name) + ' (' + Units.fmtQty(l.qty, l.unit) + ')').join('، ')} بمبلغ ${Utils.formatMoney(r.amount)}`).join('<br>')}
         </div>` : '';

    Utils.openModal({
      title: `${DOC_LABEL[kind]} ${doc.number}`,
      wide: true,
      bodyHtml: `
        <div class="doc-head">
          <div><span class="doc-lbl">التاريخ</span><strong>${Utils.formatDateTime(doc.date)}</strong></div>
          <div><span class="doc-lbl">${isSale ? 'العميل' : 'المورد'}</span><strong>${Utils.escapeHtml(partyName)}</strong></div>
          <div><span class="doc-lbl">الحالة</span>${doc.voided
            ? '<span class="badge badge-danger">ملغاة</span>'
            : (doc.dueAmount > 0 ? '<span class="badge badge-warn">فيها آجل</span>' : '<span class="badge badge-ok">مدفوعة</span>')}</div>
        </div>

        <div class="table-wrap" style="border:none;margin-top:12px;">
          <table>
            <thead><tr><th style="width:34px;">#</th><th>الصنف</th><th>الكمية</th><th>${isSale ? 'سعر البيع' : 'سعر الوحدة'}</th><th>الإجمالي</th></tr></thead>
            <tbody>${rowsHtml || '<tr class="empty-row"><td colspan="5">مفيش بنود</td></tr>'}</tbody>
          </table>
        </div>

        <div class="pay-summary" style="margin-top:14px;">
          ${isSale && doc.discount ? `<div class="row"><span>الإجمالي قبل الخصم</span><span>${Utils.formatMoney(doc.subtotal)}</span></div>
          <div class="row"><span>خصم</span><span>- ${Utils.formatMoney(doc.discount)}</span></div>` : ''}
          <div class="row grand"><span>إجمالي الفاتورة</span><span>${Utils.formatMoney(doc.total)}</span></div>
          <div class="row"><span>المدفوع وقتها</span><span>${Utils.formatMoney(doc.paidNow)}</span></div>
          <div class="row"><span>${isSale ? 'اتسجل على العميل' : 'اتسجل على المورد'}</span><span>${Utils.formatMoney(doc.dueAmount)}</span></div>
        </div>
        ${retHistory}
        ${doc.voided ? '<div class="notice notice-warn" style="margin-top:12px;">الفاتورة دي اتلغت — أثرها اترجع من المخزون والحسابات.</div>' : ''}
        ${isSale && !doc.voided && lines.some(l => (l.qty - (l.returnedQty || 0)) > 0)
          ? `<div class="form-actions"><button class="btn btn-ghost" id="btnReturn">↩️ تسجيل مرتجع</button></div>` : ''}
      `,
      onMount: (body, close) => {
        const rb = body.querySelector('#btnReturn');
        if (rb) rb.addEventListener('click', () => { close(); openReturnDialog(doc); });
      }
    });
  }

  // ---------- تسجيل مرتجع ----------
  function openReturnDialog(sale) {
    const avail = (sale.lines || []).map((l, i) => ({
      i, name: l.name, unit: l.unit, price: l.price,
      left: Math.round((l.qty - (l.returnedQty || 0)) * 1000) / 1000
    })).filter(l => l.left > 0);

    Utils.openModal({
      title: `مرتجع من فاتورة ${sale.number}`,
      wide: true,
      bodyHtml: `
        <p class="muted" style="font-size:13px;margin-bottom:12px;">
          اكتب الكمية اللي العميل رجّعها من كل صنف. البضاعة هترجع للمخزن،
          والمبلغ هينزل من اللي عليه الأول — واللي يفضل هيترد كاش من الخزنة.
        </p>
        <div class="table-wrap" style="border:none;">
          <table>
            <thead><tr><th>الصنف</th><th>المتاح للإرجاع</th><th>السعر</th><th>الكمية المرتجعة</th></tr></thead>
            <tbody>
              ${avail.map(l => `
                <tr data-i="${l.i}">
                  <td class="strong">${Utils.escapeHtml(l.name)}</td>
                  <td>${Units.fmtQty(l.left, l.unit)}</td>
                  <td>${Utils.formatMoney(l.price)}</td>
                  <td><input type="number" class="cell ret-qty num" min="0" max="${l.left}"
                        step="${Units.step(l.unit)}" value="0" inputmode="decimal" style="width:100px;"></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="pay-summary" style="margin-top:14px;">
          <div class="row grand"><span>إجمالي المرتجع</span><span id="retTotal">0.00 ج.م</span></div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="retCancel">إلغاء</button>
          <button type="button" class="btn btn-amber" id="retSave">تسجيل المرتجع</button>
        </div>`,
      onMount: (body, close) => {
        function calcTotal() {
          let t = 0;
          body.querySelectorAll('tr[data-i]').forEach(tr => {
            const i = Number(tr.dataset.i);
            const q = Number(tr.querySelector('.ret-qty').value || 0);
            t += q * sale.lines[i].price;
          });
          body.querySelector('#retTotal').textContent = Utils.formatMoney(t);
          return t;
        }
        body.querySelectorAll('.ret-qty').forEach(el => el.addEventListener('input', calcTotal));
        body.querySelector('#retCancel').addEventListener('click', close);

        let busy = false;
        body.querySelector('#retSave').addEventListener('click', async (e) => {
          if (busy) return;
          const returns = [];
          body.querySelectorAll('tr[data-i]').forEach(tr => {
            const q = Number(tr.querySelector('.ret-qty').value || 0);
            if (q > 0) returns.push({ lineIndex: Number(tr.dataset.i), qty: q });
          });
          if (!returns.length) { Utils.toast('اكتب الكمية المرتجعة', 'error'); return; }

          busy = true;
          e.target.disabled = true; e.target.textContent = 'بيسجل...';
          try {
            const res = await Services.returnSaleItems(sale.id, returns);
            await AppState.reloadItems(); await AppState.reloadParties();
            if (typeof refreshShell === 'function') await refreshShell();
            Utils.beep('ok');
            Utils.toast(`اتسجل المرتجع ${Utils.formatMoney(res.refundTotal)}` +
              (res.cashBack > 0 ? ` — اترد كاش ${Utils.formatMoney(res.cashBack)}` : '') +
              (res.fromDue > 0 ? ` — نزل من حسابه ${Utils.formatMoney(res.fromDue)}` : ''), 'success');
            close();
            if (typeof navigate === 'function' && typeof currentRoute !== 'undefined') navigate(currentRoute);
          } catch (err) {
            Utils.beep('error');
            Utils.toast(err.message || 'المرتجع مانجحش', 'error');
            e.target.disabled = false; e.target.textContent = 'تسجيل المرتجع';
            busy = false;
          }
        });
      }
    });
  }

  // ---------- كشف حساب ----------
  async function showStatement(kind /* 'customers' | 'suppliers' */, partyId) {
    // كشف حساب المورد بيوضح المشتريات والتكلفة — لصاحب المحل بس
    if (kind === 'suppliers' && !(await Auth.requireOwner('كشف حساب المورد'))) return;

    const isCustomer = kind === 'customers';
    const party = await DB.get(kind, partyId);
    if (!party) { Utils.toast('مش موجود', 'error'); return; }

    const docStore = isCustomer ? 'sales' : 'purchases';
    const payMoveSource = isCustomer ? 'collect' : 'pay';

    const [docs, treasury] = await Promise.all([DB.getAll(docStore), DB.getAll('treasury')]);
    const myDocs = docs.filter(d => (isCustomer ? d.customerId : d.supplierId) === partyId);
    const myPays = treasury.filter(t => t.source === payMoveSource && t.refId === partyId);

    // بنجمع الفواتير والدفعات في سجل واحد بالترتيب الزمني
    const entries = [];
    // الرصيد الافتتاحي (دين قديم من قبل البرنامج) لازم يبان في أول الكشف
    // وإلا الرصيد الجاري مش هيطابق الرصيد المسجل
    const opening = Number(party.openingBalance || 0);
    if (opening !== 0) {
      entries.push({ date: party.openingDate || '2000-01-01T00:00:00.000Z', type: 'opening', debit: opening });
    }
    myDocs.forEach(d => entries.push({
      date: d.date, type: 'doc', docId: d.id, number: d.number,
      total: d.total, paidNow: d.paidNow, voided: !!d.voided,
      debit: d.voided ? 0 : (d.dueAmount || 0)
    }));
    myPays.forEach(p => entries.push({
      date: p.date, type: 'pay', credit: p.amount, note: p.note || ''
    }));
    entries.sort((a, b) => new Date(a.date) - new Date(b.date));

    let running = 0;
    const rowsHtml = entries.map(e => {
      if (e.type === 'opening') {
        running += e.debit;
        return `
          <tr class="stmt-row">
            <td>${Utils.formatDate(e.date)}</td>
            <td><span class="pay-chip open-chip">رصيد افتتاحي</span>
              <div class="inv-sub">دين قديم من قبل البرنامج</div></td>
            <td class="num-cell debit">${Utils.formatMoney(e.debit)}</td>
            <td class="num-cell"></td>
            <td class="num-cell strong">${Utils.formatMoney(running)}</td>
          </tr>`;
      }
      if (e.type === 'doc') {
        running += e.debit;
        return `
          <tr class="stmt-row ${e.voided ? 'voided' : ''}" data-doc="${e.docId}">
            <td>${Utils.formatDate(e.date)}</td>
            <td>
              <span class="stmt-link">${e.number}</span>
              ${e.voided ? '<span class="badge badge-danger">ملغاة</span>' : ''}
              <div class="inv-sub">إجمالي ${Utils.formatMoney(e.total)} · مدفوع وقتها ${Utils.formatMoney(e.paidNow)}</div>
            </td>
            <td class="num-cell debit">${e.debit > 0 ? Utils.formatMoney(e.debit) : ''}</td>
            <td class="num-cell"></td>
            <td class="num-cell strong">${Utils.formatMoney(running)}</td>
          </tr>`;
      }
      running -= e.credit;
      return `
        <tr class="stmt-row">
          <td>${Utils.formatDate(e.date)}</td>
          <td><span class="pay-chip">${isCustomer ? 'تحصيل' : 'سداد'}</span>
            ${e.note ? `<div class="inv-sub">${Utils.escapeHtml(e.note)}</div>` : ''}</td>
          <td class="num-cell"></td>
          <td class="num-cell credit">${Utils.formatMoney(e.credit)}</td>
          <td class="num-cell strong">${Utils.formatMoney(running)}</td>
        </tr>`;
    }).join('');

    const totalDebit = entries.filter(e => e.type === 'doc' || e.type === 'opening').reduce((s, e) => s + e.debit, 0);
    const totalCredit = entries.filter(e => e.type === 'pay').reduce((s, e) => s + e.credit, 0);

    Utils.openModal({
      title: `كشف حساب: ${party.name}`,
      wide: true,
      bodyHtml: `
        <div class="doc-head">
          <div><span class="doc-lbl">التليفون</span><strong>${Utils.escapeHtml(party.phone || '—')}</strong></div>
          <div><span class="doc-lbl">عدد الفواتير</span><strong>${myDocs.length}</strong></div>
          <div><span class="doc-lbl">${balanceLabel(party.balance, isCustomer)}</span>
            <strong class="${(party.balance || 0) > 0 ? 'amt-due' : ((party.balance || 0) < 0 ? 'amt-credit' : 'amt-ok')}">
              ${Utils.formatMoney(Math.abs(party.balance || 0))}</strong></div>
        </div>

        <div class="table-wrap" style="border:none;margin-top:12px;max-height:52vh;overflow-y:auto;">
          <table>
            <thead><tr>
              <th>التاريخ</th><th>البيان</th>
              <th>${isCustomer ? 'عليه' : 'علينا'}</th>
              <th>${isCustomer ? 'دفع' : 'دفعنا'}</th>
              <th>الرصيد</th>
            </tr></thead>
            <tbody>${rowsHtml || '<tr class="empty-row"><td colspan="5">مفيش حركة على الحساب</td></tr>'}</tbody>
          </table>
        </div>

        <div class="pay-summary" style="margin-top:14px;">
          <div class="row"><span>إجمالي اللي اتسجل على الحساب</span><span>${Utils.formatMoney(totalDebit)}</span></div>
          <div class="row"><span>إجمالي المدفوع</span><span>${Utils.formatMoney(totalCredit)}</span></div>
          <div class="row grand"><span>الرصيد الحالي</span><span>${Utils.formatMoney(totalDebit - totalCredit)}</span></div>
        </div>
        <div class="hint" style="margin-top:8px;">دوس على رقم أي فاتورة عشان تشوف بنودها</div>
      `,
      onMount: (body) => {
        body.querySelectorAll('.stmt-row[data-doc]').forEach(row => {
          row.addEventListener('click', () => showInvoice(docStore, Number(row.dataset.doc)));
        });
      }
    });
  }

  return { showInvoice, showStatement };
})();
