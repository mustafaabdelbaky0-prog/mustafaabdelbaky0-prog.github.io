/* فواتير المبيعات — كل الفواتير القديمة والبحث فيهم.

   نقطة البيع بتوري فواتير النهارده بس عشان تفضل خفيفة. لو عايز
   فاتورة من امبارح أو من الأسبوع اللي فات، دي الشاشة: بحث بالتاريخ
   (من / لغاية)، أو باسم العميل أو رقم الفاتورة أو اسم صنف جوّاها.
   الكروت نفسها بتاعة نقطة البيع (افتح / مرتجع / تعديل / مسح). */
Modules.saleslist = (() => {
  const PAGE = 40;   // كام فاتورة نوري في المرة (الأحدث الأول)

  async function render(container) {
    await AppState.reloadParties();
    container.innerHTML = `
      <div class="card">
        <div class="section-head">
          <h3>فواتير المبيعات</h3>
          <span class="hint">الأحدث فوق — آخر فاتورة اتعملت هي أول واحدة</span>
        </div>
        <div class="inv-search">
          <div class="field">
            <label>من تاريخ</label>
            <input type="date" id="qFrom">
          </div>
          <div class="field">
            <label>لغاية</label>
            <input type="date" id="qTo">
          </div>
          <div class="field" style="flex:2;">
            <label>دوّر</label>
            <input type="text" id="qName" placeholder="اسم العميل أو رقم الفاتورة أو صنف جوّاها" autocomplete="off" autofocus>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="qClear">امسح البحث</button>
        </div>
        <div class="sl-quick">
          <button type="button" class="btn btn-ghost btn-sm" data-days="0">النهارده</button>
          <button type="button" class="btn btn-ghost btn-sm" data-days="1">امبارح</button>
          <button type="button" class="btn btn-ghost btn-sm" data-days="7">آخر ٧ أيام</button>
          <button type="button" class="btn btn-ghost btn-sm" data-days="30">آخر ٣٠ يوم</button>
        </div>
        <div id="salesListBox"></div>
      </div>`;

    const load = () => loadList(container);
    const run = Utils.debounce(load, 200);
    ['#qFrom', '#qTo'].forEach(sel => container.querySelector(sel).addEventListener('change', load));
    container.querySelector('#qName').addEventListener('input', run);
    container.querySelector('#qClear').addEventListener('click', () => {
      container.querySelector('#qFrom').value = '';
      container.querySelector('#qTo').value = '';
      container.querySelector('#qName').value = '';
      load();
    });
    container.querySelectorAll('.sl-quick button').forEach(b => b.addEventListener('click', () => {
      const days = Number(b.dataset.days);
      const to = new Date(); const from = new Date();
      if (days === 1) { from.setDate(from.getDate() - 1); to.setDate(to.getDate() - 1); }
      else from.setDate(from.getDate() - days);
      container.querySelector('#qFrom').value = Utils.dateKey(from.toISOString());
      container.querySelector('#qTo').value = Utils.dateKey(to.toISOString());
      load();
    }));
    load();
  }

  async function loadList(container) {
    const box = container.querySelector('#salesListBox');
    if (!box) return;
    const from = container.querySelector('#qFrom').value || '';
    const to = container.querySelector('#qTo').value || '';
    const q = (container.querySelector('#qName').value || '').trim();
    const searching = !!(from || to || q);

    const custName = id => { const x = AppState.customers.find(c => c.id === id); return x ? x.name : 'كاش'; };

    let all = Modules.sales.sortNewestFirst(await DB.getAll('sales'));
    if (from) all = all.filter(s => Utils.dateKey(s.date) >= from);
    if (to) all = all.filter(s => Utils.dateKey(s.date) <= to);
    if (q) {
      /* نفس البحث اللي بيفهم العربي (ه/ة، الأرقام اللازقة...) بتاع
         الأصناف — عشان "لمبة 9 وات" تلاقي "لمبه9وات" هنا كمان */
      all = all.filter(s =>
        Search.matchesAny([s.number || '', custName(s.customerId), ...(s.lines || []).map(l => l.name || '')], q));
    }

    const total = all.length;
    const list = searching ? all.slice(0, 300) : all.slice(0, PAGE);
    Modules.sales.renderSaleCards(box, list, container, {
      emptyText: searching ? 'مفيش فواتير بالبحث ده' : 'مفيش فواتير لسه',
      countText: searching
        ? `لقينا <strong>${total}</strong> فاتورة${total > list.length ? ' — بنوري أول ' + list.length + '، ضيّق البحث بالتاريخ' : ''}`
        : (total > PAGE ? `آخر ${PAGE} فاتورة من ${total} — دوّر بالتاريخ أو الاسم عشان تلاقي الأقدم` : ''),
      onChange: () => loadList(container),
      editIn: (id) => {
        Modules.sales.editFromList(id);
        if (typeof navigate === 'function') navigate('sales');
      }
    });
  }

  return { render };
})();
