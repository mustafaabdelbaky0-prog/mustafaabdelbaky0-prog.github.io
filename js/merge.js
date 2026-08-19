/* دمج بيانات جهازين اشتغلوا وهما مش شايفين بعض

   الفكرة اللي البناء كله قايم عليها:
   فيه نوعين بيانات في البرنامج —

   ١) دفاتر بتتكتب ومبتتغيرش (حركات المخزن، حركات الخزنة، الفواتير،
      المرتجعات، المصروفات). دي بتتجمع ببساطة: كل سجل ليه رقم لوحده
      (شوف device.js) فبنجمع اللي عند الاتنين ومش بيضيع حاجة.

   ٢) أرقام محسوبة من الدفاتر دي (رصيد الصنف، التالف، حساب العميل،
      رصيد الخزنة بعد كل حركة). دي مش بندمجها خالص — بنعيد حسابها
      من الدفاتر بعد الدمج. وده اللي بيخلي البائع يبيع على الكمبيوتر
      وإنت تشتري من الموبايل، وأول ما يتقابلوا يطلع الرصيد صح لوحده.

   ٣) بيانات وصفية (اسم الصنف، الباركود، السعر، اسم العميل). دي إنت
      بس اللي بتعدلها، فبناخد الأحدث بالتاريخ. */

const Merge = (() => {

  // دفاتر: بنجمع سجلاتها من الجهازين
  const LEDGERS = ['stockMovements', 'treasury', 'sales', 'purchases', 'returns', 'expenses'];
  // بيانات وصفية: بناخد الأحدث
  const ENTITIES = ['items', 'customers', 'suppliers', 'fixedAssets', 'company', 'settings'];

  function keyOf(store) { return store === 'settings' ? 'key' : 'id'; }

  function rowsOf(data, store) {
    const v = data && data[store];
    return Array.isArray(v) ? v : [];
  }

  function newer(a, b) {
    const ta = Date.parse(a && a.updatedAt) || 0;
    const tb = Date.parse(b && b.updatedAt) || 0;
    return tb > ta ? b : a;
  }

  /* بيعيد حساب كل الأرقام المحسوبة من الدفاتر.
     بيرجع كمان قايمة بالفروقات اللي لقاها — بنستعملها في الاختبار
     عشان نتأكد إن الحساب المتدرج والحساب من الأول بيطلعوا نفس الرقم. */
  function recompute(data) {
    const fixes = [];
    const round = n => Math.round(n * 1000) / 1000;
    const money = n => Math.round(n * 100) / 100;

    // ---------- رصيد الأصناف من حركات المخزن ----------
    const moves = rowsOf(data, 'stockMovements');
    const stockBy = new Map();
    for (const m of moves) {
      const id = m.itemId;
      stockBy.set(id, (stockBy.get(id) || 0) + Number(m.qty || 0));
    }

    // ---------- التالف من المرتجعات ----------
    const damagedBy = new Map();
    for (const r of rowsOf(data, 'returns')) {
      const isCust = r.kind === 'customer';
      for (const l of (r.lines || [])) {
        if (l.condition !== 'damaged') continue;
        const q = Number(l.qty || 0);
        damagedBy.set(l.itemId, (damagedBy.get(l.itemId) || 0) + (isCust ? q : -q));
      }
    }

    for (const it of rowsOf(data, 'items')) {
      const s = round(stockBy.get(it.id) || 0);
      const d = round(damagedBy.get(it.id) || 0);
      if (Math.abs(Number(it.stock || 0) - s) > 0.0005) {
        fixes.push({ store: 'items', id: it.id, field: 'stock', was: it.stock, now: s });
      }
      if (Math.abs(Number(it.damagedQty || 0) - d) > 0.0005) {
        fixes.push({ store: 'items', id: it.id, field: 'damagedQty', was: it.damagedQty, now: d });
      }
      it.stock = s;
      it.damagedQty = d;
    }

    // ---------- حسابات العملاء والموردين ----------
    const sales = rowsOf(data, 'sales');
    const purchases = rowsOf(data, 'purchases');
    const returns = rowsOf(data, 'returns');
    const treasury = rowsOf(data, 'treasury');

    for (const kind of ['customers', 'suppliers']) {
      const isCust = kind === 'customers';
      for (const p of rowsOf(data, kind)) {
        let calc = Number(p.openingBalance || 0);
        if (isCust) {
          for (const s of sales) {
            if (s.customerId === p.id && !s.voided) calc += Number(s.dueAmount || 0);
          }
        } else {
          for (const u of purchases) {
            if (u.supplierId === p.id && !u.voided) calc += Number(u.dueAmount || 0);
          }
        }
        for (const r of returns) {
          if (r.partyId === p.id && r.kind === (isCust ? 'customer' : 'supplier') && r.settle === 'account') {
            calc -= Number(r.total || 0);
          }
        }
        for (const t of treasury) {
          if (t.refId === p.id && t.source === (isCust ? 'collect' : 'pay')) calc -= Number(t.amount || 0);
        }
        calc = money(calc);
        if (Math.abs(Number(p.balance || 0) - calc) > 0.005) {
          fixes.push({ store: kind, id: p.id, field: 'balance', was: p.balance, now: calc });
        }
        p.balance = calc;
      }
    }

    // ---------- الرصيد بعد كل حركة خزنة ----------
    const sorted = treasury.slice().sort((a, b) => {
      const d = new Date(a.date) - new Date(b.date);
      return d !== 0 ? d : (Number(a.id) - Number(b.id));
    });
    let running = 0;
    for (const t of sorted) {
      running = money(running + (t.direction === 'in' ? Number(t.amount || 0) : -Number(t.amount || 0)));
      if (Math.abs(Number(t.balanceAfter || 0) - running) > 0.005) {
        fixes.push({ store: 'treasury', id: t.id, field: 'balanceAfter', was: t.balanceAfter, now: running });
      }
      t.balanceAfter = running;
    }

    /* رصيد الخزنة المتخزن في الإعدادات لازم يتعاد حسابه كمان.
       من غير كده، لو جهاز فيه رصيد قديم اتزامن بعد الجهاز الصح،
       كان ممكن الرقم القديم يدوس على الصح. الرصيد = مجموع الحركات. */
    const settings = rowsOf(data, 'settings');
    const cashRow = settings.find(s => s.key === 'cashBalance');
    if (cashRow) {
      if (Math.abs(Number(cashRow.value || 0) - running) > 0.005) {
        fixes.push({ store: 'settings', id: 'cashBalance', field: 'value',
                     was: cashRow.value, now: running });
      }
      cashRow.value = running;
    } else if (treasury.length) {
      settings.push({ key: 'cashBalance', value: running });
    }

    return { data, fixes };
  }

  /* بيدمج نسختين. mine = اللي عندي، theirs = اللي جاي من الجهاز التاني */
  function combine(mine, theirs) {
    const outData = {};
    const report = { added: 0, updated: 0, kept: 0 };

    const allStores = new Set([...LEDGERS, ...ENTITIES,
      ...Object.keys(mine || {}), ...Object.keys(theirs || {})]);

    for (const store of allStores) {
      const kn = keyOf(store);
      const map = new Map();

      for (const r of rowsOf(mine, store)) map.set(String(r[kn]), r);

      for (const r of rowsOf(theirs, store)) {
        const k = String(r[kn]);
        if (!map.has(k)) {
          map.set(k, r);
          report.added++;
        } else if (ENTITIES.includes(store)) {
          // بيانات وصفية: الأحدث يكسب
          const win = newer(map.get(k), r);
          if (win !== map.get(k)) { map.set(k, win); report.updated++; }
          else report.kept++;
        } else {
          // دفتر: السجل اتكتب مرة واحدة، بس ممكن يكون اتلغى بعدين
          const a = map.get(k);
          const win = newer(a, r);
          if (win !== a) { map.set(k, win); report.updated++; }
          else report.kept++;
        }
      }
      outData[store] = Array.from(map.values());
    }

    // العدادات في الإعدادات: كل جهاز ليه عداد لوحده (شوف device.js)
    // فمفيش حاجة تتدمج هنا — بس بناخد الأكبر احتياطًا لو اتكرر المفتاح
    const settings = outData['settings'] || [];
    for (const row of settings) {
      if (/Seq(:|$)/.test(String(row.key))) {
        const a = rowsOf(mine, 'settings').find(x => x.key === row.key);
        const b = rowsOf(theirs, 'settings').find(x => x.key === row.key);
        const mx = Math.max(Number((a && a.value) || 0), Number((b && b.value) || 0));
        if (Number(row.value || 0) < mx) row.value = mx;
      }
      // قايمة الأجهزة: بنجمع الاتنين
      if (row.key === 'devices') {
        const a = rowsOf(mine, 'settings').find(x => x.key === 'devices');
        const b = rowsOf(theirs, 'settings').find(x => x.key === 'devices');
        const seen = new Map();
        for (const d of [].concat((a && a.value) || [], (b && b.value) || [])) {
          if (!seen.has(Number(d.no))) seen.set(Number(d.no), d);
        }
        row.value = Array.from(seen.values()).sort((x, y) => x.no - y.no);
      }
    }

    const res = recompute(outData);
    return { data: res.data, fixes: res.fixes, report };
  }

  return { combine, recompute, LEDGERS, ENTITIES };
})();
