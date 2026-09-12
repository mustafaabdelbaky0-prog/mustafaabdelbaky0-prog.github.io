Modules.items = (() => {

  function stockBadge(item) {
    // بالسالب = اتباع ولسه ما اتسجلش في المشتريات
    if (Number(item.stock || 0) < -0.0001) {
      return `<span class="badge badge-danger">لسه ما اتسجلش</span>`;
    }
    if (item.stock <= 0) return `<span class="badge badge-danger">نفذ</span>`;
    if (item.minStock && item.stock <= item.minStock) return `<span class="badge badge-warn">منخفض</span>`;
    return `<span class="badge badge-ok">متوفر</span>`;
  }

  function rowHtml(item) {
    return `
      <tr data-id="${item.id}">
        <td>${Utils.escapeHtml(item.barcode || '—')}</td>
        <td style="font-weight:700;">${Utils.escapeHtml(item.name)}</td>
        <td>${Utils.escapeHtml(item.category || '—')}</td>
        <td>${Utils.escapeHtml(item.unit || 'قطعة')}</td>
        ${Auth.isSeller() ? '' : `<td>${Utils.formatMoney(item.costPrice)}</td>`}
        <td>${Utils.formatMoney(item.salePrice)}
          ${Number(item.packPrice || 0) > 0
            ? `<div class="unit-cost-sub">ال${Utils.escapeHtml(item.packName || 'عبوة')} ${Utils.formatMoney(item.packPrice)}</div>`
            : ''}</td>
        <td>${Units.fmtQty(item.stock, item.unit)}
          ${Number(item.packSize || 0) > 0 && Number(item.stock || 0) > 0
            ? `<div class="unit-cost-sub">${Math.floor(Number(item.stock) / Number(item.packSize))} ${Utils.escapeHtml(item.packName || 'عبوة')} كاملة</div>`
            : ''}</td>
        <td>${stockBadge(item)}</td>
        <td>
          <button class="icon-btn label-item" title="اطبع ملصق باركود">🏷️</button>
          ${Auth.isSeller() ? '' : `
            <button class="icon-btn edit-item" title="تعديل">✏️</button>
            <button class="icon-btn merge-item" title="ادمج صنف تاني جوه ده">🔗</button>
            <button class="icon-btn del-item" title="حذف">🗑️</button>`}
        </td>
      </tr>`;
  }

  async function render(container) {
    await AppState.reloadItems();
    container.innerHTML = `
      <div class="section-head">
        <div class="search-box" style="max-width:340px;">
          <input type="text" id="itemSearch" placeholder="ابحث بالاسم أو الباركود...">
        </div>
        <div class="tag-row">
          <button class="btn btn-ghost" id="dupBtn">🔍 أصناف مكررة <span class="nav-badge" id="dupBadge" hidden></span></button>
          ${Auth.isSeller() ? '' : '<button class="btn btn-ghost" id="mergeBtn" title="نفس الحاجة اتسجلت باسمين؟ ادمجهم تحت كود واحد">🔗 دمج صنفين</button>'}
          <button class="btn btn-ghost" id="bulkLabelBtn">🏷️ طباعة ملصقات</button>
          ${Auth.isSeller() ? '' : '<button class="btn btn-amber" id="addItemBtn">+ إضافة صنف جديد</button>'}
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>الباركود</th><th>الاسم</th><th>التصنيف</th><th>الوحدة</th>
            ${Auth.isSeller() ? '' : '<th>سعر التكلفة</th>'}
            <th>سعر البيع</th><th>الرصيد</th><th>الحالة</th><th></th>
          </tr></thead>
          <tbody id="itemsBody"></tbody>
        </table>
      </div>
    `;

    const tbody = container.querySelector('#itemsBody');

    function draw(list) {
      if (!list.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="${Auth.isSeller() ? 8 : 9}">مفيش أصناف مسجلة لسه</td></tr>`;
        return;
      }
      tbody.innerHTML = list.map(rowHtml).join('');
    }
    draw(AppState.items);

    container.querySelector('#itemSearch').addEventListener('input', Utils.debounce((e) => {
      // البحث اللي بيفهم العربي — والأقرب للي كتبه بييجي الأول
      const q = e.target.value.trim();
      draw(!q ? AppState.items : Search.items(q, AppState.items));
    }, 150));

    const addBtn = container.querySelector('#addItemBtn');
    if (addBtn) addBtn.addEventListener('click', () => openItemForm());
    container.querySelector('#bulkLabelBtn').addEventListener('click', () => openBulkLabels());

    // الأصناف المكررة — بنعدّها ونحطها على الزرار
    async function refreshDupBadge() {
      try {
        const d = await Services.duplicateItems();
        const n = d.groups.length + d.codeDups.length;
        const b = container.querySelector('#dupBadge');
        if (!b) return;
        if (n > 0) { b.textContent = n; b.hidden = false; b.classList.add('badge-neg'); }
        else b.hidden = true;
      } catch (e) { }
    }
    refreshDupBadge();
    container.querySelector('#dupBtn').addEventListener('click', () =>
      openDuplicates(() => { render(container); }));
    const mb = container.querySelector('#mergeBtn');
    if (mb) mb.addEventListener('click', () => openMergeDialog(null, () => render(container)));

    tbody.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const id = Number(tr.dataset.id);
      const item = AppState.items.find(i => i.id === id);
      if (e.target.classList.contains('label-item')) {
        openLabelDialog(item);
      } else if (e.target.classList.contains('edit-item')) {
        openItemForm(item);
      } else if (e.target.classList.contains('merge-item')) {
        // الصنف ده هو اللي هيفضل — يختار اللي هيتدمج فيه
        openMergeDialog(item, () => render(container));
      } else if (e.target.classList.contains('del-item')) {
        /* صنف عليه بيع أو شرا مينفعش يتمسح — لأن حركاته وفواتيره
           هتفضل موجودة وتبقى بتشاور على صنف مش موجود، والتقارير
           هتطلع ناقصة. بنوقفه بدل ما نبوّظ السجل. */
        const moves = await DB.getAllByIndex('stockMovements', 'itemId', id);
        if (moves.length) {
          Utils.beep('error');
          Utils.toast(`"${item.name}" عليه ${moves.length} حركة مخزن — مينفعش يتمسح. لو مش هتتعامل بيه تاني، صفّر رصيده من شاشة المخزون.`, 'error');
          return;
        }
        const ok = await Utils.confirmDialog(`متأكد من حذف الصنف "${item.name}"؟`);
        if (!ok) return;
        await DB.delete('items', id);
        await AppState.reloadItems();
        draw(AppState.items);
        Utils.toast('تم حذف الصنف', 'success');
      }
    });
  }

  function formHtml(item) {
    return `
      <div class="field">
        <label>الباركود</label>
        <div class="search-row">
          <input type="text" id="fBarcode" value="${Utils.escapeHtml(item?.barcode || '')}" placeholder="صوّر الباركود أو اكتبه" style="flex:1;">
          ${Scanner.buttonHtml('fScanBtn')}
        </div>
        <button type="button" id="genBarcodeBtn" class="btn btn-ghost btn-sm" style="margin-top:8px;">الصنف مالوش باركود — ولّد رقم</button>
      </div>
      <div class="field">
        <label>اسم الصنف</label>
        <input type="text" id="fName" value="${Utils.escapeHtml(item?.name || '')}" required autofocus>
      </div>
      <div class="field-row">
        <div class="field">
          <label>التصنيف</label>
          <input type="text" id="fCategory" value="${Utils.escapeHtml(item?.category || '')}" placeholder="كهرباء / حدايد / مفاتيح..." list="catList">
          <datalist id="catList">
            <option value="كهرباء"><option value="حدايد"><option value="مفاتيح"><option value="أدوات"><option value="سباكة">
          </datalist>
        </div>
        <div class="field">
          <label>الوحدة (بيتباع بإيه؟)</label>
          <select id="fUnit">${Units.optionsHtml(item?.unit || 'قطعة')}</select>
          <div class="hint" id="unitHint"></div>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>العبوة اسمها إيه؟ <span class="muted">(اختياري)</span></label>
          <input type="text" id="fPackName" value="${Utils.escapeHtml(item?.packName || '')}" list="packNameList" placeholder="لفة / كرتونة / شيكارة">
          <datalist id="packNameList">${Units.PACK_TYPES.map(p => `<option value="${p}">`).join('')}</datalist>
        </div>
        <div class="field">
          <label>العبوة فيها كام <span id="packUnitLbl"></span>؟</label>
          <input type="number" id="fPackSize" min="0" step="0.01" value="${item?.packSize ?? ''}" placeholder="مثال: 100 — سيبها فاضية لو مش بتشتري بالعبوة">
        </div>
        <div class="field">
          <label>سعر بيع العبوة كاملة <span class="muted">(اختياري)</span></label>
          <input type="number" id="fPackPrice" min="0" step="0.01" value="${item?.packPrice ?? ''}" placeholder="سيبه فاضي لو مش بتبيع عبوة كاملة">
        </div>
      </div>
      <div class="hint" id="packHint" style="margin:-4px 0 14px;"></div>
      <div class="field-row">
        <div class="field">
          <label>سعر التكلفة (شراء)</label>
          <input type="number" id="fCost" min="0" step="0.01" value="${item?.costPrice ?? ''}">
        </div>
        <div class="field">
          <label>سعر البيع (قطاعي)</label>
          <input type="number" id="fPrice" min="0" step="0.01" value="${item?.salePrice ?? ''}" required>
        </div>
        <div class="field">
          <label>سعر الجملة <span class="muted">(للأسطوات — اختياري)</span></label>
          <input type="number" id="fWholesale" min="0" step="0.01" value="${item?.wholesalePrice ?? ''}" placeholder="سيبه فاضي لو مفيش">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>${item ? 'الرصيد الحالي' : 'رصيد أول المدة'}</label>
          <input type="number" id="fStock" step="0.01" value="${item?.stock ?? 0}" ${item ? 'disabled' : ''}>
          ${item ? '<div class="hint">لتعديل الرصيد استخدم "تسوية جرد" من شاشة المخزون</div>' : ''}
        </div>
        <div class="field">
          <label>حد التنبيه الأدنى</label>
          <input type="number" id="fMinStock" min="0" step="0.01" value="${item?.minStock ?? 0}">
        </div>
      </div>
    `;
  }

  // opens the item form; resolves with the saved item (used by sales/purchases quick-add)
  // prefill: string (treated as barcode) or {barcode, name}
  /* ملصق الباركود — للأصناف اللي مالهاش باركود مطبوع من المصنع
     (المسامير، السلك، الحاجات السايبة). بتطبعه وتلزقه فيقراه الليزر. */
  /* طباعة ملصقات لكذا صنف مرة واحدة.

     ده أهم شاشة في موضوع الملصقات: لما تدخل بضاعة جديدة مش هتفضل
     تفتح كل صنف لوحده — تعلّم على اللي عايزه، تكتب عدد الملصقات،
     وتطبع مرة واحدة. */
  function openBulkLabels(preselect) {
    const list = AppState.items.filter(i => (i.barcode || '').trim());
    const pre = new Set((preselect || []).map(Number));

    const { close } = Utils.openModal({
      title: 'طباعة ملصقات باركود',
      wide: true,
      bodyHtml: `
        <div class="filter-row" style="margin-bottom:12px;">
          <div class="field" style="margin:0;flex:2;min-width:200px;">
            <label>ابحث</label>
            <input type="text" id="blSearch" placeholder="اسم الصنف أو الباركود" autocomplete="off">
          </div>
          <div class="field" style="margin:0;min-width:150px;">
            <label>عدد الملصقات للكل</label>
            <input type="number" id="blAll" min="1" max="200" placeholder="مثلاً 10">
          </div>
          <button class="btn btn-ghost" id="blPick">علّم على الكل</button>
          <button class="btn btn-ghost" id="blClear">شيل التعليم</button>
        </div>

        <div class="table-wrap" style="max-height:46vh;overflow-y:auto;">
          <table>
            <thead><tr><th style="width:38px;"></th><th>الصنف</th><th>الباركود</th><th>السعر</th><th>عندك كام</th><th style="width:110px;">عدد الملصقات</th></tr></thead>
            <tbody id="blBody">
              ${list.length ? list.map(i => {
                /* بنوريه رصيد كل صنف جنبه — عشان يعرف يطبع قد إيه
                   من غير ما يخرج من الشاشة ويروح يدوّر في المخزون */
                const have = Math.max(0, Math.round(Number(i.stock || 0) * 1000) / 1000);
                /* اللي بيتباع بالمتر أو الكيلو ملوش ملصق لكل متر —
                   بنقترح عدد العبوات الكاملة لو الصنف ليه عبوة */
                const cnt = !Units.allowsDecimals(i.unit || 'قطعة');
                const pk = Number(i.packSize || 0) > 0 ? Math.floor(have / Number(i.packSize)) : 0;
                const sug = cnt && have > 0 ? Math.min(200, Math.ceil(have))
                          : (pk > 0 ? Math.min(200, pk) : 10);
                return `
                <tr data-id="${i.id}" data-have="${sug}">
                  <td><input type="checkbox" class="bl-chk" ${pre.has(Number(i.id)) ? 'checked' : ''}></td>
                  <td style="font-weight:700;">${Utils.escapeHtml(i.name)}</td>
                  <td style="font-family:monospace;">${Utils.escapeHtml(i.barcode)}</td>
                  <td>${Utils.formatMoney(i.salePrice)}</td>
                  <td class="bl-have">${have > 0
                      ? `<a href="#" class="bl-use" title="خد الرقم ده">${Units.fmtQty(have, i.unit)}</a>` +
                        (pk > 0 ? `<div class="unit-cost-sub">${pk} ${Utils.escapeHtml(i.packName || 'عبوة')}</div>` : '')
                      : '<span class="badge badge-danger">نفذ</span>'}</td>
                  <td><input type="number" class="bl-cnt cell num" min="1" max="200" value="${
                      pre.has(Number(i.id)) ? sug : 1}"></td>
                </tr>`; }).join('')
                : `<tr class="empty-row"><td colspan="6">مفيش أصناف عليها باركود</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="field-row" style="margin-top:14px;">
          <div class="field">
            <label>السعر على الملصق</label>
            <select id="blPrice">
              <option value="1">يظهر</option>
              <option value="0">ما يظهرش</option>
            </select>
          </div>
        </div>
        <div class="notice notice-ok" id="blSum" style="line-height:1.9;"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="blCancel">إلغاء</button>
          <button type="button" class="btn btn-amber" id="blPrint">🖨️ اطبع الملصقات</button>
        </div>`,
      onMount: async (body, closeFn) => {
        const size = await Barcode.labelSize();
        const bodyEl = body.querySelector('#blBody');
        const sumEl = body.querySelector('#blSum');

        function chosen() {
          return [...bodyEl.querySelectorAll('tr[data-id]')]
            .filter(tr => tr.querySelector('.bl-chk').checked)
            .map(tr => {
              const it = list.find(x => x.id === Number(tr.dataset.id));
              return { it, count: Math.max(1, Math.min(200, Number(tr.querySelector('.bl-cnt').value) || 1)) };
            });
        }
        function sync() {
          const c = chosen();
          const total = c.reduce((s, x) => s + x.count, 0);
          sumEl.innerHTML = c.length
            ? `<strong>${c.length}</strong> صنف · <strong>${total}</strong> ملصق ·
               مقاس ${size.w / 10} × ${size.h / 10} سم`
            : 'علّم على الأصناف اللي عايز تطبعلها ملصقات';
          body.querySelector('#blPrint').disabled = c.length === 0;
        }
        bodyEl.addEventListener('change', sync);
        bodyEl.addEventListener('input', sync);

        // دوس على الرصيد → يتحط في خانة عدد الملصقات ويتعلّم عليه
        bodyEl.addEventListener('click', (e) => {
          const link = e.target.closest('.bl-use');
          if (!link) return;
          e.preventDefault();
          const tr = link.closest('tr[data-id]');
          const have = Math.ceil(Number(tr.dataset.have || 0));
          if (have > 0) {
            tr.querySelector('.bl-cnt').value = Math.min(200, have);
            tr.querySelector('.bl-chk').checked = true;
            sync();
          }
        });

        body.querySelector('#blSearch').addEventListener('input', (e) => {
          const q = e.target.value.trim();
          bodyEl.querySelectorAll('tr[data-id]').forEach(tr => {
            tr.style.display = Search.matches(tr.textContent, q) ? '' : 'none';
          });
        });
        body.querySelector('#blPick').addEventListener('click', () => {
          bodyEl.querySelectorAll('tr[data-id]').forEach(tr => {
            if (tr.style.display !== 'none') tr.querySelector('.bl-chk').checked = true;
          });
          sync();
        });
        body.querySelector('#blClear').addEventListener('click', () => {
          bodyEl.querySelectorAll('.bl-chk').forEach(c => { c.checked = false; });
          sync();
        });
        body.querySelector('#blAll').addEventListener('input', (e) => {
          const n = Number(e.target.value || 0);
          if (n <= 0) return;
          bodyEl.querySelectorAll('tr[data-id]').forEach(tr => {
            if (tr.querySelector('.bl-chk').checked) tr.querySelector('.bl-cnt').value = n;
          });
          sync();
        });
        body.querySelector('#blCancel').addEventListener('click', closeFn);
        body.querySelector('#blPrint').addEventListener('click', () => {
          const withPrice = body.querySelector('#blPrice').value === '1';
          const items = chosen().map(x => ({
            name: x.it.name, barcode: x.it.barcode, count: x.count,
            price: withPrice ? x.it.salePrice : 0,
            unit: x.it.unit,
            // سعر العبوة بيظهر جنب سعر الوحدة (المتر واللفة، الكيلو والعلبة)
            packName: withPrice ? x.it.packName : '',
            packPrice: withPrice ? x.it.packPrice : 0
          }));
          if (!items.length) return;
          closeFn();
          Barcode.printLabels(items);
        });
        sync();
      }
    });
    return { close };
  }

  /* ---------- دمج صنفين بإيده ----------
     نفس الحاجة اتسجلت باسمين مختلفين ("لمبه 9وات" و"لمبة ٩ وات
     ليد") وعايزهم تحت كود واحد. البرنامج مش هيلاقيهم لوحده لأن
     الأسامي مختلفة — فهو بيختارهم بنفسه من هنا.

     اللي بيحصل بالظبط: كل حركات وفواتير الصنف التاني بتتحوّل على
     الأول، الرصيد بيتجمع، التكلفة بتتحسب من جديد بالمتوسط، والتاني
     بيتمسح. مفيش فاتورة قديمة بتتغير — بس بقت بتشاور على الكود
     الجديد. */
  function itemCard(it, role) {
    if (!it) return `<div class="mg-card empty">${role === 'keep' ? 'اختار الصنف اللي هيفضل' : 'اختار الصنف اللي هيتدمج فيه'}</div>`;
    const stock = Number(it.stock || 0);
    return `
      <div class="mg-card ${role}">
        <div class="mg-name">${Utils.escapeHtml(it.name)}</div>
        <div class="mg-meta">
          <span>كود <strong>${Utils.escapeHtml(it.barcode || '—')}</strong></span>
          <span>رصيد <strong class="${stock < 0 ? 'neg' : ''}">${Units.fmtQty(stock, it.unit)}</strong></span>
          <span>تكلفة <strong>${Utils.formatMoney(it.costPrice)}</strong></span>
          <span>بيع <strong>${Utils.formatMoney(it.salePrice)}</strong></span>
        </div>
      </div>`;
  }

  function openMergeDialog(preKeep, onDone) {
    let keep = preKeep || null;
    let drop = null;

    Utils.openModal({
      title: '🔗 دمج صنفين تحت كود واحد',
      wide: true,
      bodyHtml: `
        <div class="hint" style="margin-bottom:12px;">
          لو نفس الحاجة اتسجلت باسمين، اختار الاتنين. كل حركات وفواتير
          التاني هتتحوّل على الأول، والرصيد هيتجمع، والتاني هيختفي.
        </div>
        <div class="mg-grid">
          <div class="field">
            <label>الصنف اللي <strong>هيفضل</strong> (بكوده واسمه)</label>
            <input type="text" class="mg-pick" data-role="keep" placeholder="اكتب الاسم أو الكود..." autocomplete="off"
                   value="${keep ? Utils.escapeHtml(keep.name) : ''}">
            <div id="mgKeep">${itemCard(keep, 'keep')}</div>
          </div>
          <div class="mg-swap">
            <button type="button" class="btn btn-ghost btn-sm" id="mgSwap" title="اقلب: خلي التاني هو اللي يفضل">⇄</button>
          </div>
          <div class="field">
            <label>الصنف اللي <strong>هيتدمج ويختفي</strong></label>
            <input type="text" class="mg-pick" data-role="drop" placeholder="اكتب الاسم أو الكود..." autocomplete="off">
            <div id="mgDrop">${itemCard(null, 'drop')}</div>
          </div>
        </div>
        <div id="mgPreview"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="mgCancel">إلغاء</button>
          <button type="button" class="btn btn-amber" id="mgGo" disabled>🔗 ادمج</button>
        </div>`,
      onMount: (body, close) => {
        const preview = () => {
          body.querySelector('#mgKeep').innerHTML = itemCard(keep, 'keep');
          body.querySelector('#mgDrop').innerHTML = itemCard(drop, 'drop');
          const go = body.querySelector('#mgGo');
          const pv = body.querySelector('#mgPreview');
          if (!keep || !drop) { pv.innerHTML = ''; go.disabled = true; return; }
          if (keep.id === drop.id) {
            pv.innerHTML = '<div class="notice notice-warn">ده نفس الصنف — اختار صنف تاني</div>';
            go.disabled = true; return;
          }
          const stock = Number(keep.stock || 0) + Number(drop.stock || 0);
          const kp = Number(keep.salePrice || 0), dp = Number(drop.salePrice || 0);
          const priceDiff = kp > 0 && dp > 0 && Math.abs(kp - dp) > 0.005;
          pv.innerHTML = `
            <div class="notice" style="margin-top:4px;">
              <strong>بعد الدمج:</strong> صنف واحد باسم «${Utils.escapeHtml(keep.name)}» وكود
              <strong>${Utils.escapeHtml(keep.barcode || '—')}</strong> · الرصيد
              <strong>${Units.fmtQty(stock, keep.unit)}</strong> · سعر البيع
              <strong>${Utils.formatMoney(kp || dp)}</strong>
              ${priceDiff ? `<div class="hint" style="color:var(--danger);margin-top:6px;">
                ⚠️ سعر البيع مختلف (${Utils.formatMoney(kp)} / ${Utils.formatMoney(dp)}) — هيفضل سعر
                «${Utils.escapeHtml(keep.name)}». لو ده مش صح اقلبهم بزرار ⇄ أو عدّل السعر بعدين.</div>` : ''}
              ${keep.unit !== drop.unit ? `<div class="hint" style="color:var(--danger);margin-top:6px;">
                ⚠️ الوحدة مختلفة (${Utils.escapeHtml(keep.unit)} / ${Utils.escapeHtml(drop.unit)}) —
                الرصيد هيتجمع بوحدة «${Utils.escapeHtml(keep.unit)}». اتأكد إن ده نفس الصنف فعلاً.</div>` : ''}
            </div>`;
          go.disabled = false;
        };

        // بحث بيفهم العربي في الخانتين
        Picker.bind(body, {
          '.mg-pick': {
            search: (q) => Picker.searchItems(q),
            render: Picker.itemRow,
            onPick: (it, input) => {
              if (input.dataset.role === 'keep') keep = it; else drop = it;
              input.value = it.name;
              preview();
            }
          }
        });

        body.querySelector('#mgSwap').addEventListener('click', () => {
          [keep, drop] = [drop, keep];
          const ins = body.querySelectorAll('.mg-pick');
          ins[0].value = keep ? keep.name : '';
          ins[1].value = drop ? drop.name : '';
          preview();
        });
        body.querySelector('#mgCancel').addEventListener('click', close);
        body.querySelector('#mgGo').addEventListener('click', async () => {
          if (!keep || !drop || keep.id === drop.id) return;
          const ok = await Utils.confirmDialog(
            `هتدمج «${drop.name}» جوه «${keep.name}».\n\n` +
            `كل فواتيره وحركاته هتتحوّل على «${keep.name}» بكود ${keep.barcode || '—'}، وهو هيختفي.\n` +
            `الفواتير القديمة مش هتتغير — بس هتبقى بتشاور على الكود الجديد.\n\nمتأكد؟`);
          if (!ok) return;
          const btn = body.querySelector('#mgGo');
          btn.disabled = true; btn.textContent = 'بيدمج...';
          try {
            const r = await Services.mergeItems(keep.id, drop.id);
            await AppState.reloadItems();
            Utils.toast(`اتدمجوا — اتحوّل ${r.moved} حركة و${r.docs} فاتورة، الرصيد بقى ${Units.fmtQty(r.stock, keep.unit)}`, 'success');
            close();
            if (onDone) onDone();
          } catch (err) {
            Utils.toast(err.message || 'الدمج مانجحش', 'error');
            btn.disabled = false; btn.textContent = '🔗 ادمج';
          }
        });
        preview();
        // لو جاي من سطر معيّن، الفوكس يروح للخانة التانية على طول
        (keep ? body.querySelectorAll('.mg-pick')[1] : body.querySelector('.mg-pick')).focus();
      }
    });
  }

  /* ---------- الأصناف المكررة ----------
     بيحصل لما يكتب نفس الصنف في سطرين في نفس الفاتورة. النتيجة
     صنفين بباركودين والرصيد متقسّم بينهم. هنا بيشوفهم وبيدمجهم. */
  async function openDuplicates(onDone) {
    const d = await Services.duplicateItems();
    const rows = [];

    for (const g of d.codeDups) {
      rows.push({ key: 'c' + g.barcode, title: `باركود مكرر: ${g.barcode}`,
                  bad: true, items: g.items, why: 'نفس الباركود لصنفين — ده مينفعش خالص' });
    }
    for (const g of d.groups) {
      rows.push({
        key: 'n' + g.name, title: g.name, bad: !g.samePrice, items: g.items,
        why: g.samePrice
          ? 'نفس الاسم ونفس سعر البيع — غالبًا هما نفس الصنف'
          : `نفس الاسم بس سعر البيع مختلف (${g.prices.map(p => Utils.formatMoney(p)).join(' و ')}) — ` +
            'لو دول فعلاً حاجتين مختلفين غيّر الاسم، ولو نفس الصنف وحّد السعر وادمجهم'
      });
    }

    const { close } = Utils.openModal({
      title: 'أصناف اتسجلت أكتر من مرة',
      wide: true,
      bodyHtml: rows.length ? `
        <div class="notice notice-ok" style="margin-bottom:14px;line-height:1.9;">
          الدمج بينقل كل حاجة للصنف اللي هتختاره: الرصيد وحركات المخزن
          وسطور فواتير البيع والشرا والمرتجعات. والتكلفة بتتحسب من الأول
          من الحركات كلها. <strong>مفيش حاجة بتضيع.</strong>
        </div>
        <div id="dupList">
          ${rows.map((g, gi) => `
            <div class="card ${g.bad ? 'card-missing' : ''}" style="padding:14px;margin-bottom:12px;" data-g="${gi}">
              <div style="font-weight:800;font-size:15px;margin-bottom:2px;">${Utils.escapeHtml(g.title)}</div>
              <div class="hint" style="margin-bottom:10px;">${Utils.escapeHtml(g.why)}</div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th style="width:120px;">يفضل ده</th><th>الاسم</th><th>الباركود</th>
                    <th>سعر البيع</th><th>سعر الشرا</th><th>الرصيد</th></tr></thead>
                  <tbody>
                    ${g.items.map((i, ii) => `
                      <tr>
                        <td><label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                          <input type="radio" name="keep${gi}" value="${i.id}" ${ii === 0 ? 'checked' : ''}>
                          <span>${ii === 0 ? 'الأساسي' : ''}</span></label></td>
                        <td style="font-weight:700;">${Utils.escapeHtml(i.name)}</td>
                        <td style="font-family:monospace;">${Utils.escapeHtml(i.barcode || '—')}</td>
                        <td>${Utils.formatMoney(i.salePrice)}</td>
                        <td>${Utils.formatMoney(i.costPrice)}</td>
                        <td>${Units.fmtQty(i.stock, i.unit)}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
              <div class="form-actions" style="margin-top:10px;">
                <button type="button" class="btn btn-amber merge-btn" data-g="${gi}">🔗 ادمجهم في المختار</button>
              </div>
            </div>`).join('')}
        </div>`
        : `<div class="empty-state" style="padding:28px;">
             <div class="ic">✅</div>مفيش أصناف مكررة — كل صنف متسجل مرة واحدة.
           </div>`,
      onMount: (body, closeFn) => {
        body.querySelectorAll('.merge-btn').forEach(btn => btn.addEventListener('click', async () => {
          const gi = Number(btn.dataset.g);
          const g = rows[gi];
          const picked = Number(body.querySelector(`input[name="keep${gi}"]:checked`).value);
          const others = g.items.filter(i => Number(i.id) !== picked);
          const keep = g.items.find(i => Number(i.id) === picked);

          const ok = await Utils.confirmDialog(
            `هندمج ${others.length + 1} صنف في:\n\n` +
            `• ${keep.name} — باركود ${keep.barcode}\n\n` +
            `واللي هيتشال:\n` + others.map(o => `• ${o.name} — باركود ${o.barcode} — رصيد ${o.stock}`).join('\n') +
            `\n\nكل الرصيد والحركات والفواتير هتتنقل للصنف الأساسي. نكمّل؟`);
          if (!ok) return;

          btn.disabled = true; btn.textContent = 'بيدمج...';
          try {
            let moved = 0, docs = 0, res = null;
            for (const o of others) {
              res = await Services.mergeItems(picked, o.id);
              moved += res.moved; docs += res.docs;
            }
            await AppState.reloadItems();
            Utils.beep('ok');
            Utils.toast(`اتدمجوا — اتنقل ${moved} حركة و${docs} فاتورة. ` +
                        `الرصيد بقى ${res.stock} والتكلفة ${Utils.formatMoney(res.cost)}`, 'success');
            closeFn();
            if (onDone) onDone();
          } catch (e) {
            btn.disabled = false; btn.textContent = '🔗 ادمجهم في المختار';
            Utils.beep('error');
            await Utils.confirmDialog('الدمج مانجحش: ' + (e.message || e));
          }
        }));
      }
    });
  }

  function openLabelDialog(item) {
    const code = (item.barcode || '').trim();
    if (!code) {
      Utils.toast('الصنف ده مالوش باركود — عدّله وحط له باركود الأول', 'error');
      return;
    }
    let preview = '';
    try { preview = Barcode.svg(code, { height: 44, moduleWidth: 1.5 }); }
    catch (e) { preview = `<div class="notice notice-warn">${Utils.escapeHtml(e.message)}</div>`; }

    /* بنوريه رصيده وبنقترح العدد عليه — عشان ميقعدش يفكّر
       "أنا عندي كام منه؟" ويروح يدوّر في شاشة تانية */
    const have = Math.max(0, Math.round(Number(item.stock || 0) * 1000) / 1000);
    const unit = (item.unit || 'قطعة').trim();
    /* الحاجات اللي بتتعد (قطعة، علبة) كل واحدة عايزة ملصق، فبنقترح
       عدد اللي عنده. لكن اللي بيتباع بالمتر أو الكيلو مبيتلزقش عليه
       ملصق لكل متر — الملصق بيتحط على اللفة أو على الرف. */
    const countable = !Units.allowsDecimals(unit);
    const packs = Number(item.packSize || 0) > 0
      ? Math.floor(have / Number(item.packSize)) : 0;
    const suggest = countable && have > 0 ? Math.min(200, Math.ceil(have))
                  : (packs > 0 ? Math.min(200, packs) : 12);

    Utils.openModal({
      title: 'ملصق باركود: ' + item.name,
      bodyHtml: `
        <div style="text-align:center;padding:10px 0 16px;">${preview}</div>
        <div class="notice ${have > 0 ? 'notice-ok' : 'notice-warn'}" style="margin-bottom:14px;line-height:1.9;">
          ${have > 0
            ? `عندك في المخزن <strong>${Units.fmtQty(have, unit)}</strong> من الصنف ده.` +
              (packs > 0 ? ` يعني <strong>${packs} ${Utils.escapeHtml(item.packName || 'عبوة')}</strong> كاملة.` : '') +
              (countable ? '' : ` <span class="muted">— بيتباع بال${Utils.escapeHtml(unit)}، فالملصق بيتحط على العبوة أو على الرف.</span>`)
            : `الصنف ده رصيده <strong>صفر</strong> في المخزن دلوقتي.`}
        </div>
        <div class="field-row">
          <div class="field">
            <label>عدد الملصقات</label>
            <input type="number" id="lblCount" min="1" max="200" value="${suggest}">
            ${have > 0 ? `<span class="hint">دوس <a href="#" id="lblAll">${
                countable ? Math.min(200, Math.ceil(have)) + ' — عدد اللي عندك'
                          : (packs > 0 ? packs + ' — عدد العبوات اللي عندك' : '12')
              }</a></span>` : ''}
          </div>
          <div class="field">
            <label>السعر على الملصق</label>
            <select id="lblPrice">
              <option value="1">يظهر (${Utils.formatMoney(item.salePrice)})</option>
              <option value="0">ما يظهرش</option>
            </select>
          </div>
        </div>
        <div class="hint" id="lblSizeHint" style="line-height:1.9;"></div>
        <div class="form-actions">
          <button class="btn btn-amber" id="lblPrint">🖨️ اطبع</button>
        </div>`,
      onMount: async (body, close) => {
        const s = await Barcode.labelSize();
        body.querySelector('#lblSizeHint').innerHTML =
          `مقاس الملصق المضبوط: <strong>${s.w / 10} × ${s.h / 10} سم</strong>. ` +
          `لو الرول بتاعك مقاس تاني غيّره من <strong>بيانات المؤسسة ← مقاس ملصق الباركود</strong>.`;
        const allLink = body.querySelector('#lblAll');
        if (allLink) allLink.addEventListener('click', (e) => {
          e.preventDefault();
          body.querySelector('#lblCount').value = suggest;
        });
        body.querySelector('#lblPrint').addEventListener('click', () => {
          const count = Math.max(1, Math.min(200, Number(body.querySelector('#lblCount').value) || 1));
          const withPrice = body.querySelector('#lblPrice').value === '1';
          close();
          Barcode.printLabels([{
            name: item.name, barcode: code, count,
            unit: item.unit,
            packName: withPrice ? item.packName : '',
            packPrice: withPrice ? item.packPrice : 0,
            price: withPrice ? item.salePrice : 0
          }]);
        });
      }
    });
  }

  function openItemForm(item, prefill) {
    const pre = typeof prefill === 'string' ? { barcode: prefill } : (prefill || {});
    return new Promise((resolve) => {
      const { close } = Utils.openModal({
        title: item ? 'تعديل صنف' : 'إضافة صنف جديد',
        bodyHtml: `
          <form id="itemForm">
            ${formHtml(item)}
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" id="cancelItem">إلغاء</button>
              <button type="submit" class="btn btn-amber">${item ? 'حفظ التعديل' : 'إضافة الصنف'}</button>
            </div>
          </form>`,
        onMount: (body) => {
          if (pre.barcode) body.querySelector('#fBarcode').value = pre.barcode;
          if (pre.name) body.querySelector('#fName').value = pre.name;
          body.querySelector('#cancelItem').addEventListener('click', () => { close(); resolve(null); });
          body.querySelector('#genBarcodeBtn').addEventListener('click', async () => {
            body.querySelector('#fBarcode').value = await Utils.genInternalBarcode();
          });
          body.querySelector('#fScanBtn').addEventListener('click', async () => {
            const code = await Scanner.scan();
            if (code) body.querySelector('#fBarcode').value = code;
          });

          // نوضّح للمستخدم إن الوحدة دي بتقبل كسور ولا لأ
          const unitSel = body.querySelector('#fUnit');
          const unitHint = body.querySelector('#unitHint');
          const stockInput = body.querySelector('#fStock');
          // خانات العبوة (لفة سلك، كرتونة مفاتيح...)
          const packNameEl  = body.querySelector('#fPackName');
          const packSizeEl  = body.querySelector('#fPackSize');
          const packPriceEl = body.querySelector('#fPackPrice');
          const packUnitLbl = body.querySelector('#packUnitLbl');
          const packHint    = body.querySelector('#packHint');
          const priceEl     = body.querySelector('#fPrice');

          /* بنوريه على طول: العبوة دي معناها المتر بكام، وأرخص بكام من سعر
             القطاعي. لو طلع أغلى بننبّهه، لأن ده معناه إن فيه رقم غلط. */
          function syncPack() {
            const u = unitSel.value;
            packUnitLbl.textContent = u;
            const size  = Number(packSizeEl.value || 0);
            const total = Number(packPriceEl.value || 0);
            const one   = Number(priceEl.value || 0);
            if (size > 0 && total > 0) {
              const per = total / size;
              const packName = (packNameEl.value || '').trim() || Units.packLabel(u);
              let txt = `ال${packName} فيها ${Units.fmtQty(size, u)} — يعني ال${u} بـ ${Utils.formatMoney(per)}`;
              if (one > 0) {
                const diff = one - per;
                txt += diff > 0
                  ? ` · أرخص من القطاعي بـ ${Utils.formatMoney(diff)} لل${u}`
                  : (diff < 0 ? ` · ⚠️ أغلى من سعر القطاعي — راجع الرقم` : ' · نفس سعر القطاعي');
              }
              packHint.textContent = txt;
            } else if (size > 0) {
              packHint.textContent = 'لو كتبت سعر العبوة كاملة، البياع هيقدر يبيعها عبوة بسعرها من شاشة البيع';
            } else {
              packHint.textContent = '';
            }
          }

          function syncUnit() {
            const u = unitSel.value;
            const dec = Units.allowsDecimals(u);
            unitHint.textContent = dec ? `بيتباع بالكسور (زي ٢.٥ ${u})` : `بيتباع بالعدد الصحيح`;
            if (stockInput) stockInput.step = Units.step(u);
            if (!packNameEl.value.trim()) packNameEl.placeholder = Units.packLabel(u);
            syncPack();
          }
          unitSel.addEventListener('change', syncUnit);
          [packNameEl, packSizeEl, packPriceEl, priceEl].forEach(el =>
            el.addEventListener('input', syncPack));
          syncUnit();
          Utils.guardSubmit(body.querySelector('#itemForm'), async (e) => {
            e.preventDefault();
            const name = body.querySelector('#fName').value.trim();
            if (!name) { Utils.toast('اسم الصنف مطلوب', 'error'); return; }
            let barcode = body.querySelector('#fBarcode').value.trim();
            if (!barcode) barcode = await Utils.genInternalBarcode();

            const existing = AppState.items.find(i => i.barcode === barcode && i.id !== item?.id);
            if (existing) { Utils.toast('في صنف تاني بنفس الباركود: ' + existing.name, 'error'); return; }

            const packSize = Number(body.querySelector('#fPackSize').value || 0);
            const packPrice = Number(body.querySelector('#fPackPrice').value || 0);
            const packName = body.querySelector('#fPackName').value.trim();
            const payload = {
              barcode, name,
              category: body.querySelector('#fCategory').value.trim(),
              unit: body.querySelector('#fUnit').value || 'قطعة',
              packSize: packSize > 0 ? packSize : null,
              packName: packSize > 0 ? (packName || Units.packLabel(body.querySelector('#fUnit').value)) : null,
              packPrice: (packSize > 0 && packPrice > 0) ? packPrice : null,
              costPrice: Number(body.querySelector('#fCost').value || 0),
              salePrice: Number(body.querySelector('#fPrice').value || 0),
              wholesalePrice: Number(body.querySelector('#fWholesale').value || 0) || null,
              minStock: Number(body.querySelector('#fMinStock').value || 0),
              active: true
            };
            if (item) {
              payload.id = item.id;
              payload.stock = item.stock;
            } else {
              payload.stock = Number(body.querySelector('#fStock').value || 0);
            }
            const newId = await DB.put('items', payload);

            // لو الصنف اتسجل برصيد أول المدة، بنسجله كحركة كمان عشان سجل
            // حركة الصنف يفضل مفسّر للكمية اللي عنده (من غير كده الرصيد بيظهر من العدم)
            if (!item && payload.stock > 0) {
              await DB.add('stockMovements', {
                itemId: newId, type: 'adjustment', qty: payload.stock,
                unitCost: payload.costPrice || 0, date: Utils.nowISO(),
                refType: 'opening', refId: null, note: 'رصيد أول المدة'
              });
            }

            await AppState.reloadItems();
            Utils.toast(item ? 'تم حفظ التعديل' : 'تم إضافة الصنف', 'success');
            close();
            const saved = AppState.items.find(i => i.id === (item ? item.id : newId));
            resolve(saved);
          });
        }
      });
    });
  }

  return { render, openItemForm, openBulkLabels, openLabelDialog };
})();
