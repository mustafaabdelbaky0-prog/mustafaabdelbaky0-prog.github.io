/* الطباعة — فاتورة أو كشف حساب

   كل حاجة بتتطبع بتتحط في #printArea، والـ CSS بيخلي الطباعة
   تطلع بس اللي جوّاه ويخفي باقي الشاشة. */

const Printing = (() => {

  function head(extraLine) {
    const c = (typeof AppState !== 'undefined' && AppState.company) || {};
    return `
      <h2>${Utils.escapeHtml(c.name || 'مؤسسة المصطفى للأدوات الكهربائية والحدايد')}</h2>
      <div class="sub">${Utils.escapeHtml(c.phone || '')}${c.address ? ' · ' + Utils.escapeHtml(c.address) : ''}</div>
      ${extraLine ? `<div class="sub">${extraLine}</div>` : ''}`;
  }

  function footNote() {
    const c = (typeof AppState !== 'undefined' && AppState.company) || {};
    return c.note ? `<div class="sub" style="margin-top:10px;">${Utils.escapeHtml(c.note)}</div>` : '';
  }

  function go(html) {
    const area = document.getElementById('printArea');
    if (!area) return;
    area.innerHTML = `<div class="receipt">${html}</div>`;
    setTimeout(() => window.print(), 150);
  }

  /* فاتورة بيع أو شرا — بتشتغل على فاتورة متسجلة، فينفع تطبعها
     تاني بعد أسبوع لو العميل رجع عايز صورتها. */
  function invoice(kind, doc, partyName) {
    const isSale = kind === 'sales';
    const lines = doc.lines || [];
    const title = isSale ? 'فاتورة بيع' : 'فاتورة شراء';
    const who = isSale ? 'العميل' : 'المورد';

    const rows = lines.map(l => {
      const price = isSale ? Number(l.price || 0) : Number(l.cost || 0);
      /* اللي اتباع/اتشرى عبوة كاملة يتكتب بالعبوة (٢ لفة) وتحتها
         الكمية بالوحدة الأصلية، عشان الزبون يفهم والحساب يبان */
      const isPack = Number(l.packQty || 0) > 0;
      const packOne = l.packCost != null ? l.packCost : l.packPrice;
      const qtyCell = isPack
        ? `${Units.fmtQty(l.packQty, l.packName || 'عبوة')}<div class="line-sub">${Units.fmtQty(l.qty, l.unit)}</div>`
        : Units.fmtQty(l.qty, l.unit);
      const priceCell = isPack && packOne != null
        ? `${Number(packOne).toFixed(2)}<div class="line-sub">ال${Utils.escapeHtml(l.unit || '')} ${price.toFixed(2)}</div>`
        : price.toFixed(2);
      return `<tr>
        <td>${Utils.escapeHtml(l.name || '')}</td>
        <td>${qtyCell}</td>
        <td>${priceCell}</td>
        <td>${(Number(l.qty || 0) * price).toFixed(2)}</td>
      </tr>`;
    }).join('');

    const total = Number(doc.total || 0);
    const paid = Number(doc.paidNow || 0);
    const due = Number(doc.dueAmount || 0);

    go(`
      ${head(`${title} ${Utils.escapeHtml(doc.number || '')} — ${Utils.formatDate(doc.date)}`)}
      <div class="sub">${who}: ${Utils.escapeHtml(partyName || 'كاش')}</div>
      ${doc.voided ? '<div class="sub" style="font-weight:800;">** فاتورة ملغاة **</div>' : ''}
      <table>
        <thead><tr><th>الصنف</th><th>كمية</th><th>سعر</th><th>إجمالي</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${doc.discount ? `<div class="sub" style="text-align:left;">خصم: ${Number(doc.discount).toFixed(2)}</div>` : ''}
      <div class="tot">الإجمالي: ${total.toFixed(2)} ج.م</div>
      ${due > 0 ? `<div class="tot" style="font-size:12px;">المدفوع: ${paid.toFixed(2)} — المتبقي: ${due.toFixed(2)}</div>` : ''}
      ${doc.editedAt ? `<div class="sub" style="font-size:10px;">اتعدّلت ${Utils.formatDateTime(doc.editedAt)}</div>` : ''}
      ${footNote()}
    `);
  }

  /* كشف حساب عميل أو مورد — بالحركات والرصيد الجاري */
  function statement(kind, party, entries) {
    const isCustomer = kind === 'customers';
    let running = 0;
    const rows = entries.map(e => {
      let label = '', debit = 0, credit = 0;
      if (e.type === 'opening') { label = 'رصيد سابق'; debit = e.debit || 0; }
      else if (e.type === 'doc') {
        label = (isCustomer ? 'فاتورة بيع ' : 'فاتورة شراء ') + (e.number || '') + (e.voided ? ' (ملغاة)' : '');
        debit = e.debit || 0;
      } else { label = e.note || (isCustomer ? 'تحصيل' : 'سداد'); credit = e.credit || 0; }
      running = Math.round((running + debit - credit) * 100) / 100;
      return `<tr>
        <td>${Utils.formatDate(e.date)}</td>
        <td>${Utils.escapeHtml(label)}</td>
        <td>${debit ? debit.toFixed(2) : ''}</td>
        <td>${credit ? credit.toFixed(2) : ''}</td>
        <td>${running.toFixed(2)}</td>
      </tr>`;
    }).join('');

    const bal = Number(party.balance || 0);
    const word = isCustomer
      ? (bal > 0 ? 'الباقي على العميل' : (bal < 0 ? 'ليه عندك' : 'الحساب مقفول'))
      : (bal > 0 ? 'الباقي عليك للمورد' : (bal < 0 ? 'ليك عنده' : 'الحساب مقفول'));

    go(`
      ${head(`كشف حساب — ${Utils.formatDate(Utils.nowISO())}`)}
      <div class="sub" style="font-weight:800;font-size:13px;">${Utils.escapeHtml(party.name)}</div>
      ${party.phone ? `<div class="sub">${Utils.escapeHtml(party.phone)}</div>` : ''}
      <table>
        <thead><tr><th>التاريخ</th><th>البيان</th><th>عليه</th><th>له</th><th>الرصيد</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5">مفيش حركات</td></tr>'}</tbody>
      </table>
      <div class="tot">${word}: ${Math.abs(bal).toFixed(2)} ج.م</div>
      ${footNote()}
    `);
  }

  return { invoice, statement };
})();
