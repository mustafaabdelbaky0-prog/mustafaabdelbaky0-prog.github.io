Modules.returns = (() => {
  /* فاتورة مرتجع — بنفس أسلوب فاتورة المشتريات (جدول تكتب فيه سطر سطر)

     نوعين:
       مرتجع من عميل  → بضاعة راجعة من الزبون
       مرتجع لمورد    → بضاعة راجعة للمورد

     لكل سطر:
       - الحالة: سليم (يرجع للمخزن ويتباع) أو تالف (يروح لرصيد الضمان)
       - العملية: فلوس (حساب/كاش) أو استبدال (بضاعة ببضاعة من غير فلوس)
       - المورد بيظهر لوحده من آخر مورد جبنا منه الصنف */

  let kind = 'customer';        // customer | supplier
  let rows = [];
  let rowSeq = 0;
  // بيزيد مع كل إعادة رسم للجدول — بيه بنعرف السماعة قديمة ولا لأ
  let drawSeq = 0;
  let saving = false;
  let detachScanner = null;
  /* البرنامج حوّل التسوية لكاش لوحده (عميل نقدي)؟ وهل هو بنفسه
     غيّر الاختيار؟ — عشان نعرف نرجّعه لما يكتب اسم العميل */
  let autoCash = false;
  let settleTouched = false;

  function blankRow() {
    return {
      _id: ++rowSeq, itemId: null, barcode: '', name: '', unit: 'قطعة',
      qty: '', price: '', condition: 'good', mode: 'money',
      supplierId: null, supplierName: '', reason: '',
      // لو الصنف بيتباع بالعبوة (لفة سلك ١٠٠ متر) يقدر يرجّعها لفة كاملة
      unitPrice: 0, unitCost: 0,
      packSize: 0, packName: '', packPrice: 0,
      sellUnits: [], sellKey: 'base'
    };
  }

  /* الطرق اللي ممكن يترجّع بيها: بالوحدة، أو عبوة كاملة، أو
     ربع كيلو / سم، أو الطريقة اللي هو كاتبها (مسمار).
     المرتجع بيتسجل دايمًا بالوحدة الأصلية عشان المخزن والضمان. */
  function baseLinePrice(r) {
    return kind === 'customer' ? Number(r.unitPrice || 0) : Number(r.unitCost || 0);
  }
  function waysOf(r) {
    const ways = Units.sellWays({
      unit: r.unit, packSize: r.packSize, packName: r.packName,
      packPrice: kind === 'customer' ? r.packPrice : 0, sellUnits: r.sellUnits
    }, baseLinePrice(r));
    /* المرتجع للمورد بالتكلفة: لو العبوة مالهاش سعر بيع بنحسبها
       من التكلفة × اللي فيها، عشان يرجّع لفة كاملة عادي */
    const size = Number(r.packSize || 0);
    if (size > 0 && !ways.some(w => w.key === 'pack')) {
      ways.splice(1, 0, {
        key: 'pack', name: r.packName || Units.packLabel(r.unit),
        factor: size, price: Math.round(baseLinePrice(r) * size * 100) / 100
      });
    }
    return ways;
  }
  function wayOf(r) {
    const ways = waysOf(r);
    return ways.find(w => w.key === (r.sellKey || 'base')) || ways[0];
  }

  function calc(r) {
    const qty = Number(r.qty || 0);
    const price = Number(r.price || 0);
    const w = wayOf(r);
    const size = Number(w.factor || 1);
    const pack = w.key !== 'base';
    return {
      qty, price, size, pack, way: w,
      baseQty: pack ? Math.round(qty * size * 1000000) / 1000000 : qty,
      basePrice: pack ? price / size : price,
      total: r.mode === 'swap' ? 0 : qty * price
    };
  }

  // الصنف ده بيترجّع بأكتر من طريقة؟
  function canUsePack(r) {
    return waysOf(r).length > 1;
  }

  function switchRowUnit(r, key) {
    const ways = waysOf(r);
    const w = ways.find(x => x.key === key) || ways[0];
    r.sellKey = w.key;
    r.qty = 1;
    r.price = w.price || '';
  }
  function grandTotal() { return rows.reduce((s, r) => s + calc(r).total, 0); }
  function filled() { return rows.filter(r => r.itemId && calc(r).qty > 0); }

  /* ---------- المرتجع لمورد: الأصناف اللي فعلاً جات منه ----------

     لما يكتب اسم المورد فوق، البحث لازم يجيب الأصناف اللي اشتراها
     من المورد ده بس. من غير كده كان ممكن يرجّع لمورد صنف هو شاريه
     من مورد تاني — والفلوس تنزل من حساب مورد مالوش علاقة.

     لو المورد مالوش فواتير شرا متسجلة خالص (بضاعة قديمة من قبل
     البرنامج)، مش بنحصر حاجة — بنقوله بس إن مفيش فواتير له. */
  let purCache = [];        // فواتير الشرا، بتتحمّل مرة مع الشاشة
  let supLimit = null;      // { id, name, ids:Set }  أو null = مفيش حصر
  const normName = s => Search.norm(String(s || '').trim());

  function itemsBoughtFrom(supplierId) {
    const ids = new Set();
    purCache.forEach(p => {
      if (p.voided) return;
      if (Number(p.supplierId) !== Number(supplierId)) return;
      (p.lines || []).forEach(l => { if (l.itemId) ids.add(Number(l.itemId)); });
    });
    return ids;
  }

  // بنقرا اسم المورد المكتوب فوق ونبني الحصر منه
  function refreshSupLimit(container) {
    const before = supLimit ? supLimit.id : 0;
    supLimit = null;
    if (kind === 'supplier') {
      const el = container.querySelector('#retParty');
      const nm = el ? el.value : '';
      if (String(nm).trim() && !Services.isCashName(nm)) {
        const sup = AppState.suppliers.find(s => normName(s.name) === normName(nm));
        if (sup) supLimit = { id: sup.id, name: sup.name, ids: itemsBoughtFrom(sup.id) };
      }
    }
    return (supLimit ? supLimit.id : 0) !== before;
  }

  const limiting = () => !!(supLimit && supLimit.ids.size);
  function allowedItem(id) { return !limiting() || supLimit.ids.has(Number(id)); }
  function limitList(list) {
    return limiting() ? (list || []).filter(i => supLimit.ids.has(Number(i.id))) : (list || []);
  }
  function refuseItem(name) {
    Utils.beep('error');
    Utils.toast('«' + (name || 'الصنف ده') + '» مش موجود في فواتير الشرا بتاعة ' +
                supLimit.name + ' — مينفعش يترجّعله', 'error');
  }

  /* الليستة المنسدلة والرسالة اللي تحت اسم المورد بيتجدّدوا مع كل
     تغيير في اسمه — عشان يلاقي أصنافه هو بس */
  function paintPartyLimit(container) {
    const dl = container.querySelector('#retItemList');
    if (dl) {
      dl.innerHTML = limitList(AppState.items)
        .map(i => `<option value="${Utils.escapeHtml(i.name)}">`).join('');
    }
    const h = container.querySelector('#retPartyHint');
    if (!h) return;
    if (kind !== 'supplier' || !supLimit) { h.textContent = ''; h.className = 'hint'; return; }
    if (!supLimit.ids.size) {
      h.className = 'hint warn';
      h.textContent = 'مفيش فواتير شرا متسجلة لـ' + supLimit.name +
        ' — خد بالك، البرنامج مش قادر يتأكد إن البضاعة جات منه.';
    } else {
      h.className = 'hint';
      h.textContent = 'البحث هيجيب أصناف ' + supLimit.name + ' بس — ' +
        supLimit.ids.size + ' صنف اشتريتهم منه.';
    }
  }

  async function render(container) {
    await AppState.reloadItems();
    await AppState.reloadParties();
    purCache = await DB.getAll('purchases');
    supLimit = null;
    autoCash = false; settleTouched = false;
    rows = [blankRow()];
    if (detachScanner) { detachScanner(); detachScanner = null; }
    if (Auth.isSeller() && kind === 'supplier') kind = 'customer';

    const isCust = kind === 'customer';

    container.innerHTML = `
      <div class="tabs" id="retTabs">
        <button data-t="customer" class="${isCust ? 'active' : ''}">مرتجع من عميل</button>
        ${Auth.isSeller() ? '' : `<button data-t="supplier" class="${!isCust ? 'active' : ''}">مرتجع لمورد</button>`}
      </div>

      <div class="card invoice-card">
        <div class="invoice-head">
          <div class="field inv-field">
            <label>التاريخ</label>
            <input type="date" id="retDate" value="${Utils.todayISO()}">
          </div>
          <div class="field inv-field" style="flex:2;">
            <label>${isCust ? 'اسم العميل' : 'اسم المورد'} <span class="muted">(اكتب "كاش" لو نقدي)</span></label>
            <input type="text" id="retParty" list="retPartyList" placeholder="${isCust ? 'اسم العميل أو كاش' : 'هيظهر لوحده من الصنف'}" autocomplete="off">
            <datalist id="retPartyList">
              ${(isCust ? AppState.customers : AppState.suppliers).map(p => `<option value="${Utils.escapeHtml(p.name)}">`).join('')}
            </datalist>
            <div class="hint" id="retPartyHint"></div>
          </div>
          <div class="field inv-field" style="flex:2;">
            <label>سبب المرتجع</label>
            <input type="text" id="retReason" list="reasonList" placeholder="ضمان / تالف / مقاس غلط..." autocomplete="off">
            <datalist id="reasonList">
              <option value="ضمان — باظت قبل انتهاء الضمان">
              <option value="تالف من المورد">
              <option value="مقاس أو نوع غلط">
              <option value="العميل مش عاجبه">
              <option value="زيادة عن الطلب">
            </datalist>
          </div>
        </div>

        <div class="scan-strip">
          <span>📡 امسح بالليزر — الصنف هيتحط في سطر لوحده${isCust ? '' : ' ومعاه اسم المورد'}</span>
          <button type="button" class="btn btn-ghost btn-sm" id="camBtn">📷 كاميرا</button>
        </div>

        <!-- بحث جوه سطور الفاتورة نفسها -->
        <div class="row-find">
          <span class="rf-ic">🔍</span>
          <input type="text" id="rowFind" placeholder="دوّر جوه سطور الفاتورة المفتوحة دي" autocomplete="off">
          <button type="button" class="btn btn-ghost btn-sm" id="rowFindClear" hidden>امسح البحث</button>
          <span class="rf-count" id="rowFindCount"></span>
        </div>

        <div class="table-wrap invoice-table-wrap">
          <table class="invoice-table ret-table">
            <thead>
              <tr>
                <th style="width:32px;">#</th>
                <th style="width:155px;">الباركود</th>
                <th style="width:175px;">الصنف</th>
                <th style="width:80px;">العدد</th>
                <th style="width:88px;">الوحدة</th>
                <th style="width:140px;">${isCust ? 'اتشرى من' : 'المورد'}</th>
                <th style="width:130px;">الحالة</th>
                <th style="width:135px;">العملية</th>
                <th style="width:95px;">السعر</th>
                <th style="width:105px;">القيمة</th>
                <th style="width:36px;"></th>
              </tr>
            </thead>
            <tbody id="retBody"></tbody>
          </table>
        </div>

        <button type="button" class="btn btn-ghost" id="addRowBtn" style="margin-top:10px;">+ سطر جديد</button>

        <div class="invoice-foot">
          <div class="foot-left">
            <div class="field inv-field">
              <label>الفلوس تتسوّى إزاي؟</label>
              <select id="settleMode">
                <option value="account">تنزل من الحساب</option>
                <option value="cash">${isCust ? 'أديله كاش من الخزنة' : 'آخد كاش في الخزنة'}</option>
              </select>
              <div class="hint">الأصناف اللي عملتها "استبدال" مش بيتحسبلها فلوس أصلاً.</div>
            </div>
          </div>
          <div class="foot-right">
            <div class="pay-summary">
              <div class="row"><span>عدد الأصناف</span><span id="sumCount">0</span></div>
              <div class="row"><span>استبدال (من غير فلوس)</span><span id="sumSwap">0</span></div>
              <div class="row grand"><span>قيمة المرتجع</span><span id="sumTotal">0.00 ج.م</span></div>
            </div>
            <div class="hint" id="retHint"></div>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-ghost" id="clearRet">فاتورة جديدة</button>
          <button class="btn btn-amber" id="saveRet">💾 حفظ المرتجع</button>
        </div>
      </div>

      <div class="card" id="dmgCard" style="margin-top:18px;" hidden>
        <div class="section-head">
          <div>
            <h3 class="mini-head">تالف عندك مستني يرجع للمورد</h3>
            <div class="hint">البضاعة اللي رجّعها العملاء تالفة. مش في المخزن ومش بتتباع —
              دوس على المورد عشان تعملّه مرتجع بيها.</div>
          </div>
        </div>
        <div id="dmgList"></div>
      </div>

      <div class="card" style="margin-top:18px;">
        <div class="section-head"><h3>المرتجعات اللي اتسجلت</h3></div>
        <div id="retHistory"></div>
      </div>

      <datalist id="retItemList">
        ${AppState.items.map(i => `<option value="${Utils.escapeHtml(i.name)}">`).join('')}
      </datalist>
    `;

    container.querySelectorAll('#retTabs button').forEach(b =>
      b.addEventListener('click', () => { kind = b.dataset.t; render(container); }));

    drawRows(container);
    loadHistory(container);
    drawDamaged(container);

    detachScanner = Scanner.attachHardwareScanner(
      container.querySelector('#retParty'), (code) => onScan(container, code));

    container.querySelector('#camBtn').addEventListener('click', async () => {
      const code = await Scanner.scan();
      if (code) onScan(container, code);
    });
    container.querySelector('#addRowBtn').addEventListener('click', () => {
      rows.push(blankRow()); drawRows(container, rows[rows.length - 1]._id, 'barcode');
    });
    container.querySelector('#settleMode').addEventListener('change', () => {
      settleTouched = true;   // اختياره هو — مش هنغيّره عليه
      autoCash = false;
      updateTotals(container);
    });
    container.querySelector('#clearRet').addEventListener('click', async () => {
      if (filled().length && !(await Utils.confirmDialog('هتمسح المرتجع وتبدأ من جديد؟'))) return;
      render(container);
    });
    container.querySelector('#saveRet').addEventListener('click', () => doSave(container));

    /* أول ما يكتب اسم المورد، الأصناف بتتحصر على اللي جه منه.
       ولو كان كاتب سطور قبل كده بأصناف مش بتاعته، بنقوله عليها
       فورًا بدل ما يكتشفها وهو بيحفظ. */
    const party = container.querySelector('#retParty');
    const onParty = () => {
      refreshSupLimit(container);
      paintPartyLimit(container);
      updateTotals(container);   // كاش ولا حساب؟ الاختيار بيتظبط لوحده
      if (limiting()) {
        const bad = rows.filter(r => r.itemId && !allowedItem(r.itemId));
        if (bad.length) {
          Utils.beep('error');
          Utils.toast(bad.length + (bad.length === 1 ? ' صنف في الفاتورة' : ' أصناف في الفاتورة') +
            ' مش من ' + supLimit.name + ': ' +
            bad.map(r => AppState.lineName(r)).slice(0, 3).join('، '), 'error');
        }
      }
    };
    party.addEventListener('input', onParty);
    party.addEventListener('change', onParty);
    paintPartyLimit(container);
  }

  function onScan(container, code) {
    const item = AppState.items.find(i => i.barcode === code);
    if (!item) { Utils.beep('error'); Utils.toast('الباركود ده مش متسجل', 'error'); return; }
    if (!allowedItem(item.id)) { refuseItem(item.name); return; }
    let target = rows.find(r => !r.itemId && !r.name && !r.barcode);
    if (!target) { target = blankRow(); rows.push(target); }
    applyItem(target, item);
    Utils.beep('ok');
    if (!rows.some(r => !r.itemId && !r.name && !r.barcode)) rows.push(blankRow());
    drawRows(container, target._id, 'qty');
  }

  function applyItem(row, item) {
    row.itemId = item.id;
    row.name = item.name;
    row.barcode = item.barcode || '';
    row.unit = item.unit || 'قطعة';
    row.unitPrice = Number(item.salePrice || 0);
    row.unitCost = Number(item.costPrice || 0);
    row.packSize = Number(item.packSize || 0);
    row.packName = item.packName || Units.packLabel(row.unit);
    row.packPrice = Number(item.packPrice || 0);
    row.sellUnits = Array.isArray(item.sellUnits) ? item.sellUnits : [];
    row.sellKey = 'base';   // الأصل بالوحدة، واللي راجع عبوة أو ربع كيلو بيغيّر
    /* المورد بيتملى لوحده من آخر مورد جبنا منه الصنف — إلا لو هو
       كاتب اسم مورد فوق والصنف ده فعلاً جه منه، فالمكتوب أولى
       (الصنف ممكن يكون متجاب من أكتر من مورد) */
    const sup = (supLimit && supLimit.ids.has(Number(item.id)))
      ? AppState.suppliers.find(s => s.id === supLimit.id)
      : AppState.suppliers.find(s => s.id === item.lastSupplierId);
    row.supplierId = sup ? sup.id : null;
    row.supplierName = sup ? sup.name : '';
    if (!row.qty) row.qty = 1;
    if (!row.price) row.price = (kind === 'customer' ? item.salePrice : item.costPrice) || '';
  }

  function drawRows(container, focusId, focusField) {
    drawSeq++;   // سماعات الرسمة اللي فاتت تسكت من هنا ورايح
    const body = container.querySelector('#retBody');
    const isCust = kind === 'customer';

    body.innerHTML = rows.map((r, idx) => {
      const c = calc(r);
      const item = AppState.items.find(i => i.id === r.itemId);
      const stock = item ? Number(item.stock || 0) : 0;
      const damaged = item ? Number(item.damagedQty || 0) : 0;
      return `
      <tr data-id="${r._id}">
        <td data-label="#" class="row-num">${idx + 1}</td>
        <td data-label="الباركود">
          <div class="cell-scan">
            <input type="text" class="cell f-barcode" value="${Utils.escapeHtml(r.barcode)}" placeholder="امسح أو اكتب" autocomplete="off">
            <button type="button" class="cell-cam" title="صوّر الباركود">📷</button>
          </div>
        </td>
        <td data-label="الصنف">
          <input type="text" class="cell f-name" value="${Utils.escapeHtml(r.name)}" placeholder="ابحث بالاسم أو الباركود" autocomplete="off">
          ${item ? `<div class="inv-sub">بالمخزن ${Units.fmtQty(stock, r.unit)}${damaged > 0 ? ` · تالف ${Units.fmtQty(damaged, r.unit)}` : ''}</div>` : ''}
        </td>
        <td data-label="العدد">
          <input type="number" class="cell f-qty num" value="${r.qty}" min="0" step="${Units.stepFor(c.way, r.unit)}" inputmode="decimal" placeholder="0">
          ${c.pack && c.baseQty > 0 ? `<div class="line-derived">= ${Units.fmtQty(c.baseQty, r.unit)}</div>` : ''}
        </td>
        <td data-label="الوحدة" class="unit-cell">
          ${canUsePack(r) ? `
            <select class="cell f-unitsel" title="راجع بإيه؟">
              ${waysOf(r).map(w =>
                `<option value="${Utils.escapeHtml(w.key)}" ${w.key === c.way.key ? 'selected' : ''}>${Utils.escapeHtml(w.name)}</option>`).join('')}
            </select>`
            : Utils.escapeHtml(r.unit)}
        </td>
        <td data-label="${isCust ? 'اتشرى من' : 'المورد'}" class="sup-cell">
          ${r.supplierName
            ? `<div class="sup-auto">${Utils.escapeHtml(r.supplierName)}</div>`
            : `<div class="cell-muted">—</div>`}
        </td>
        <td data-label="الحالة">
          <select class="cell f-cond">
            <option value="good" ${r.condition === 'good' ? 'selected' : ''}>سليم</option>
            <option value="damaged" ${r.condition === 'damaged' ? 'selected' : ''}>تالف / ضمان</option>
          </select>
        </td>
        <td data-label="العملية">
          <select class="cell f-mode">
            <option value="money" ${r.mode === 'money' ? 'selected' : ''}>فلوس</option>
            <option value="swap" ${r.mode === 'swap' ? 'selected' : ''}>استبدال</option>
          </select>
        </td>
        <td data-label="السعر">
          <input type="number" class="cell f-price num" value="${r.price}" min="0" step="0.01"
                 inputmode="decimal" placeholder="0.00" ${r.mode === 'swap' ? 'disabled' : ''}>
          ${c.pack && c.basePrice > 0 && r.mode !== 'swap'
            ? `<div class="line-derived">ال${Utils.escapeHtml(r.unit)} بـ ${Utils.formatMoney(c.basePrice)}</div>` : ''}
        </td>
        <td data-label="القيمة" class="cell-total">
          <div class="line-sum">${r.mode === 'swap' ? '<span class="swap-tag">استبدال</span>' : Utils.formatMoney(c.total)}</div>
          ${c.pack && c.baseQty > 0 ? `<div class="line-derived">= ${Units.fmtQty(c.baseQty, r.unit)}</div>` : ''}
        </td>
        <td data-label=""><button type="button" class="icon-btn rm-row" title="حذف السطر">🗑️</button></td>
      </tr>`;
    }).join('');

    bindRows(container);
    applyRowFilter(container);   // البحث بيفضل شغال بعد إعادة رسم الجدول
    bindPicker(container);
    bindRowFind(container);
    updateTotals(container);

    if (focusId) {
      const tr = body.querySelector(`tr[data-id="${focusId}"]`);
      if (tr) {
        /* أي خانة في السطر — الاسم بييجي من الكلاس (f-qty ← qty).
           ولو الخانة دي مش موجودة في السطر الجديد بنرجع للكمية. */
        const el = tr.querySelector('.f-' + (focusField || 'qty'))
                || tr.querySelector('.f-qty')
                || tr.querySelector('.f-barcode');
        if (el) { el.focus(); el.select && el.select(); }
        tr.classList.add('flash-row');
      }
    }
  }

  /* البحث جوّه خانات الجدول — بيتربط مرة واحدة على الجدول كله
     مش على كل سطر، لأن الجدول بيتعاد رسمه كتير وانت بتكتب */
  let pickerBound = null;
  function bindPicker(container) {
    if (pickerBound === container) return;
    pickerBound = container;
    const take = (it, input) => {
      const id = Number(input.closest('tr').dataset.id);
      const r = rows.find(x => x._id === id);
      if (!r) return;
      applyItem(r, it);
      drawRows(container, id, 'qty');
    };
    // مرتجع لمورد مكتوب اسمه؟ القايمة بتجيب أصنافه هو بس
    Picker.bind(container, {
      '.f-barcode': { search: (q) => limitList(Picker.searchItems(q)), render: Picker.itemRow, onPick: take },
      '.f-name':    { search: (q) => limitList(Picker.searchItems(q)), render: Picker.itemRow, onPick: take }
    });
  }

  /* بحث جوه سطور الفاتورة — بيخبّي اللي مش مطابق شكليًا بس،
     السطور كلها بتفضل في الفاتورة والإجماليات على الكل */
  let rowFilter = '';
  function rowMatches(r, q) {
    if (!q) return true;
    return Search.matchesAny([r.name, r.barcode, r.unit, r.packName], q);
  }
  function applyRowFilter(container) {
    const body = container.querySelector('#retBody');
    if (!body) return;
    const q = rowFilter.trim().toLowerCase();
    let shown = 0;
    body.querySelectorAll('tr[data-id]').forEach(tr => {
      const r = rows.find(x => x._id === Number(tr.dataset.id));
      const ok = !r || rowMatches(r, q);
      tr.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    const cnt = container.querySelector('#rowFindCount');
    const clr = container.querySelector('#rowFindClear');
    if (cnt) cnt.textContent = q ? shown + ' من ' + rows.length + ' سطر' : '';
    if (clr) clr.hidden = !q;
    /* لو البحث خبّى كل السطور بنكتبله إن مفيش نتيجة — عشان الجدول
       الفاضي شكله كإن البرنامج باظ */
    let msg = body.querySelector('.rf-empty');
    if (q && shown === 0) {
      if (!msg) {
        msg = document.createElement('tr');
        msg.className = 'empty-row rf-empty';
        msg.innerHTML = '<td colspan="12"></td>';
        body.appendChild(msg);
      }
      /* المستخدم بيكتب هنا اسم صنف وهو متوقع إنها تدوّرله عليه.
         بدل ما نسيبه في طريق مسدود بنوريه الصنف ونخليه يضيفه. */
      const term = rowFilter.trim();
      const hit = limitList(Picker.searchItems(term))[0];
      msg.querySelector('td').innerHTML =
        '<div style="line-height:2;">مفيش سطر فيه "<strong>' + Utils.escapeHtml(term) +
        '</strong>" في الفاتورة المفتوحة دي — السطور الـ' + rows.length + ' كلها زي ما هي.' +
        (hit ? '<div class="rf-actions"><button type="button" class="btn btn-amber btn-sm" id="rfAdd" data-id="' +
               hit.id + '">+ ضيف "' + Utils.escapeHtml(hit.name) + '" للفاتورة</button></div>' : '') +
        '</div>';
      msg.style.display = '';
      const addBtn = msg.querySelector('#rfAdd');
      if (addBtn) addBtn.addEventListener('click', () => {
        const it = AppState.items.find(i => Number(i.id) === Number(addBtn.dataset.id));
        if (!it) return;
        const blank = rows.find(r => !r.itemId && !(r.name || '').trim() && !(r.barcode || '').trim());
        const target = blank || (rows.push(blankRow()), rows[rows.length - 1]);
        applyItem(target, it);
        rowFilter = '';
        const fe = container.querySelector('#rowFind');
        if (fe) fe.value = '';
        drawRows(container, target._id, 'qty');
      });
    } else if (msg) { msg.remove(); }
  }
  let findBound = null;
  function bindRowFind(container) {
    const el = container.querySelector('#rowFind');
    if (!el) return;
    el.value = rowFilter;
    if (findBound === el) return;   // الجدول بيتعاد رسمه كتير — مننفعش نربط مرتين
    findBound = el;
    el.addEventListener('input', () => { rowFilter = el.value; applyRowFilter(container); });
    const c = container.querySelector('#rowFindClear');
    if (c) c.addEventListener('click', () => { rowFilter = ''; el.value = ''; applyRowFilter(container); el.focus(); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { rowFilter = ''; el.value = ''; applyRowFilter(container); }
    });
    applyRowFilter(container);
  }

  function bindRows(container) {
    // رقم الرسمة دي — أي حدث يوصل بعد إعادة الرسم بيتترمي
    const gen = drawSeq;
    const live = () => gen === drawSeq;
    container.querySelectorAll('#retBody tr').forEach(tr => {
      const id = Number(tr.dataset.id);
      const r = rows.find(x => x._id === id);
      if (!r) return;
      // الخانة القديمة ممكن يوصلها حدث متأخر بعد ما السطر يتعاد
      // رسمه — Utils.guardCell بتتجاهله (شوف الشرح في utils.js)
      const $ = s => Utils.guardCell(tr.querySelector(s), live);

      $('.f-barcode').addEventListener('input', e => { r.barcode = e.target.value.trim(); });
      // إنتر في خانة الباركود بيدوّر على الصنف على طول،
      // من غير ما تستنى التركيز يسيب الخانة
      $('.f-barcode').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); }
      });      $('.f-barcode').addEventListener('change', e => {
        r.barcode = e.target.value.trim();
        const it = AppState.items.find(i => i.barcode === r.barcode);
        if (it && !allowedItem(it.id)) { refuseItem(it.name); r.barcode = ''; drawRows(container, id, 'barcode'); return; }
        if (it) { applyItem(r, it); drawRows(container, id, 'qty'); }
        else if (r.barcode) Utils.toast('الباركود ده مش متسجل', 'error');
      });
      $('.cell-cam').addEventListener('click', async () => {
        const code = await Scanner.scan();
        if (!code) return;
        const it = AppState.items.find(i => i.barcode === code);
        if (it && !allowedItem(it.id)) { refuseItem(it.name); return; }
        if (it) { applyItem(r, it); drawRows(container, id, 'qty'); }
        else Utils.toast('الباركود ده مش متسجل', 'error');
      });

      $('.f-name').addEventListener('input', e => { r.name = e.target.value; });
      $('.f-name').addEventListener('change', e => {
        r.name = e.target.value;
        const it = AppState.items.find(i => (i.name || '').trim() === r.name.trim());
        if (it && !allowedItem(it.id)) { refuseItem(it.name); r.name = ''; drawRows(container, id, 'name'); return; }
        if (it) { applyItem(r, it); drawRows(container, id, 'qty'); }
      });

      $('.f-qty').addEventListener('input', e => { r.qty = e.target.value; refreshLine(container, tr, r); });
      $('.f-price').addEventListener('input', e => { r.price = e.target.value; refreshLine(container, tr, r); });
      $('.f-cond').addEventListener('change', e => { r.condition = e.target.value; drawRows(container, id, 'qty'); });
      $('.f-mode').addEventListener('change', e => { r.mode = e.target.value; drawRows(container, id, 'qty'); });

      // راجع بإيه؟ بالمتر، لفة كاملة، ربع كيلو، مسمار...
      if ($('.f-unitsel')) {
        $('.f-unitsel').addEventListener('change', (e) => {
          switchRowUnit(r, e.target.value);
          drawRows(container, id, 'qty');
        });
      }

      $('.rm-row').addEventListener('click', () => {
        rows = rows.filter(x => x._id !== id);
        if (!rows.length) rows.push(blankRow());
        drawRows(container);
      });

      /* Enter بينزّلك على نفس الخانة في السطر اللي تحت — زي الإكسيل */
      tr.querySelectorAll('.cell').forEach(el => el.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const idx = rows.findIndex(x => x._id === id);
        if (idx === rows.length - 1) rows.push(blankRow());
        drawRows(container, rows[idx + 1]._id, Utils.fieldOf(e.target));
      }));
    });
  }

  function refreshLine(container, tr, r) {
    const c = calc(r);
    tr.querySelector('.line-sum').innerHTML = r.mode === 'swap'
      ? '<span class="swap-tag">استبدال</span>' : Utils.formatMoney(c.total);

    // السطور الصغيرة اللي بتترجم اللفة لأمتار وهو بيكتب
    const totalCell = tr.querySelector('.cell-total');
    if (totalCell) {
      const old = totalCell.querySelector('.line-derived');
      if (old) old.remove();
      if (c.pack && c.baseQty > 0) {
        totalCell.insertAdjacentHTML('beforeend',
          `<div class="line-derived">= ${Units.fmtQty(c.baseQty, r.unit)}</div>`);
      }
    }
    const priceEl = tr.querySelector('.f-price');
    if (priceEl) {
      const old = priceEl.parentElement.querySelector('.line-derived');
      if (old) old.remove();
      if (c.pack && c.basePrice > 0 && r.mode !== 'swap') {
        priceEl.insertAdjacentHTML('afterend',
          `<div class="line-derived">ال${Utils.escapeHtml(r.unit)} بـ ${Utils.formatMoney(c.basePrice)}</div>`);
      }
    }
    updateTotals(container);
  }

  function updateTotals(container) {
    const total = grandTotal();
    const swaps = rows.filter(r => r.itemId && r.mode === 'swap' && calc(r).qty > 0).length;
    container.querySelector('#sumCount').textContent = filled().length;
    container.querySelector('#sumSwap').textContent = swaps;
    container.querySelector('#sumTotal').textContent = Utils.formatMoney(total);

    /* عميل نقدي: مفيش حساب ينزل منه، فاختيار "تنزل من الحساب"
       مالوش معنى. بنقفله ونحوّله كاش لوحده بدل ما نوقفه وقت
       الحفظ ونقوله اكتب اسم.

       ولو كتب الاسم بعد كده بنرجّعه "تنزل من الحساب" تاني — إلا لو
       هو بنفسه اختار كاش، ساعتها اختياره هو اللي يفضل. */
    const sm = container.querySelector('#settleMode');
    const cashParty = Services.isCashName((container.querySelector('#retParty') || {}).value || '');
    const accOpt = sm && sm.querySelector('option[value="account"]');
    if (accOpt) {
      accOpt.disabled = cashParty;
      accOpt.textContent = cashParty
        ? 'تنزل من الحساب (اكتب اسم ' + (kind === 'customer' ? 'العميل' : 'المورد') + ' الأول)'
        : 'تنزل من الحساب';
    }
    if (sm) {
      if (cashParty) {
        if (sm.value === 'account') { sm.value = 'cash'; autoCash = true; }
      } else if (autoCash && !settleTouched && sm.value === 'cash') {
        sm.value = 'account'; autoCash = false;
      }
    }

    const hint = container.querySelector('#retHint');
    const settle = sm.value;
    if (total <= 0) {
      hint.textContent = 'مفيش فلوس هتتحرك — استبدال بس.';
      hint.style.color = 'var(--success)';
    } else if (settle === 'account') {
      hint.textContent = kind === 'customer'
        ? 'المبلغ هينزل من حساب العميل.'
        : 'المبلغ هينزل من اللي احنا مدينينه للمورد.';
      hint.style.color = 'var(--amber-deep)';
    } else {
      hint.textContent = kind === 'customer'
        ? 'المبلغ هيطلع كاش من الخزنة للعميل.'
        : 'المبلغ هيدخل كاش في الخزنة.';
      hint.style.color = 'var(--amber-deep)';
    }
  }

  async function doSave(container) {
    if (saving) return;
    const valid = filled();
    if (!valid.length) { Utils.toast('اكتب صنف واحد على الأقل', 'error'); Utils.beep('error'); return; }
    const noPrice = valid.find(r => r.mode === 'money' && !(calc(r).price > 0));
    if (noPrice) { Utils.toast(`اكتب السعر للصنف: ${noPrice.name}`, 'error'); Utils.beep('error'); return; }

    const dateVal = container.querySelector('#retDate').value;
    const date = dateVal ? new Date(dateVal + 'T12:00:00').toISOString() : Utils.nowISO();
    const reason = container.querySelector('#retReason').value.trim();
    let settle = container.querySelector('#settleMode').value;
    let partyName = container.querySelector('#retParty').value.trim();

    // لو مورد ومكتبش الاسم، بناخده من الصنف نفسه
    if (kind === 'supplier' && Services.isCashName(partyName)) {
      const withSup = valid.find(r => r.supplierName);
      if (withSup) partyName = withSup.supplierName;
    }

    /* آخر حاجز: مرتجع لمورد بأصناف مش في فواتيره.
       بنقف ونوضّح، وهو اللي يقرر — لأن فيه بضاعة قديمة من قبل
       البرنامج فواتيرها مش متسجلة، والحصر لوحده كان هيوقّفه. */
    if (kind === 'supplier' && !Services.isCashName(partyName)) {
      const sup = AppState.suppliers.find(s => normName(s.name) === normName(partyName));
      if (sup) {
        const own = itemsBoughtFrom(sup.id);
        if (own.size) {
          const bad = valid.filter(r => !own.has(Number(r.itemId)));
          if (bad.length) {
            Utils.beep('error');
            const ok = await Utils.confirmDialog(
              'الأصناف دي مش موجودة في أي فاتورة شرا من ' + sup.name + ':\n\n' +
              bad.map(r => '• ' + AppState.lineName(r)).join('\n') +
              '\n\nلو كمّلت، قيمتها هتنزل من حساب ' + sup.name +
              ' وهو أصلاً ما باعهالكش.\n\nتكمّل؟');
            if (!ok) return;
          }
        }
      }
    }

    /* عميل نقدي رجّع بضاعة: مفيش حساب أصلاً ينزل منه، فالفلوس
       بتطلع كاش من الخزنة على طول. مش هنوقفه ونطلب منه اسم. */
    const total = grandTotal();
    if (total > 0 && settle === 'account' && Services.isCashName(partyName)) {
      settle = 'cash';
      const sm = container.querySelector('#settleMode');
      if (sm) sm.value = 'cash';
    }

    saving = true;
    const btn = container.querySelector('#saveRet');
    btn.disabled = true; btn.textContent = 'بيحفظ...';
    try {
      const partyId = await Services.resolveParty(
        kind === 'customer' ? 'customers' : 'suppliers', partyName);

      const res = await Services.saveReturn({
        kind, date, partyId, reason, settle,
        // بيتسجل بالوحدة الأصلية (المتر)، وشكل العبوة بيتحفظ جنبها
        lines: valid.map(r => {
          const c = calc(r);
          return {
            itemId: r.itemId, name: r.name, qty: c.baseQty, price: c.basePrice,
            condition: r.condition, mode: r.mode, reason: reason,
            packQty: c.pack ? c.qty : null,
            packPrice: c.pack ? c.price : null,
            packSize: c.pack ? c.size : null,
            packName: c.pack ? c.way.name : null
          };
        })
      });

      await AppState.reloadItems(); await AppState.reloadParties();
      if (typeof refreshShell === 'function') await refreshShell();
      Utils.beep('ok');
      /* بنقوله البضاعة راحت فين بالظبط: السليم دخل المخزن
         والتالف اتحطّ على جنب عشان يرجّعه للمورد */
      const good = valid.filter(r => r.condition !== 'damaged').length;
      const bad = valid.filter(r => r.condition === 'damaged').length;
      const where = kind === 'customer'
        ? [good ? good + ' دخلوا المخزن' : '', bad ? bad + ' تالف مستني يرجع للمورد' : '']
            .filter(Boolean).join(' · ')
        : '';
      Utils.toast(`اتسجل المرتجع ${res.number}` +
        (res.total > 0 ? ` بقيمة ${Utils.formatMoney(res.total)}` : ' (استبدال)') +
        (where ? ' — ' + where : ''), 'success');
      render(container);
    } catch (e) {
      Utils.beep('error');
      Utils.toast(e.message || 'المرتجع مانجحش', 'error');
      btn.disabled = false; btn.textContent = '💾 حفظ المرتجع';
    } finally {
      saving = false;
    }
  }

  /* ---------- التالف اللي عنده، مرتّب على الموردين ----------

     العميل بيرجّع حاجة تالفة: مش بتدخل المخزن ومش بتتباع، بتتحط
     على جنب لحد ما يرجّعها للمورد اللي جابها منه. هنا بيشوفها
     متجمّعة على كل مورد، ودوسة واحدة بتفتحله مرتجع جاهز بيها. */
  function drawDamaged(container) {
    const card = container.querySelector('#dmgCard');
    const list = container.querySelector('#dmgList');
    if (!card || !list) return;
    if (Auth.isSeller()) { card.hidden = true; return; }

    const dmg = AppState.liveItems().filter(i => Number(i.damagedQty || 0) > 0.0001);
    if (!dmg.length) { card.hidden = true; return; }

    const bySup = new Map();
    dmg.forEach(i => {
      const sup = AppState.suppliers.find(s => s.id === i.lastSupplierId);
      const key = sup ? sup.id : 0;
      if (!bySup.has(key)) bySup.set(key, { id: sup ? sup.id : 0, name: sup ? sup.name : 'مش عارف المورد', items: [] });
      bySup.get(key).items.push(i);
    });

    card.hidden = false;
    list.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>المورد</th><th>الأصناف</th><th style="width:120px;">قيمتها</th><th style="width:160px;"></th></tr></thead>
          <tbody>
            ${[...bySup.values()].map(g => {
              const val = g.items.reduce((s, i) => s + Number(i.damagedQty || 0) * Number(i.costPrice || 0), 0);
              return `
              <tr data-sup="${g.id}">
                <td style="font-weight:700;">${Utils.escapeHtml(g.name)}</td>
                <td class="muted" style="font-size:12.5px;">
                  ${g.items.map(i => Utils.escapeHtml(i.name) + ' (' + Units.fmtQty(i.damagedQty, i.unit) + ')').join('، ')}
                </td>
                <td>${Utils.formatMoney(val)}</td>
                <td>${g.id
                  ? '<button type="button" class="btn btn-amber btn-sm dmg-go">↩️ اعملّه مرتجع</button>'
                  : '<span class="hint">افتح الصنف وحدّد مورده الأول</span>'}</td>
              </tr>`; }).join('')}
          </tbody>
        </table>
      </div>`;

    list.querySelectorAll('.dmg-go').forEach(b => b.addEventListener('click', () => {
      const g = bySup.get(Number(b.closest('tr').dataset.sup));
      if (!g) return;
      openDamagedReturn(container, g);
    }));
  }

  /* بيفتح مرتجع لمورد جاهز بالتالف بتاعه */
  async function openDamagedReturn(container, g) {
    if (!(await Lock.require('مرتجع لمورد'))) return;
    kind = 'supplier';
    await render(container);
    const party = container.querySelector('#retParty');
    if (party) { party.value = g.name; party.dispatchEvent(new Event('input', { bubbles: true })); }
    rows = g.items.map(i => {
      const r = blankRow();
      applyItem(r, i);
      r.qty = Number(i.damagedQty || 0);
      r.condition = 'damaged';
      r.price = Number(i.costPrice || 0);
      return r;
    });
    rows.push(blankRow());
    drawRows(container);
    updateTotals(container);
    Utils.toast('جهّزتلك المرتجع — راجع الأسعار ودوس حفظ', 'info');
    window.scrollTo(0, 0);
  }

  async function loadHistory(container) {
    const all = await DB.getAll('returns');
    /* الأحدث الأول. فواتير نفس اليوم كلها بنفس الساعة (٩ الصبح)،
       فلازم نفرّق بينهم برقم التسجيل — الأعلى يعني اتسجل بعدين.
       من غير كده فواتير اليوم كانت بتطلع بالمقلوب: الأقدم فوق. */
    all.sort((a, b) => (new Date(b.date) - new Date(a.date)) || (Number(b.id) - Number(a.id)));
    const box = container.querySelector('#retHistory');
    if (!box) return;
    if (!all.length) {
      box.innerHTML = `<div class="empty-state" style="padding:22px;">مفيش مرتجعات لسه</div>`;
      return;
    }
    const nameOf = (d) => {
      const list = d.kind === 'customer' ? AppState.customers : AppState.suppliers;
      const p = list.find(x => x.id === d.partyId);
      return p ? p.name : 'كاش';
    };
    box.innerHTML = `
      <div class="table-wrap" style="border:none;">
        <table>
          <thead><tr><th>التاريخ</th><th>الرقم</th><th>النوع</th><th>الطرف</th><th>الأصناف</th><th>السبب</th><th>القيمة</th><th></th></tr></thead>
          <tbody>
            ${all.slice(0, 30).map(d => `
              <tr data-id="${d.id}" ${d.voided ? 'style="opacity:.55;"' : ''}>
                <td>${Utils.formatDate(d.date)}</td>
                <td class="strong">${d.number}${d.voided ? ' <span class="badge badge-danger">اتمسح</span>' : ''}</td>
                <td><span class="badge ${d.kind === 'customer' ? 'badge-ok' : 'badge-warn'}">${d.kind === 'customer' ? 'من عميل' : 'لمورد'}</span></td>
                <td>${Utils.escapeHtml(nameOf(d))}</td>
                <td class="muted" style="font-size:12px;">
                  ${d.lines.map(l => Utils.escapeHtml(AppState.lineName(l)) + ' (' +
                    (Number(l.packQty || 0) > 0
                      ? Units.fmtQty(l.packQty, l.packName || 'عبوة') + ' — ' + Units.fmtQty(l.qty, l.unit)
                      : Units.fmtQty(l.qty, l.unit)) +
                    (l.mode === 'swap' ? ' · استبدال' : '') + (l.condition === 'damaged' ? ' · تالف' : '') + ')').join('، ')}
                </td>
                <td class="muted" style="font-size:12px;">${Utils.escapeHtml(d.reason || '—')}</td>
                <td class="strong">${d.total > 0 ? Utils.formatMoney(d.total) : '<span class="swap-tag">استبدال</span>'}</td>
                <td>${d.voided ? '' : '<button class="icon-btn void-ret" title="امسح المرتجع">🗑️</button>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    box.querySelectorAll('.void-ret').forEach(btn => btn.addEventListener('click', async (e) => {
      const id = Number(e.target.closest('tr').dataset.id);
      if (!(await Lock.require('مسح مرتجع'))) return;
      if (!(await Utils.confirmDialog(
        'هيترجع أثر المرتجع بالكامل: المخزن والتالف والفلوس وحساب الطرف. متأكد؟'))) return;
      try {
        await Services.voidReturn(id);
      } catch (err) {
        Utils.beep('error');
        await Utils.confirmDialog(err.message || 'المسح مانجحش');
        return;
      }
      await AppState.reloadItems(); await AppState.reloadParties(); await refreshShell();
      Utils.toast('اتمسح المرتجع', 'success');
      render(container);
    }));
  }

  // فيه مرتجع على الشاشة لسه ما اتحفظش؟ (تحميل النسخة الجديدة بيسأل قبل ما يعيد فتح الصفحة)
  function hasUnsaved() {
    return rows.some(r => r.itemId || (r.name || '').trim() || (r.barcode || '').trim());
  }

  return { render, hasUnsaved };
})();
