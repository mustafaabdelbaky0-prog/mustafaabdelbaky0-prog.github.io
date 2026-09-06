/* منطق العمليات الأساسي: بيع/شراء/مصروف/خزنة/أرصدة - كله معاملات ذرية (atomic) */

const Services = (() => {
  const CASH_KEY = 'cashBalance';

  async function getCashBalance() {
    const rec = await DB.get('settings', CASH_KEY);
    return rec ? rec.value : 0;
  }

  async function _readBalance(t) {
    const rec = await DB.reqToPromise(t.objectStore('settings').get(CASH_KEY));
    return rec ? rec.value : 0;
  }

  async function _writeTreasuryMove(t, { direction, amount, source, refId, note, date, name, kind, reversal }) {
    amount = Math.round((Number(amount) || 0) * 100) / 100;
    if (amount <= 0) return null;
    const curBal = await _readBalance(t);
    const newBal = Math.round(((direction === 'in') ? curBal + amount : curBal - amount) * 100) / 100;
    await DB.reqToPromise(t.objectStore('settings').put({ key: CASH_KEY, value: newBal }));
    const when = date || Utils.nowISO();
    const store = t.objectStore('treasury');
    const id = await DB.reqToPromise(store.add({
      date: when, direction, amount, source,
      refId: refId ?? null, note: note || '', name: (name || '').trim(),
      kind: kind || null, balanceAfter: newBal,
      // الحركة دي بترجّع فلوس حركة قبلها (إلغاء أو تعديل مستند)
      reversal: reversal ? true : undefined
    }));

    /* لو الحركة اتسجلت بتاريخ قديم (مثلاً مصروف صرفته امبارح وكتبته
       النهاردة)، يبقى ترتيب الحركات اتغير و"الرصيد بعد الحركة" في
       السطور اللي بعدها بقى غلط. بنعيد حسابه بالترتيب الصح.
       بنعمل ده بس في الحالة دي — مش في كل حركة عادية. */
    const rows = await DB.reqToPromise(store.getAll());
    let outOfOrder = false;
    for (const r of rows) {
      if (Number(r.id) !== Number(id) && new Date(r.date) > new Date(when)) { outOfOrder = true; break; }
    }
    if (outOfOrder) {
      const sorted = rows.slice().sort((a, b) => {
        const d = new Date(a.date) - new Date(b.date);
        return d !== 0 ? d : (Number(a.id) - Number(b.id));
      });
      let run = 0;
      for (const r of sorted) {
        run = Math.round((run + (r.direction === 'in' ? Number(r.amount || 0) : -Number(r.amount || 0))) * 100) / 100;
        if (Math.abs(Number(r.balanceAfter || 0) - run) > 0.005) {
          r.balanceAfter = run;
          await DB.reqToPromise(store.put(r));
        }
      }
    }

    return { id, balanceAfter: newBal };
  }

  /* أرقام الفواتير: بتيجي من عدّاد متخزن، وبيتزوّد جوه نفس المعاملة.
     الطريقة القديمة كانت بتستخدم الوقت بالثانية — لو اتعملت فاتورتين في نفس
     الثانية (أو من الكمبيوتر والموبايل مع بعض) كانوا بياخدوا نفس الرقم. */
  /* لكل جهاز عدّاد لوحده وعلامة في رقم الفاتورة — عشان الكمبيوتر والموبايل
     ميطلعوش فاتورتين مختلفتين بنفس الرقم وهما مقطوعين عن بعض.
     الكمبيوتر الأساسي بيفضل ف-00001 زي ما هو، والموبايل بياخد ف-م2-00001. */
  async function _nextNumber(t, prefix, seqKey) {
    const tag = (typeof Device !== 'undefined') ? Device.tag() : '';
    const key = tag ? (seqKey + ':' + tag) : seqKey;
    const store = t.objectStore('settings');
    const rec = await DB.reqToPromise(store.get(key));
    const next = (rec ? Number(rec.value) : 0) + 1;
    await DB.reqToPromise(store.put({ key: key, value: next }));
    return prefix + (tag ? '-' + tag : '') + '-' + String(next).padStart(5, '0');
  }

  /* ---------- تكلفة الصنف بالمتوسط المرجح ----------
     لو اشتريت ١٠٠ متر بـ ٢٠ وبعدين ١٠٠ بـ ٣٠، يبقى عندك ٢٠٠ متر
     دفعت فيهم ٥,٠٠٠ — يعني المتر بـ ٢٥.

     الطريقة القديمة كانت بتاخد آخر سعر شراء (٣٠) وتحطه على كل الكمية،
     فقيمة المخزون كانت بتطلع ٦,٠٠٠ بدل ٥,٠٠٠، وتكلفة البضاعة المباعة
     تطلع أعلى من الحقيقة والأرباح أقل. ودي طريقة المحاسبة الصح. */
  function _avgIn(oldQty, oldCost, addQty, addCost) {
    const q = Math.round((Number(oldQty) + Number(addQty)) * 1000) / 1000;
    const inCost = Number(addCost) || 0;
    if (q <= 0) return { qty: q, cost: inCost || Number(oldCost) || 0 };
    // لو الرصيد كان بالسالب (اتباع أكتر من الموجود) منبنيش عليه
    const base = Number(oldQty) > 0 ? Number(oldQty) * Number(oldCost || 0) : 0;
    const baseQty = Number(oldQty) > 0 ? Number(oldQty) : 0;
    const cost = (base + Number(addQty) * inCost) / (baseQty + Number(addQty));
    return { qty: q, cost: Math.round(cost * 10000) / 10000 };
  }

  // العكس: بنشيل كمية بتكلفتها (إلغاء فاتورة شراء مثلاً)
  function _avgOut(curQty, curCost, remQty, remCost) {
    const q = Math.round((Number(curQty) - Number(remQty)) * 1000) / 1000;
    if (q <= 0) return { qty: q, cost: Number(curCost) || 0 };
    const val = Number(curQty) * Number(curCost || 0) - Number(remQty) * Number(remCost || 0);
    const cost = val / q;
    return { qty: q, cost: cost > 0 ? Math.round(cost * 10000) / 10000 : Number(curCost) || 0 };
  }

  async function _bumpPartyBalance(t, storeName, partyId, delta) {
    if (!partyId) return;
    const store = t.objectStore(storeName);
    const party = await DB.reqToPromise(store.get(partyId));
    if (!party) return;
    party.balance = Math.round(((party.balance || 0) + delta) * 100) / 100;
    await DB.reqToPromise(store.put(party));
  }

  // ---------- المبيعات ----------
  // sale: { date, lines:[{itemId,name,barcode,qty,price,cost}], discount, paymentMethod, customerId, paidNow }
  async function saveSale(sale) {
    return DB.tx(['items', 'stockMovements', 'sales', 'treasury', 'settings', 'customers'], 'readwrite', async (t) => {
      const itemsStore = t.objectStore('items');
      const movStore = t.objectStore('stockMovements');
      const subtotal = sale.lines.reduce((s, l) => s + l.qty * l.price, 0);
      const total = Math.max(0, Math.round((subtotal - (sale.discount || 0)) * 100) / 100);
      const paidNow = Math.min(sale.paidNow ?? total, total);
      const dueAmount = Math.round((total - paidNow) * 100) / 100;

      for (const line of sale.lines) {
        const item = await DB.reqToPromise(itemsStore.get(line.itemId));
        if (item) {
          item.stock = Math.round(((item.stock || 0) - line.qty) * 1000) / 1000;
          await DB.reqToPromise(itemsStore.put(item));
        }
        await DB.reqToPromise(movStore.add({
          itemId: line.itemId, type: 'sale', qty: -Math.abs(line.qty),
          unitCost: line.cost || 0, date: sale.date || Utils.nowISO(),
          refType: 'sale', refId: null, note: line.name
        }));
      }

      const number = await _nextNumber(t, 'ف', 'saleSeq');
      const saleId = await DB.reqToPromise(t.objectStore('sales').add({
        number, date: sale.date || Utils.nowISO(), lines: sale.lines,
        subtotal, discount: sale.discount || 0, total,
        paymentMethod: dueAmount > 0 ? (paidNow > 0 ? 'mixed' : 'credit') : 'cash',
        customerId: sale.customerId || null, sellerId: sale.sellerId || null,
        paidNow, dueAmount, voided: false
      }));

      if (paidNow > 0) {
        // بتاريخ الفاتورة — لو سجّل فاتورة امبارح، الفلوس دخلت امبارح
        await _writeTreasuryMove(t, { direction: 'in', amount: paidNow, source: 'sale',
          refId: saleId, note: `فاتورة بيع ${number}`, date: sale.date || Utils.nowISO() });
      }
      if (dueAmount > 0 && sale.customerId) {
        await _bumpPartyBalance(t, 'customers', sale.customerId, dueAmount);
      }
      return { id: saleId, number, total, dueAmount };
    });
  }

  async function voidSale(saleId) {
    return DB.tx(['items', 'stockMovements', 'sales', 'treasury', 'settings', 'customers', 'returns'], 'readwrite', async (t) => {
      const salesStore = t.objectStore('sales');
      const sale = await DB.reqToPromise(salesStore.get(saleId));
      if (!sale || sale.voided) return false;
      const itemsStore = t.objectStore('items');

      /* لو فيه مرتجع من نفس العميل بعد الفاتورة دي وما اتربطش بيها،
         مينفعش نلغي — لأننا مش عارفين المرتجع ده منها ولا من فاتورة
         تانية، ولو رجّعنا الكمية كاملة البضاعة والفلوس هيرجعوا مرتين.
         بنقوله يمسح المرتجع الأول. */
      const rets = await DB.reqToPromise(t.objectStore('returns').getAll());
      const saleDay = new Date(sale.date).getTime();
      const itemIds = new Set((sale.lines || []).map(l => Number(l.itemId)));
      const risky = [];
      for (const r of rets) {
        if (r.voided || r.kind !== 'customer') continue;
        if (Number(r.partyId || 0) !== Number(sale.customerId || 0)) continue;
        if (new Date(r.date).getTime() + 86400000 < saleDay) continue;
        for (const l of (r.lines || [])) {
          if (l.saleId) continue;                     // مربوط بفاتورة — مفيش لبس
          if (!itemIds.has(Number(l.itemId))) continue;
          risky.push(`${l.name} (مرتجع ${r.number})`);
        }
      }
      if (risky.length) {
        throw new Error('مينفعش تلغي الفاتورة دي — فيه مرتجع من نفس العميل على نفس الأصناف:\n• ' +
          risky.join('\n• ') +
          '\n\nامسح المرتجع الأول من شاشة المرتجعات، وبعدين الغِ الفاتورة.');
      }

      for (const line of sale.lines) {
        /* بنرجّع اللي لسه مع العميل بس. لو رجّع منها ٣ قبل كده،
           الـ٣ دول رجعوا المخزن خلاص ومش هيرجعوا تاني. */
        const back = Math.round((Number(line.qty || 0) - Number(line.returnedQty || 0)) * 1000) / 1000;
        if (back > 0) {
          const item = await DB.reqToPromise(itemsStore.get(line.itemId));
          if (item) {
            item.stock = Math.round(((item.stock || 0) + back) * 1000) / 1000;
            await DB.reqToPromise(itemsStore.put(item));
          }
          await DB.reqToPromise(t.objectStore('stockMovements').add({
            itemId: line.itemId, type: 'return_in', qty: Math.abs(back),
            unitCost: line.cost || 0, date: Utils.nowISO(), refType: 'sale-void', refId: saleId, note: 'إلغاء فاتورة بيع ' + sale.number
          }));
        }
      }

      /* الفلوس: لازم نفرّق بين المرتجع اللي رجّعناه كاش واللي نزّلناه
         من حساب العميل — الاتنين بيتعاملوا مختلف:
           • كاش   → الفلوس طلعت من الدرج خلاص، مترجعهاش تاني
           • حساب  → نزّلت من اللي عليه خلاص، متنزّلهاش تاني */
      let backFromCash = 0, backFromAccount = 0;
      for (const r of rets) {
        if (r.voided || r.kind !== 'customer') continue;
        const onAccount = !!(r.partyId && r.settle === 'account');
        for (const l of (r.lines || [])) {
          if (Number(l.saleId || 0) !== Number(saleId)) continue;
          if (l.mode === 'swap') continue;
          const amt = Number(l.qty || 0) * Number(l.price || 0);
          if (onAccount) backFromAccount += amt; else backFromCash += amt;
        }
      }
      backFromCash = Math.round(backFromCash * 100) / 100;
      backFromAccount = Math.round(backFromAccount * 100) / 100;

      const backCash = Math.round(Math.max(0, Number(sale.paidNow || 0) - backFromCash) * 100) / 100;
      if (backCash > 0) {
        await _writeTreasuryMove(t, { direction: 'out', amount: backCash, source: 'sale', refId: saleId,
          reversal: true, note: `إلغاء فاتورة بيع ${sale.number}` });
      }
      const backDue = Math.round(Math.max(0, Number(sale.dueAmount || 0) - backFromAccount) * 100) / 100;
      if (backDue > 0 && sale.customerId) {
        await _bumpPartyBalance(t, 'customers', sale.customerId, -backDue);
      }
      sale.voided = true;
      await DB.reqToPromise(salesStore.put(sale));
      return true;
    });
  }

  /* ---------- تعديل فاتورة بيع متسجلة ----------
     بنرجّع أثر الفاتورة القديمة الأول (مخزن + فلوس + حساب العميل)
     وبعدين نطبّق الجديد، وكله في عملية واحدة.

     مهم: مبنمسحش حركات المخزن ولا الخزنة القديمة — بنضيف حركات
     عكسية. لأن الدفاتر دي بتتدمج بين الموبايل والكمبيوتر بالإضافة،
     ولو مسحنا صف هيرجع تاني من الجهاز التاني. وكمان بيفضل عندك
     سجل بكل تعديل حصل. */
  async function updateSale(saleId, sale) {
    return DB.tx(['items', 'stockMovements', 'sales', 'treasury', 'settings', 'customers'], 'readwrite', async (t) => {
      const salesStore = t.objectStore('sales');
      const old = await DB.reqToPromise(salesStore.get(saleId));
      if (!old) throw new Error('الفاتورة مش موجودة');
      if (old.voided) throw new Error('الفاتورة دي ملغاة — مينفعش تتعدّل');

      const itemsStore = t.objectStore('items');
      const movStore = t.objectStore('stockMovements');
      const now = Utils.nowISO();

      // ١) نرجّع أثر القديم
      for (const line of (old.lines || [])) {
        const item = await DB.reqToPromise(itemsStore.get(line.itemId));
        if (item) {
          item.stock = Math.round(((item.stock || 0) + line.qty) * 1000) / 1000;
          await DB.reqToPromise(itemsStore.put(item));
        }
        await DB.reqToPromise(movStore.add({
          itemId: line.itemId, type: 'return_in', qty: Math.abs(line.qty),
          unitCost: line.cost || 0, date: now, refType: 'sale-edit', refId: saleId,
          note: 'تعديل فاتورة بيع ' + old.number
        }));
      }
      if (old.paidNow > 0) {
        await _writeTreasuryMove(t, { direction: 'out', amount: old.paidNow, source: 'sale',
          refId: saleId, reversal: true, note: `تعديل فاتورة بيع ${old.number}` });
      }
      if (old.dueAmount > 0 && old.customerId) {
        await _bumpPartyBalance(t, 'customers', old.customerId, -old.dueAmount);
      }

      // ٢) نطبّق الجديد
      const lines = sale.lines || [];
      if (!lines.length) throw new Error('الفاتورة لازم يكون فيها صنف واحد على الأقل');
      const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
      const total = Math.max(0, Math.round((subtotal - (sale.discount || 0)) * 100) / 100);
      const paidNow = Math.min(sale.paidNow ?? total, total);
      const dueAmount = Math.round((total - paidNow) * 100) / 100;

      for (const line of lines) {
        const item = await DB.reqToPromise(itemsStore.get(line.itemId));
        if (item) {
          item.stock = Math.round(((item.stock || 0) - line.qty) * 1000) / 1000;
          await DB.reqToPromise(itemsStore.put(item));
        }
        await DB.reqToPromise(movStore.add({
          itemId: line.itemId, type: 'sale', qty: -Math.abs(line.qty),
          unitCost: line.cost || 0, date: sale.date || old.date,
          refType: 'sale', refId: saleId, note: line.name
        }));
      }
      if (paidNow > 0) {
        await _writeTreasuryMove(t, { direction: 'in', amount: paidNow, source: 'sale',
          refId: saleId, note: `فاتورة بيع ${old.number} (بعد التعديل)` });
      }
      if (dueAmount > 0 && sale.customerId) {
        await _bumpPartyBalance(t, 'customers', sale.customerId, dueAmount);
      }

      const updated = Object.assign({}, old, {
        date: sale.date || old.date, lines, subtotal,
        discount: sale.discount || 0, total,
        paymentMethod: dueAmount > 0 ? (paidNow > 0 ? 'mixed' : 'credit') : 'cash',
        customerId: sale.customerId || null, sellerId: sale.sellerId || null,
        paidNow, dueAmount,
        editedAt: now
      });
      await DB.reqToPromise(salesStore.put(updated));
      return { id: saleId, number: old.number, total, dueAmount };
    });
  }

  /* ---------- تعديل فاتورة شراء متسجلة ---------- */
  async function updatePurchase(purchaseId, purchase) {
    return DB.tx(['items', 'stockMovements', 'purchases', 'treasury', 'settings', 'suppliers'], 'readwrite', async (t) => {
      const store = t.objectStore('purchases');
      const old = await DB.reqToPromise(store.get(purchaseId));
      if (!old) throw new Error('الفاتورة مش موجودة');
      if (old.voided) throw new Error('الفاتورة دي ملغاة — مينفعش تتعدّل');

      const itemsStore = t.objectStore('items');
      const movStore = t.objectStore('stockMovements');
      const now = Utils.nowISO();

      // ١) نرجّع أثر القديم — البضاعة تطلع من المخزن، والتكلفة ترجع لمتوسطها
      for (const line of (old.lines || [])) {
        const item = await DB.reqToPromise(itemsStore.get(line.itemId));
        if (item) {
          const av = _avgOut(item.stock || 0, item.costPrice || 0, line.qty, line.cost || 0);
          item.stock = av.qty;
          item.costPrice = av.cost;
          await DB.reqToPromise(itemsStore.put(item));
        }
        await DB.reqToPromise(movStore.add({
          itemId: line.itemId, type: 'return_out', qty: -Math.abs(line.qty),
          unitCost: line.cost || 0, date: now, refType: 'purchase-edit', refId: purchaseId,
          note: 'تعديل فاتورة شراء ' + old.number
        }));
      }
      if (old.paidNow > 0) {
        await _writeTreasuryMove(t, { direction: 'in', amount: old.paidNow, source: 'purchase',
          refId: purchaseId, reversal: true, note: `تعديل فاتورة شراء ${old.number}` });
      }
      if (old.dueAmount > 0 && old.supplierId) {
        await _bumpPartyBalance(t, 'suppliers', old.supplierId, -old.dueAmount);
      }

      // ٢) نطبّق الجديد
      const lines = purchase.lines || [];
      if (!lines.length) throw new Error('الفاتورة لازم يكون فيها صنف واحد على الأقل');
      const total = Math.round(lines.reduce((s, l) => s + l.qty * l.cost, 0) * 100) / 100;
      const paidNow = Math.min(purchase.paidNow ?? 0, total);
      const dueAmount = Math.round((total - paidNow) * 100) / 100;

      for (const line of lines) {
        const item = await DB.reqToPromise(itemsStore.get(line.itemId));
        if (item) {
          const av = _avgIn(item.stock || 0, item.costPrice || 0, line.qty, line.cost);
          item.stock = av.qty;
          if (line.cost) item.costPrice = av.cost;
          item.lastSupplierId = purchase.supplierId || item.lastSupplierId || null;
          await DB.reqToPromise(itemsStore.put(item));
        }
        await DB.reqToPromise(movStore.add({
          itemId: line.itemId, type: 'purchase', qty: Math.abs(line.qty),
          unitCost: line.cost, date: purchase.date || old.date,
          refType: 'purchase', refId: purchaseId, note: line.name
        }));
      }
      if (paidNow > 0) {
        await _writeTreasuryMove(t, { direction: 'out', amount: paidNow, source: 'purchase',
          refId: purchaseId, note: `فاتورة شراء ${old.number} (بعد التعديل)` });
      }
      if (dueAmount > 0 && purchase.supplierId) {
        await _bumpPartyBalance(t, 'suppliers', purchase.supplierId, dueAmount);
      }

      const updated = Object.assign({}, old, {
        date: purchase.date || old.date, lines, total,
        supplierId: purchase.supplierId || null,
        paymentMethod: dueAmount > 0 ? (paidNow > 0 ? 'mixed' : 'credit') : 'cash',
        paidNow, dueAmount, editedAt: now
      });
      await DB.reqToPromise(store.put(updated));
      return { id: purchaseId, number: old.number, total, dueAmount };
    });
  }

  /* ---------- مرتجع من فاتورة بيع ----------
     العميل رجّع صنف أو أكتر. بنعدّل الفاتورة نفسها (الكميات والإجمالي) عشان
     كل التقارير تفضل مظبوطة لوحدها، وبنرجّع البضاعة للمخزن.
     المبلغ: بنخصمه الأول من اللي لسه عليه في الفاتورة دي، والباقي بنرجّعه كاش. */
  async function returnSaleItems(saleId, returns) {
    return DB.tx(['items', 'stockMovements', 'sales', 'treasury', 'settings', 'customers'], 'readwrite', async (t) => {
      const salesStore = t.objectStore('sales');
      const sale = await DB.reqToPromise(salesStore.get(saleId));
      if (!sale || sale.voided) throw new Error('الفاتورة مش موجودة أو ملغاة');

      const itemsStore = t.objectStore('items');
      let refundTotal = 0;
      const returnedLines = [];

      for (const r of returns) {
        const qty = Number(r.qty || 0);
        if (qty <= 0) continue;
        const line = sale.lines[r.lineIndex];
        if (!line) continue;
        const already = Number(line.returnedQty || 0);
        const maxQty = Math.round((line.qty - already) * 1000) / 1000;
        if (qty > maxQty) throw new Error(`مينفعش ترجّع أكتر من ${maxQty} من ${line.name}`);

        const amount = Math.round(qty * line.price * 100) / 100;
        refundTotal += amount;
        line.returnedQty = Math.round((already + qty) * 1000) / 1000;

        const item = await DB.reqToPromise(itemsStore.get(line.itemId));
        if (item) {
          item.stock = Math.round(((item.stock || 0) + qty) * 1000) / 1000;
          await DB.reqToPromise(itemsStore.put(item));
        }
        await DB.reqToPromise(t.objectStore('stockMovements').add({
          itemId: line.itemId, type: 'return_in', qty: Math.abs(qty),
          unitCost: line.cost || 0, date: Utils.nowISO(),
          refType: 'sale-return', refId: saleId, note: 'مرتجع من فاتورة ' + sale.number
        }));
        returnedLines.push({ name: line.name, qty, unit: line.unit, amount });
      }

      if (refundTotal <= 0) throw new Error('اكتب الكمية اللي اترجعت');
      refundTotal = Math.round(refundTotal * 100) / 100;

      // الأول بننزّل من اللي لسه عليه في الفاتورة، والباقي كاش
      const fromDue = Math.min(sale.dueAmount || 0, refundTotal);
      const cashBack = Math.round((refundTotal - fromDue) * 100) / 100;

      sale.dueAmount = Math.round(((sale.dueAmount || 0) - fromDue) * 100) / 100;
      sale.paidNow = Math.round(((sale.paidNow || 0) - cashBack) * 100) / 100;
      sale.total = Math.round(((sale.total || 0) - refundTotal) * 100) / 100;
      sale.subtotal = Math.round(((sale.subtotal || 0) - refundTotal) * 100) / 100;
      sale.returns = (sale.returns || []).concat([{ date: Utils.nowISO(), lines: returnedLines, amount: refundTotal }]);
      await DB.reqToPromise(salesStore.put(sale));

      if (fromDue > 0 && sale.customerId) {
        await _bumpPartyBalance(t, 'customers', sale.customerId, -fromDue);
      }
      if (cashBack > 0) {
        await _writeTreasuryMove(t, {
          direction: 'out', amount: cashBack, source: 'sale',
          refId: saleId, note: `مرتجع من فاتورة ${sale.number}`
        });
      }
      return { refundTotal, fromDue, cashBack, number: sale.number };
    });
  }

  /* ---------- تظبيط تكلفة البيعات اللي اتعملت قبل الشرا ----------

     لما يبيع صنف لسه ما دخّلش فاتورة شرائه، البرنامج مبيبقاش عارف
     تكلفته — فبيسجّلها صفر في سطر البيع. لو سيبناها كده، ربح
     البيعة دي هيفضل غلط للأبد (هيبان إن كل الفلوس ربح).

     أول ما يسجّل فاتورة الشراء بقينا عارفين التكلفة، فبنرجع نحطها
     في سطور البيع اللي كانت بصفر — وبكده الربح يبقى صح. */
  async function _fillMissingSaleCosts(t, itemId, cost) {
    if (!(Number(cost) > 0)) return 0;
    const store = t.objectStore('sales');
    const sales = await DB.reqToPromise(store.getAll());
    let fixed = 0;
    for (const s of sales) {
      if (s.voided) continue;
      let touched = false;
      for (const l of (s.lines || [])) {
        if (Number(l.itemId) !== Number(itemId)) continue;
        if (Number(l.cost || 0) > 0) continue;          // تكلفتها معروفة خلاص
        l.cost = Number(cost);
        l.costFilledAt = Utils.nowISO();
        touched = true; fixed++;
      }
      if (touched) {
        s.updatedAt = Utils.nowISO();
        await DB.reqToPromise(store.put(s));
      }
    }
    return fixed;
  }

  // ---------- المشتريات ----------
  // purchase: { date, supplierId, lines:[{itemId,name,barcode,qty,cost}], paidNow }
  async function savePurchase(purchase) {
    return DB.tx(['items', 'stockMovements', 'purchases', 'treasury', 'settings', 'suppliers', 'sales'], 'readwrite', async (t) => {
      const itemsStore = t.objectStore('items');
      const movStore = t.objectStore('stockMovements');
      const total = Math.round(purchase.lines.reduce((s, l) => s + l.qty * l.cost, 0) * 100) / 100;
      const paidNow = Math.min(purchase.paidNow ?? total, total);
      const dueAmount = Math.round((total - paidNow) * 100) / 100;

      for (const line of purchase.lines) {
        const item = await DB.reqToPromise(itemsStore.get(line.itemId));
        if (item) {
          const av = _avgIn(item.stock || 0, item.costPrice || 0, line.qty, line.cost);
          item.stock = av.qty;
          /* لو السعر لسه ما اتكتبش (البضاعة وصلت والتاجر ما بعتش
             السعر)، مبنغيّرش التكلفة المتوسطة — وإلا الصفر ده هيسحب
             متوسط التكلفة لتحت ويخلي الأرباح تبان أعلى من الحقيقة. */
          if (Number(line.cost) > 0) item.costPrice = av.cost;
          // بنفتكر آخر مورد جبنا منه الصنف — عشان لما نرجّعه يطلع اسمه لوحده
          if (purchase.supplierId) item.lastSupplierId = purchase.supplierId;
          await DB.reqToPromise(itemsStore.put(item));
          // بيعات اتعملت قبل ما نعرف التكلفة — دلوقتي بقينا عارفينها
          await _fillMissingSaleCosts(t, line.itemId, line.cost);
        }
        await DB.reqToPromise(movStore.add({
          itemId: line.itemId, type: 'purchase', qty: Math.abs(line.qty),
          unitCost: line.cost, date: purchase.date || Utils.nowISO(),
          refType: 'purchase', refId: null, note: line.name
        }));
      }

      const number = await _nextNumber(t, 'ش', 'purchaseSeq');
      const purchaseId = await DB.reqToPromise(t.objectStore('purchases').add({
        number, date: purchase.date || Utils.nowISO(), lines: purchase.lines, total,
        supplierId: purchase.supplierId || null,
        paymentMethod: dueAmount > 0 ? (paidNow > 0 ? 'mixed' : 'credit') : 'cash',
        paidNow, dueAmount, voided: false
      }));

      if (paidNow > 0) {
        // بتاريخ الفاتورة زي البيع بالظبط
        await _writeTreasuryMove(t, { direction: 'out', amount: paidNow, source: 'purchase',
          refId: purchaseId, note: `فاتورة شراء ${number}`, date: purchase.date || Utils.nowISO() });
      }
      if (dueAmount > 0 && purchase.supplierId) {
        await _bumpPartyBalance(t, 'suppliers', purchase.supplierId, dueAmount);
      }
      return { id: purchaseId, number, total, dueAmount };
    });
  }

  async function voidPurchase(purchaseId) {
    return DB.tx(['items', 'stockMovements', 'purchases', 'treasury', 'settings', 'suppliers'], 'readwrite', async (t) => {
      const purchasesStore = t.objectStore('purchases');
      const purchase = await DB.reqToPromise(purchasesStore.get(purchaseId));
      if (!purchase || purchase.voided) return false;
      const itemsStore = t.objectStore('items');

      /* لو البضاعة اتباعت خلاص، إلغاء فاتورة الشرا هيخلي المخزن بالسالب
         ويطلع رصيد مش حقيقي. بنوقف ونقول له الأصناف بالاسم. */
      const short = [];
      for (const line of purchase.lines) {
        const item = await DB.reqToPromise(itemsStore.get(line.itemId));
        if (!item) continue;
        const after = Math.round(((item.stock || 0) - line.qty) * 1000) / 1000;
        if (after < 0) short.push({ name: item.name, have: item.stock || 0, need: line.qty });
      }
      if (short.length) {
        throw new Error('مينفعش تلغي الفاتورة دي — البضاعة اتباعت:\n' +
          short.map(s => `• ${s.name}: في المخزن ${s.have} والفاتورة فيها ${s.need}`).join('\n') +
          '\n\nلو عايز تصلّح الفاتورة، عدّلها بدل ما تلغيها.');
      }

      for (const line of purchase.lines) {
        const item = await DB.reqToPromise(itemsStore.get(line.itemId));
        if (item) {
          const av = _avgOut(item.stock || 0, item.costPrice || 0, line.qty, line.cost || 0);
          item.stock = av.qty;
          item.costPrice = av.cost;
          await DB.reqToPromise(itemsStore.put(item));
        }
        await DB.reqToPromise(t.objectStore('stockMovements').add({
          itemId: line.itemId, type: 'return_out', qty: -Math.abs(line.qty),
          unitCost: line.cost || 0, date: Utils.nowISO(), refType: 'purchase-void', refId: purchaseId, note: 'إلغاء فاتورة شراء ' + purchase.number
        }));
      }
      if (purchase.paidNow > 0) {
        await _writeTreasuryMove(t, { direction: 'in', amount: purchase.paidNow, source: 'purchase', refId: purchaseId,
          reversal: true, note: `إلغاء فاتورة شراء ${purchase.number}` });
      }
      if (purchase.dueAmount > 0 && purchase.supplierId) {
        await _bumpPartyBalance(t, 'suppliers', purchase.supplierId, -purchase.dueAmount);
      }
      purchase.voided = true;
      await DB.reqToPromise(purchasesStore.put(purchase));
      return true;
    });
  }

  /* ---------- مرتجع لمورد ----------
     إحنا اللي بنرجّع بضاعة للمورد: البضاعة بتتشال من المخزن،
     والمبلغ بينزل الأول من اللي احنا مدينينه ليه، والباقي بياخده كاش
     (يدخل الخزنة، لأننا كنا دفعناه). */
  async function returnPurchaseItems(purchaseId, returns) {
    return DB.tx(['items', 'stockMovements', 'purchases', 'treasury', 'settings', 'suppliers'], 'readwrite', async (t) => {
      const store = t.objectStore('purchases');
      const doc = await DB.reqToPromise(store.get(purchaseId));
      if (!doc || doc.voided) throw new Error('الفاتورة مش موجودة أو ملغاة');

      const itemsStore = t.objectStore('items');
      let refundTotal = 0;
      const returnedLines = [];

      for (const r of returns) {
        const qty = Number(r.qty || 0);
        if (qty <= 0) continue;
        const line = doc.lines[r.lineIndex];
        if (!line) continue;
        const already = Number(line.returnedQty || 0);
        const maxQty = Math.round((line.qty - already) * 1000) / 1000;
        if (qty > maxQty) throw new Error(`مينفعش ترجّع أكتر من ${maxQty} من ${line.name}`);

        const item = await DB.reqToPromise(itemsStore.get(line.itemId));
        const have = item ? Number(item.stock || 0) : 0;
        // مينفعش نرجّع بضاعة مش موجودة في المخزن (يعني اتباعت خلاص)
        if (qty > have + 0.0001) {
          throw new Error(`مفيش رصيد كافي من "${line.name}" — المتاح ${have} بس`);
        }

        const amount = Math.round(qty * line.cost * 100) / 100;
        refundTotal += amount;
        line.returnedQty = Math.round((already + qty) * 1000) / 1000;

        if (item) {
          item.stock = Math.round((have - qty) * 1000) / 1000;
          await DB.reqToPromise(itemsStore.put(item));
        }
        await DB.reqToPromise(t.objectStore('stockMovements').add({
          itemId: line.itemId, type: 'return_out', qty: -Math.abs(qty),
          unitCost: line.cost || 0, date: Utils.nowISO(),
          refType: 'purchase-return', refId: purchaseId, note: 'مرتجع لمورد — فاتورة ' + doc.number
        }));
        returnedLines.push({ name: line.name, qty, unit: line.unit, amount });
      }

      if (refundTotal <= 0) throw new Error('اكتب الكمية اللي هترجّعها');
      refundTotal = Math.round(refundTotal * 100) / 100;

      const fromDue = Math.min(doc.dueAmount || 0, refundTotal);
      const cashBack = Math.round((refundTotal - fromDue) * 100) / 100;

      doc.dueAmount = Math.round(((doc.dueAmount || 0) - fromDue) * 100) / 100;
      doc.paidNow = Math.round(((doc.paidNow || 0) - cashBack) * 100) / 100;
      doc.total = Math.round(((doc.total || 0) - refundTotal) * 100) / 100;
      doc.returns = (doc.returns || []).concat([{ date: Utils.nowISO(), lines: returnedLines, amount: refundTotal }]);
      await DB.reqToPromise(store.put(doc));

      if (fromDue > 0 && doc.supplierId) {
        await _bumpPartyBalance(t, 'suppliers', doc.supplierId, -fromDue);
      }
      if (cashBack > 0) {
        await _writeTreasuryMove(t, {
          direction: 'in', amount: cashBack, source: 'purchase',
          refId: purchaseId, note: `مرتجع لمورد — فاتورة ${doc.number}`
        });
      }
      return { refundTotal, fromDue, cashBack, number: doc.number };
    });
  }

  /* ---------- فاتورة مرتجع مستقلة ----------
     دي بتغطي حالتين حقيقيين في المحل:

     ١) مرتجع بفلوس: العميل رجّع صنف وخد فلوسه (أو انت رجّعت لمورد وخدت فلوسك)
     ٢) استبدال (ضمان): مفيش فلوس بتتحرك — بضاعة بتروح وبضاعة بتيجي

     وكمان بنفرّق بين البضاعة السليمة والتالفة:
     - سليمة → ترجع للمخزن وتتباع تاني
     - تالفة → تروح لرصيد "تالف/ضمان" لحد ما ترجّعها للمورد

     مثال الضمان اللي بيحصل كتير:
       لمبة بضمان باظت → العميل ياخد واحدة جديدة (استبدال، تالف)
         النتيجة: المخزن -1 ، التالف +1
       بعدين ترجّع التالفة للمورد وياخد بدلها (استبدال)
         النتيجة: التالف -1 ، المخزن +1
       المحصلة النهائية صفر — وده الصح. */
  /* ---------- مسح مرتجع متسجل ----------
     بيرجّع كل أثره: المخزن، والتالف، والفلوس، وحساب الطرف.
     زي إلغاء الفاتورة بالظبط — بنضيف حركات عكسية مش بنمسح القديمة،
     عشان الدمج بين الأجهزة يفضل سليم ويفضل عندك سجل. */
  async function voidReturn(returnId) {
    return DB.tx(['items', 'stockMovements', 'returns', 'treasury', 'settings', 'customers', 'suppliers', 'sales'], 'readwrite', async (t) => {
      const store = t.objectStore('returns');
      const doc = await DB.reqToPromise(store.get(returnId));
      if (!doc) throw new Error('المرتجع مش موجود');
      if (doc.voided) throw new Error('المرتجع ده متمسوح خلاص');

      const itemsStore = t.objectStore('items');
      const movStore = t.objectStore('stockMovements');
      const isCustomer = doc.kind === 'customer';
      const now = Utils.nowISO();

      // بنتأكد الأول إن الرجوع مش هيخلي أي رصيد بالسالب
      const shortage = [];
      for (const l of (doc.lines || [])) {
        const item = await DB.reqToPromise(itemsStore.get(l.itemId));
        if (!item) continue;
        const qty = Number(l.qty || 0);
        const isDamaged = l.condition === 'damaged';
        const swap = l.mode === 'swap';
        let stock = Number(item.stock || 0), damaged = Number(item.damagedQty || 0);

        if (isCustomer) {
          if (isDamaged) damaged -= qty; else stock -= qty;
          if (swap) stock += qty;
        } else {
          if (isDamaged) damaged += qty; else stock += qty;
          if (swap) stock -= qty;
        }
        if (stock < -0.0001) shortage.push(`${item.name}: المخزن هيبقى ${Math.round(stock * 1000) / 1000}`);
        if (damaged < -0.0001) shortage.push(`${item.name}: التالف هيبقى ${Math.round(damaged * 1000) / 1000}`);
      }
      if (shortage.length) {
        throw new Error('مينفعش تمسح المرتجع ده — البضاعة اتحركت بعده:\n• ' + shortage.join('\n• '));
      }

      for (const l of (doc.lines || [])) {
        const item = await DB.reqToPromise(itemsStore.get(l.itemId));
        if (!item) continue;
        const qty = Number(l.qty || 0);
        const isDamaged = l.condition === 'damaged';
        const swap = l.mode === 'swap';

        if (isCustomer) {
          if (isDamaged) item.damagedQty = Math.round((Number(item.damagedQty || 0) - qty) * 1000) / 1000;
          else item.stock = Math.round((Number(item.stock || 0) - qty) * 1000) / 1000;
          if (swap) item.stock = Math.round((Number(item.stock || 0) + qty) * 1000) / 1000;
        } else {
          if (isDamaged) item.damagedQty = Math.round((Number(item.damagedQty || 0) + qty) * 1000) / 1000;
          else item.stock = Math.round((Number(item.stock || 0) + qty) * 1000) / 1000;
          if (swap) item.stock = Math.round((Number(item.stock || 0) - qty) * 1000) / 1000;
        }
        await DB.reqToPromise(itemsStore.put(item));

        // حركة عكسية للمخزن (التالف مالوش حركة مخزن أصلاً)
        if (!isDamaged) {
          await DB.reqToPromise(movStore.add({
            itemId: item.id, type: isCustomer ? 'return_out' : 'return_in',
            qty: isCustomer ? -Math.abs(qty) : Math.abs(qty),
            unitCost: item.costPrice || 0, date: now,
            refType: 'return-void', refId: returnId, note: 'مسح مرتجع ' + doc.number
          }));
        }
        if (swap) {
          await DB.reqToPromise(movStore.add({
            itemId: item.id, type: isCustomer ? 'return_in' : 'sale',
            qty: isCustomer ? Math.abs(qty) : -Math.abs(qty),
            unitCost: item.costPrice || 0, date: now,
            refType: 'return-void', refId: returnId, note: 'مسح بديل مرتجع ' + doc.number
          }));
        }
      }

      // الفلوس
      const money = Number(doc.total || 0);
      if (money > 0) {
        if (doc.partyId && doc.settle === 'account') {
          await _bumpPartyBalance(t, isCustomer ? 'customers' : 'suppliers', doc.partyId, money);
        } else {
          await _writeTreasuryMove(t, {
            direction: isCustomer ? 'in' : 'out', amount: money,
            source: isCustomer ? 'sale' : 'purchase', refId: returnId,
            note: 'مسح مرتجع ' + doc.number
          });
        }
      }

      /* لو المرتجع كان مربوط بفاتورة، لازم نفك الربط —
         وإلا الفاتورة تفضل فاكرة إن فيها كمية مترجعة وهي مرجعتش */
      for (const l of (doc.lines || [])) {
        if (!l.saleId) continue;
        const s = await DB.reqToPromise(t.objectStore('sales').get(l.saleId));
        if (!s || !s.lines || !s.lines[l.saleLineIndex]) continue;
        const sl = s.lines[l.saleLineIndex];
        sl.returnedQty = Math.max(0, Math.round(
          ((Number(sl.returnedQty || 0)) - Number(l.qty || 0)) * 1000) / 1000);
        await DB.reqToPromise(t.objectStore('sales').put(s));
      }

      doc.voided = true;
      doc.voidedAt = now;
      await DB.reqToPromise(store.put(doc));
      return true;
    });
  }

  /* ---------- ربط المرتجع بالفاتورة اللي جه منها ----------

     شاشة المرتجعات مش بتسأل عن رقم الفاتورة — العميل بيجي بالقطعة
     في إيده والبياع بيكتبها وخلاص، وده الصح في محل عدة.

     بس البرنامج محتاج يعرف المرتجع ده من أنهي فاتورة، عشان:
       • لو لغيت الفاتورة بعد كده، البضاعة والفلوس ما يرجعوش مرتين
       • جدول ربح الأصناف يخصم المرتجع
       • عمولة البائع تتحسب على المبيع الصافي

     فبيدوّر لوحده: آخر فاتورة لنفس العميل فيها الصنف ده ولسه
     فيها كمية مترجعتش. لو ملقاش (عميل كاش مثلاً) بيسيبه من غير
     ربط زي ما كان — مفيش حاجة بتتكسر. */
  const LINK_WINDOW_DAYS = 120;

  async function _linkReturnToSale(t, itemId, qty, partyId, dateISO) {
    const sales = await DB.reqToPromise(t.objectStore('sales').getAll());
    const when = new Date(dateISO || Utils.nowISO()).getTime();
    const oldestOk = when - LINK_WINDOW_DAYS * 86400000;
    let best = null, bestLine = -1;
    for (const s of sales) {
      if (s.voided) continue;
      /* لو العميل معروف بندوّر في فواتيره هو. ولو المرتجع كاش
         (زبون عدّى وراح) بندوّر في فواتير الكاش — أغلب البيع في
         المحل كاش، ولو ما ربطناهاش العمولة والأرباح تطلع غلط. */
      if (partyId) { if (Number(s.customerId) !== Number(partyId)) continue; }
      else { if (s.customerId) continue; }
      const sd = new Date(s.date).getTime();
      if (sd > when + 86400000) continue;   // فاتورة بعد المرتجع
      if (sd < oldestOk) continue;          // أقدم من اللازم
      const lines = s.lines || [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (Number(l.itemId) !== Number(itemId)) continue;
        const left = Math.round((Number(l.qty || 0) - Number(l.returnedQty || 0)) * 1000) / 1000;
        if (left + 0.0001 < qty) continue;
        // بناخد الأحدث — الأقرب للمرتجع
        if (!best || new Date(s.date).getTime() > new Date(best.date).getTime()) { best = s; bestLine = i; }
      }
    }
    if (!best) return null;
    const line = best.lines[bestLine];
    line.returnedQty = Math.round(((Number(line.returnedQty || 0)) + qty) * 1000) / 1000;
    await DB.reqToPromise(t.objectStore('sales').put(best));
    return { saleId: best.id, saleNumber: best.number, lineIndex: bestLine, sellerId: best.sellerId || null };
  }

  async function saveReturn(doc) {
    return DB.tx(['items', 'stockMovements', 'returns', 'treasury', 'settings', 'customers', 'suppliers', 'sales'], 'readwrite', async (t) => {
      const itemsStore = t.objectStore('items');
      const movStore = t.objectStore('stockMovements');
      const isCustomer = doc.kind === 'customer';

      let moneyTotal = 0;
      const lines = [];

      for (const l of doc.lines) {
        const qty = Number(l.qty || 0);
        const price = Number(l.price || 0);
        if (qty <= 0) continue;

        const item = await DB.reqToPromise(itemsStore.get(l.itemId));
        if (!item) throw new Error('صنف مش موجود: ' + l.name);
        const stock = Number(item.stock || 0);
        const damaged = Number(item.damagedQty || 0);
        const swap = l.mode === 'swap';
        const isDamaged = l.condition === 'damaged';

        if (isCustomer) {
          // العميل رجّع بضاعة
          if (isDamaged) item.damagedQty = Math.round((damaged + qty) * 1000) / 1000;
          else item.stock = Math.round((stock + qty) * 1000) / 1000;

          await DB.reqToPromise(movStore.add({
            itemId: item.id, type: 'return_in', qty: isDamaged ? 0 : Math.abs(qty),
            unitCost: item.costPrice || 0, date: doc.date,
            refType: 'return', refId: null,
            note: (isDamaged ? 'مرتجع تالف من عميل' : 'مرتجع من عميل') + (l.reason ? ' — ' + l.reason : '')
          }));

          if (swap) {
            // بيديله واحدة جديدة بدلها من المخزن
            const cur = Number(item.stock || 0);
            if (qty > cur + 0.0001) throw new Error(`مفيش رصيد كافي من "${item.name}" عشان تديله بديل — المتاح ${cur}`);
            item.stock = Math.round((cur - qty) * 1000) / 1000;
            await DB.reqToPromise(movStore.add({
              itemId: item.id, type: 'sale', qty: -Math.abs(qty),
              unitCost: item.costPrice || 0, date: doc.date,
              refType: 'return-swap', refId: null, note: 'بديل ضمان للعميل'
            }));
          } else {
            moneyTotal += qty * price;
          }
        } else {
          // إحنا بنرجّع للمورد
          const takeFrom = isDamaged ? damaged : stock;
          if (qty > takeFrom + 0.0001) {
            throw new Error(`مفيش رصيد كافي من "${item.name}" ${isDamaged ? 'في التالف' : 'في المخزن'} — المتاح ${takeFrom}`);
          }
          if (isDamaged) item.damagedQty = Math.round((damaged - qty) * 1000) / 1000;
          else item.stock = Math.round((stock - qty) * 1000) / 1000;

          await DB.reqToPromise(movStore.add({
            itemId: item.id, type: 'return_out', qty: isDamaged ? 0 : -Math.abs(qty),
            unitCost: item.costPrice || 0, date: doc.date,
            refType: 'return', refId: null,
            note: 'مرتجع لمورد' + (l.reason ? ' — ' + l.reason : '')
          }));

          if (swap) {
            // المورد بيجيبلي بديل جديد
            item.stock = Math.round((Number(item.stock || 0) + qty) * 1000) / 1000;
            await DB.reqToPromise(movStore.add({
              itemId: item.id, type: 'purchase', qty: Math.abs(qty),
              unitCost: item.costPrice || 0, date: doc.date,
              refType: 'return-swap', refId: null, note: 'بديل ضمان من المورد'
            }));
          } else {
            moneyTotal += qty * price;
          }
        }

        await DB.reqToPromise(itemsStore.put(item));

        /* بنثبّت التكلفة وقت المرتجع. من غير كده التقارير كانت
           بتحسب تكلفة المرتجع بسعر النهاردة، فلو اشترى بضاعة بسعر
           جديد كان ربح الشهور اللي فاتت بيتغيّر لوحده. */
        const costNow = Math.round(Number(item.costPrice || 0) * 100) / 100;

        // بنحاول نربطه بالفاتورة (للعملاء بس — المورد ملوش فاتورة بيع)
        let link = null;
        if (isCustomer && !swap) {
          link = await _linkReturnToSale(t, item.id, qty, doc.partyId, doc.date);
        }

        lines.push({
          itemId: item.id, name: item.name, unit: item.unit, qty, price,
          cost: costNow,
          saleId: link ? link.saleId : null,
          saleNumber: link ? link.saleNumber : null,
          saleLineIndex: link ? link.lineIndex : null,
          sellerId: link ? link.sellerId : null,
          condition: l.condition, mode: l.mode, reason: l.reason || '',
          partyId: l.partyId || null,
          // لو رجّع لفة كاملة بنفتكرها بشكلها ده كمان (الكمية فوق بالمتر)
          packQty: l.packQty || null,
          packPrice: l.packPrice != null ? l.packPrice : null,
          packSize: l.packSize || null,
          packName: l.packName || null
        });
      }

      if (!lines.length) throw new Error('اكتب صنف واحد على الأقل');
      moneyTotal = Math.round(moneyTotal * 100) / 100;

      const number = await _nextNumber(t, isCustomer ? 'مر' : 'مم', isCustomer ? 'custReturnSeq' : 'supReturnSeq');
      const retId = await DB.reqToPromise(t.objectStore('returns').add({
        number, date: doc.date, kind: doc.kind, partyId: doc.partyId || null,
        reason: doc.reason || '', lines, total: moneyTotal, settle: doc.settle || 'account'
      }));

      // حركة الفلوس (لو فيه)
      if (moneyTotal > 0) {
        const store = isCustomer ? 'customers' : 'suppliers';
        if (doc.partyId && doc.settle === 'account') {
          // بينزل من حساب الطرف
          await _bumpPartyBalance(t, store, doc.partyId, -moneyTotal);
        } else {
          // كاش: العميل بياخد فلوس (خارج) / المورد بيدينا فلوس (داخل)
          await _writeTreasuryMove(t, {
            direction: isCustomer ? 'out' : 'in', amount: moneyTotal,
            source: isCustomer ? 'sale' : 'purchase', refId: retId,
            note: `مرتجع ${number}`
          });
        }
      }

      return { id: retId, number, total: moneyTotal };
    });
  }

  // ---------- المصروفات ----------
  async function saveExpense(expense) {
    return DB.tx(['expenses', 'treasury', 'settings'], 'readwrite', async (t) => {
      const id = await DB.reqToPromise(t.objectStore('expenses').add({
        date: expense.date || Utils.nowISO(), category: expense.category,
        description: expense.description || '', amount: expense.amount
      }));
      // الفلوس تطلع من الخزنة بنفس تاريخ المصروف — لو سجّلته بتاريخ
      // امبارح، حركة الخزنة تبقى امبارح كمان مش النهاردة
      await _writeTreasuryMove(t, { direction: 'out', amount: expense.amount, source: 'expense',
        refId: id, note: expense.category, date: expense.date });
      return id;
    });
  }

  async function deleteExpense(expenseId) {
    return DB.tx(['expenses', 'treasury', 'settings'], 'readwrite', async (t) => {
      const store = t.objectStore('expenses');
      const exp = await DB.reqToPromise(store.get(expenseId));
      if (!exp) return false;
      /* مصروف المرتبات جاي من تقفيل شهر — وما خرجش فلوس من الخزنة وقتها
         (الفلوس بتخرج لما تصرف للموظف). لو مسحناه من هنا كنا هنرجّع
         للخزنة فلوس ما خرجتش، ونسيب تقفيل الشهر معلّق. */
      if (exp.source === 'payroll') {
        throw new Error('ده مرتب موظف من تقفيل الشهر — امسحه من كشف حساب الموظف (فك التقفيل)');
      }
      if (exp.source === 'depreciation') {
        throw new Error('ده إهلاك أصول ثابتة — امسحه من شاشة الأصول الثابتة');
      }
      await _writeTreasuryMove(t, { direction: 'in', amount: exp.amount, source: 'expense', refId: expenseId,
        reversal: true, note: 'إلغاء مصروف: ' + exp.category });
      await DB.reqToPromise(store.delete(expenseId));
      return true;
    });
  }

  // ---------- الخزنة اليدوية ----------
  async function manualTreasuryMove(direction, amount, note, name, date, kind) {
    return DB.tx(['treasury', 'settings'], 'readwrite', (t) =>
      _writeTreasuryMove(t, { direction, amount, name, kind,
        source: direction === 'in' ? 'deposit' : 'withdrawal', note, date })
    );
  }

  // ---------- تحصيل من عميل / سداد لمورد ----------
  async function collectFromCustomer(customerId, amount, note, date) {
    return DB.tx(['customers', 'treasury', 'settings'], 'readwrite', async (t) => {
      await _bumpPartyBalance(t, 'customers', customerId, -amount);
      return _writeTreasuryMove(t, { direction: 'in', amount, source: 'collect',
        refId: customerId, note: note || 'تحصيل من عميل', date });
    });
  }

  /* ---------- تعديل ومسح حركة خزنة ----------
     الحركات اللي جاية من مستند (فاتورة، مصروف، سلفة...) مش بتتعدّل من
     هنا — لازم تتعدّل من مكانها عشان المستند والخزنة يفضلوا متطابقين.
     اللي بيتعدّل هنا هو الإيداع والسحب اليدوي بس. */
  const MANUAL_SOURCES = ['deposit', 'withdrawal'];

  function isManualMove(m) {
    return !!m && MANUAL_SOURCES.includes(m.source);
  }

  /* ---------- الحركات اللي اتلغت أو اتعدلت ----------

     لما تعدّل فاتورة، الخزنة بتسجّل ٣ سطور: الفاتورة الأصلية، وسطر
     بيرجّع فلوسها، وسطر الفاتورة الجديدة. ولما تلغي فاتورة بيبقى
     سطرين. ده لازم يفضل كده — دي فلوس، والدفتر المالي مبيتمسحش منه
     أبدًا وإلا الأرقام تبوظ ومتعرفش بعدين اللي حصل إيه.

     بس صاحب المحل مش محتاج يشوف ٣ سطور لعملية واحدة. الدالة دي
     بتطلّع أرقام السطور اللي بتلغي بعضها عشان الشاشة تخبّيهم أو
     تعرضهم بلون الملغي.

     بتشتغل بحاجتين: العلامة اللي البرنامج بيكتبها دلوقتي (reversal)،
     وكمان بيان الحركة نفسه — عشان الحركات القديمة اللي اتسجلت قبل
     ما نضيف العلامة تتحسب صح هي كمان. */
  const REVERSAL_NOTE = /^\s*(إلغاء|الغاء|تعديل)\s/;

  function isReversalMove(m) {
    if (!m) return false;
    if (m.reversal === true) return true;
    return REVERSAL_NOTE.test(String(m.note || ''));
  }

  function reversedMoveIds(rows) {
    const sorted = (rows || []).slice().sort((a, b) => Number(a.id) - Number(b.id));
    const paired = new Set();   // أصل اتربط بحركة إلغاء خلاص
    const out = new Set();

    for (const rev of sorted) {
      if (!isReversalMove(rev)) continue;
      /* بندوّر على الأصل: نفس المستند، عكس الاتجاه، نفس المبلغ،
         ومتسجّل قبلها. لو اتعدلت أكتر من مرة بناخد الأقرب ليها. */
      let orig = null;
      for (const o of sorted) {
        if (Number(o.id) >= Number(rev.id)) break;
        if (paired.has(Number(o.id))) continue;
        if (isReversalMove(o)) continue;
        if (String(o.refId ?? '') !== String(rev.refId ?? '')) continue;
        if (o.direction === rev.direction) continue;
        if (Math.abs(Number(o.amount || 0) - Number(rev.amount || 0)) > 0.005) continue;
        orig = o;
      }
      if (!orig) continue;
      paired.add(Number(orig.id));
      out.add(Number(orig.id));
      out.add(Number(rev.id));
    }
    return out;
  }

  async function _restack(t) {
    const store = t.objectStore('treasury');
    const rows = await DB.reqToPromise(store.getAll());
    const sorted = rows.slice().sort((a, b) => {
      const d = new Date(a.date) - new Date(b.date);
      return d !== 0 ? d : (Number(a.id) - Number(b.id));
    });
    let run = 0;
    for (const r of sorted) {
      run = Math.round((run + (r.direction === 'in' ? Number(r.amount || 0) : -Number(r.amount || 0))) * 100) / 100;
      if (Math.abs(Number(r.balanceAfter || 0) - run) > 0.005) {
        r.balanceAfter = run;
        await DB.reqToPromise(store.put(r));
      }
    }
    await DB.reqToPromise(t.objectStore('settings').put({ key: CASH_KEY, value: run }));
    return run;
  }

  async function updateTreasuryMove(id, { direction, amount, name, note, date, kind }) {
    return DB.tx(['treasury', 'settings'], 'readwrite', async (t) => {
      const store = t.objectStore('treasury');
      const m = await DB.reqToPromise(store.get(id));
      if (!m) throw new Error('الحركة دي مش موجودة');
      if (!isManualMove(m)) throw new Error('الحركة دي جاية من مستند — عدّلها من مكانها');
      const amt = Math.round((Number(amount) || 0) * 100) / 100;
      if (amt <= 0) throw new Error('اكتب مبلغ صحيح');
      m.direction = direction === 'in' ? 'in' : 'out';
      m.source = m.direction === 'in' ? 'deposit' : 'withdrawal';
      m.amount = amt;
      m.name = (name || '').trim();
      m.note = (note || '').trim();
      m.kind = kind || null;
      if (date) m.date = date;
      await DB.reqToPromise(store.put(m));
      return _restack(t);
    });
  }

  async function deleteTreasuryMove(id) {
    return DB.tx(['treasury', 'settings'], 'readwrite', async (t) => {
      const store = t.objectStore('treasury');
      const m = await DB.reqToPromise(store.get(id));
      if (!m) throw new Error('الحركة دي مش موجودة');
      if (!isManualMove(m)) throw new Error('الحركة دي جاية من مستند — امسح المستند نفسه');
      await DB.reqToPromise(store.delete(id));
      return _restack(t);
    });
  }

  /* سداد لمورد — بينزل من الخزنة ومن حساب المورد في نفس الوقت.
     مهم: ده مش "مصروف". البضاعة اتحسبت عليك يوم ما اشتريتها، فلو
     حسبنا الدفعة مصروف كمان كانت هتتحسب مرتين والأرباح تطلع غلط. */
  async function payToSupplier(supplierId, amount, note, date) {
    return DB.tx(['suppliers', 'treasury', 'settings'], 'readwrite', async (t) => {
      await _bumpPartyBalance(t, 'suppliers', supplierId, -amount);
      return _writeTreasuryMove(t, { direction: 'out', amount, source: 'pay',
        refId: supplierId, note: note || 'سداد لمورد', date });
    });
  }

  /* ================= الموظفين =================

     حساب الموظف زي دفتر: كل سطر إما "ليه" (credit) أو "عليه" (debit).
       ليه   : المرتب، العمولة، المكافأة
       عليه  : السلفة، اللي صرفته له، الخصم
     الرصيد = المجموع = اللي لسه مستحق له.

     نقطة مهمة في الحسابات: السلفة **مش مصروف**. هي فلوس من مرتبه
     خرجت بدري. المصروف بيتسجل مرة واحدة يوم ما تقفل الشهر بمرتبه
     كامل + عمولته. لو حسبنا السلفة مصروف كمان كان المرتب هيتحسب
     مرتين والأرباح تطلع غلط. */

  const EMP_CREDIT = ['salary', 'commission', 'bonus'];

  async function _writeEmployeeMove(t, { employeeId, dir, type, amount, note, date, refType, refId }) {
    amount = Math.round((Number(amount) || 0) * 100) / 100;
    if (amount <= 0 || !employeeId) return null;
    const store = t.objectStore('employees');
    const emp = await DB.reqToPromise(store.get(employeeId));
    if (!emp) throw new Error('الموظف ده مش موجود');
    emp.balance = Math.round(((emp.balance || 0) + (dir === 'credit' ? amount : -amount)) * 100) / 100;
    await DB.reqToPromise(store.put(emp));
    return DB.reqToPromise(t.objectStore('employeeMoves').add({
      employeeId, dir, type, amount,
      note: note || '', date: date || Utils.nowISO(),
      refType: refType || null, refId: refId ?? null, voided: false
    }));
  }

  // سلفة للموظف: فلوس بتخرج من الخزنة وبتتخصم من حسابه
  async function employeeAdvance(employeeId, amount, note, date) {
    return DB.tx(['employees', 'employeeMoves', 'treasury', 'settings'], 'readwrite', async (t) => {
      const emp = await DB.reqToPromise(t.objectStore('employees').get(employeeId));
      const who = emp ? emp.name : 'موظف';
      const moveId = await _writeEmployeeMove(t, {
        employeeId, dir: 'debit', type: 'advance', amount,
        note: note || 'سلفة', date
      });
      await _writeTreasuryMove(t, { direction: 'out', amount, source: 'advance',
        refId: employeeId, note: (note ? note + ' — ' : 'سلفة — ') + who, date });
      return moveId;
    });
  }

  // صرف مستحق للموظف (مرتب أو جزء منه)
  async function payEmployee(employeeId, amount, note, date) {
    return DB.tx(['employees', 'employeeMoves', 'treasury', 'settings'], 'readwrite', async (t) => {
      const emp = await DB.reqToPromise(t.objectStore('employees').get(employeeId));
      const who = emp ? emp.name : 'موظف';
      const moveId = await _writeEmployeeMove(t, {
        employeeId, dir: 'debit', type: 'payment', amount,
        note: note || 'صرف مستحق', date
      });
      await _writeTreasuryMove(t, { direction: 'out', amount, source: 'salary',
        refId: employeeId, note: (note ? note + ' — ' : 'صرف مستحق — ') + who, date });
      return moveId;
    });
  }

  // مكافأة أو خصم — بيتحرك في الحساب بس، مفيش فلوس بتتحرك دلوقتي
  async function employeeAdjust(employeeId, kind, amount, note, date) {
    const dir = kind === 'bonus' ? 'credit' : 'debit';
    return DB.tx(['employees', 'employeeMoves'], 'readwrite', async (t) => {
      return _writeEmployeeMove(t, { employeeId, dir, type: kind, amount, note, date });
    });
  }

  /* مبيعات الموظف في فترة — أساس العمولة.
     بنطرح المرتجعات المربوطة بفواتيره عشان ماياخدش عمولة على بضاعة رجعت. */
  async function employeeSales(employeeId, fromISO, toISO) {
    const [sales, returns] = await Promise.all([DB.getAll('sales'), DB.getAll('returns')]);
    const from = new Date(fromISO), to = new Date(toISO);
    let total = 0, count = 0;
    const mine = new Set();
    for (const s of sales) {
      if (s.voided) continue;
      if (Number(s.sellerId || 0) !== Number(employeeId)) continue;
      const d = new Date(s.date);
      if (d < from || d > to) continue;
      total += Number(s.total || 0);
      mine.add(Number(s.id));
      count++;
    }

    /* المرتجعات لازم تتخصم من المبيع قبل حساب العمولة — وإلا البائع
       بياخد عمولة على بضاعة العميل رجّعها. بنخصم المرتجع المربوط
       بفواتير البائع نفسه بس. */
    let returned = 0;
    for (const r of returns) {
      if (r.voided || r.kind !== 'customer') continue;
      for (const l of (r.lines || [])) {
        if (l.mode === 'swap') continue;
        if (!mine.has(Number(l.saleId || 0))) continue;
        returned += Number(l.qty || 0) * Number(l.price || 0);
      }
    }
    returned = Math.round(returned * 100) / 100;
    const net = Math.max(0, Math.round((total - returned) * 100) / 100);
    return { total: net, gross: Math.round(total * 100) / 100, returned, count };
  }

  // حدود الشهر (مثال: '2026-08' → من ١ أغسطس لآخر لحظة في ٣١ أغسطس)
  function monthRange(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const from = new Date(y, m - 1, 1, 0, 0, 0);
    const to = new Date(y, m, 0, 23, 59, 59);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  /* تقفيل شهر لموظف: بيحسب المرتب + العمولة، بيحطهم في حسابه،
     وبيسجّل مصروف واحد بقيمتهم عشان الأرباح والخساير تطلع صح.
     مفيش فلوس بتتحرك هنا — الفلوس بتتحرك لما تصرفله. */
  async function closePayrollMonth(employeeId, monthKey) {
    const { from, to } = monthRange(monthKey);
    const emp = await DB.get('employees', employeeId);
    if (!emp) throw new Error('الموظف ده مش موجود');

    const existing = (await DB.getAll('payrollClosings'))
      .find(c => !c.voided && Number(c.employeeId) === Number(employeeId) && c.monthKey === monthKey);
    if (existing) throw new Error('الشهر ده متقفّل خلاص لـ ' + emp.name);

    const sold = await employeeSales(employeeId, from, to);
    const rate = Number(emp.commissionRate || 0);
    const salary = Math.round((Number(emp.salary || 0)) * 100) / 100;
    const commission = Math.round((sold.total * rate / 100) * 100) / 100;
    if (salary <= 0 && commission <= 0) throw new Error('مفيش مرتب ولا عمولة تتقفل للشهر ده');

    return DB.tx(['employees', 'employeeMoves', 'payrollClosings', 'expenses'], 'readwrite', async (t) => {
      const moveIds = [];
      if (salary > 0) {
        moveIds.push(await _writeEmployeeMove(t, {
          employeeId, dir: 'credit', type: 'salary', amount: salary,
          note: 'مرتب ' + monthKey, date: to, refType: 'payroll'
        }));
      }
      if (commission > 0) {
        moveIds.push(await _writeEmployeeMove(t, {
          employeeId, dir: 'credit', type: 'commission', amount: commission,
          note: `عمولة ${rate}% على مبيعات ${Utils.formatMoney(sold.total)}`,
          date: to, refType: 'payroll'
        }));
      }

      const expenseId = await DB.reqToPromise(t.objectStore('expenses').add({
        category: 'مرتبات',
        description: `${emp.name} — ${monthKey}`,
        amount: Math.round((salary + commission) * 100) / 100,
        date: to, source: 'payroll'
      }));

      const closeId = await DB.reqToPromise(t.objectStore('payrollClosings').add({
        employeeId, monthKey, from, to, salary, commission,
        salesBase: sold.total, salesCount: sold.count, rate,
        closedAt: Utils.nowISO(), expenseId, moveIds, voided: false
      }));
      return { id: closeId, salary, commission, salesBase: sold.total,
               total: Math.round((salary + commission) * 100) / 100 };
    });
  }

  // فك تقفيل شهر (لو قفله بالغلط)
  async function voidPayrollClosing(closingId) {
    return DB.tx(['employees', 'employeeMoves', 'payrollClosings', 'expenses'], 'readwrite', async (t) => {
      const store = t.objectStore('payrollClosings');
      const c = await DB.reqToPromise(store.get(closingId));
      if (!c || c.voided) throw new Error('التقفيل ده مش موجود أو متلغي');

      const moveStore = t.objectStore('employeeMoves');
      const empStore = t.objectStore('employees');
      const emp = await DB.reqToPromise(empStore.get(c.employeeId));

      for (const mid of (c.moveIds || [])) {
        const m = await DB.reqToPromise(moveStore.get(mid));
        if (!m || m.voided) continue;
        m.voided = true;
        await DB.reqToPromise(moveStore.put(m));
        if (emp) emp.balance = Math.round(((emp.balance || 0) - Number(m.amount || 0)) * 100) / 100;
      }
      if (emp) await DB.reqToPromise(empStore.put(emp));
      if (c.expenseId) await DB.reqToPromise(t.objectStore('expenses').delete(c.expenseId));

      c.voided = true;
      await DB.reqToPromise(store.put(c));
      return true;
    });
  }

  // مسح حركة من حساب الموظف (سلفة/صرف/مكافأة/خصم) وترجيع أثرها
  async function voidEmployeeMove(moveId) {
    return DB.tx(['employees', 'employeeMoves', 'treasury', 'settings'], 'readwrite', async (t) => {
      const store = t.objectStore('employeeMoves');
      const m = await DB.reqToPromise(store.get(moveId));
      if (!m || m.voided) throw new Error('الحركة دي مش موجودة');
      if (m.refType === 'payroll') throw new Error('دي من تقفيل شهر — الغِ التقفيل نفسه');

      const empStore = t.objectStore('employees');
      const emp = await DB.reqToPromise(empStore.get(m.employeeId));
      if (emp) {
        emp.balance = Math.round(((emp.balance || 0) - (m.dir === 'credit' ? 1 : -1) * Number(m.amount || 0)) * 100) / 100;
        await DB.reqToPromise(empStore.put(emp));
      }
      // اللي طلع فلوس من الخزنة لازم يرجعلها
      if (m.type === 'advance' || m.type === 'payment') {
        await _writeTreasuryMove(t, { direction: 'in', amount: m.amount, source: 'adjust',
          refId: m.employeeId, reversal: true,
          note: 'إلغاء ' + (m.type === 'advance' ? 'سلفة' : 'صرف') + ' — ' + (emp ? emp.name : '') });
      }
      m.voided = true;
      await DB.reqToPromise(store.put(m));
      return true;
    });
  }

  /* ================= إهلاك الأصول الثابتة =================

     العربية اللي اشتريتها بـ ١٢٠,٠٠٠ مش هتفضل بـ ١٢٠,٠٠٠ طول العمر —
     بتقلّ قيمتها كل سنة. والفرق ده مصروف حقيقي على المحل حتى لو
     مفيش فلوس بتخرج. من غيره الأرباح بتبان أعلى من الحقيقة،
     وقيمة المحل في الورق بتبقى أكبر من قيمته الحقيقية.

     بنقسّم التكلفة على العمر الإنتاجي بالشهور (طريقة القسط الثابت).
     كل شهر بتدوس زرار فيتسجّل مصروف "إهلاك" بالمبلغ. */

  const DEFAULT_LIFE_YEARS = 5;

  function monthlyDepreciation(asset) {
    const cost = Number(asset.cost || 0);
    const years = Number(asset.usefulLife || DEFAULT_LIFE_YEARS);
    if (cost <= 0 || years <= 0) return 0;
    return Math.round((cost / (years * 12)) * 100) / 100;
  }

  // كل أصل اتهلك منه كام لحد دلوقتي
  async function accumulatedDepreciation() {
    const map = {};
    for (const e of await DB.getAll('expenses')) {
      if (e.source !== 'depreciation') continue;
      for (const l of (e.lines || [])) {
        map[l.assetId] = Math.round(((map[l.assetId] || 0) + Number(l.amount || 0)) * 100) / 100;
      }
    }
    return map;
  }

  /* إهلاك شهر معيّن: بيشمل الأصول اللي كانت متملّكة في الشهر ده
     واللي لسه ما اتهلكتش بالكامل. */
  async function depreciationPlan(monthKey) {
    const { to } = monthRange(monthKey);
    const acc = await accumulatedDepreciation();
    const lines = [];
    for (const a of await DB.getAll('fixedAssets')) {
      const bought = new Date(a.purchaseDate || a.date || 0);
      if (bought > new Date(to)) continue;                 // لسه ما اشتراهاش
      const already = Number(acc[a.id] || 0);
      const remaining = Math.round((Number(a.cost || 0) - already) * 100) / 100;
      if (remaining <= 0.005) continue;                    // اتهلكت خلاص
      const amount = Math.min(monthlyDepreciation(a), remaining);
      if (amount <= 0.005) continue;
      lines.push({ assetId: a.id, name: a.name, amount: Math.round(amount * 100) / 100,
                   cost: Number(a.cost || 0), already, life: Number(a.usefulLife || DEFAULT_LIFE_YEARS) });
    }
    const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    return { monthKey, lines, total };
  }

  async function postDepreciation(monthKey) {
    const done = (await DB.getAll('expenses'))
      .find(e => e.source === 'depreciation' && e.monthKey === monthKey);
    if (done) throw new Error('إهلاك الشهر ده متسجّل خلاص');

    const plan = await depreciationPlan(monthKey);
    if (plan.total <= 0) throw new Error('مفيش إهلاك يتسجل للشهر ده');
    const { to } = monthRange(monthKey);

    // مفيش حركة خزنة — الإهلاك مصروف من غير ما فلوس تخرج
    return DB.add('expenses', {
      date: to, category: 'إهلاك أصول', description: 'إهلاك ' + monthKey,
      amount: plan.total, source: 'depreciation', monthKey, lines: plan.lines
    });
  }

  async function voidDepreciation(expenseId) {
    const e = await DB.get('expenses', expenseId);
    if (!e || e.source !== 'depreciation') throw new Error('ده مش قيد إهلاك');
    await DB.delete('expenses', expenseId);
    return true;
  }

  /* ---------- تقفيل اليومية ----------
     آخر اليوم بتعدّ اللي في الدرج وتكتبه. البرنامج بيقارنه باللي عنده:
       - لو زي بعضه: بيتسجل تقفيل نضيف.
       - لو فيه فرق: بيسجّل حركة خزنة بالفرق عشان رصيد البرنامج يبقى
         مطابق للفلوس اللي معاك فعلاً، وبيفضل الفرق متسجّل عشان تراجعه.
     من غير ده، أي فرق صغير بيفضل مستخبي لحد ما يكبر ومتعرفش سببه. */
  async function closeDay({ date, counted, note, redo }) {
    return DB.tx(['dayClosings', 'treasury', 'settings'], 'readwrite', async (t) => {
      const when = date || Utils.nowISO();
      const day = Utils.dateKey(when);

      const store = t.objectStore('dayClosings');
      const existing = (await DB.reqToPromise(store.getAll()))
        .find(c => Utils.dateKey(c.date) === day);
      /* لو باع حاجة بعد التقفيل، بيقدر يقفل تاني (redo) — بنسيب التقفيل
         القديم في السجل عشان يفضل عندك تاريخ، وبنعلّم عليه إنه اتعدّى. */
      if (existing && !redo) throw new Error('اليوم ده متقفّل خلاص (' + day + ')');
      if (existing && redo) {
        existing.superseded = true;
        await DB.reqToPromise(store.put(existing));
      }

      const expected = await _readBalance(t);
      /* لازم رقم حقيقي. لو جه فاضي وحسبناه صفر، البرنامج هيسجّل
         سحب بكل اللي في الدرج ويفضّي الخزنة — الشاشة بتمنع ده، بس
         دي فلوس فمينفعش نعتمد على الشاشة وحدها. */
      if (counted === null || counted === undefined || counted === '' || !isFinite(Number(counted))) {
        throw new Error('اكتب اللي عديته في الدرج — من غيره مينفعش نقفل اليومية');
      }
      const cash = Math.round(Number(counted) * 100) / 100;
      const diff = Math.round((cash - expected) * 100) / 100;

      let moveId = null;
      if (Math.abs(diff) > 0.005) {
        const m = await _writeTreasuryMove(t, {
          direction: diff > 0 ? 'in' : 'out',
          amount: Math.abs(diff),
          source: diff > 0 ? 'deposit' : 'withdrawal',
          refId: null,
          note: 'فرق تقفيل يومية ' + day + (note ? ' — ' + note : ''),
          date: when
        });
        moveId = m ? m.id : null;
      }

      // بنسجّل عدد حركات الخزنة وقت التقفيل — عشان نعرف بعدين
      // لو حصلت حركة جديدة بعد ما قفل
      const treasuryCount = (await DB.reqToPromise(t.objectStore('treasury').getAll())).length;

      const id = await DB.reqToPromise(store.add({
        date: when, day, expected, counted: cash, difference: diff,
        note: note || '', moveId, closedAt: Utils.nowISO(), treasuryCount,
        device: (typeof Device !== 'undefined') ? Device.current() : null
      }));
      return { id, day, expected, counted: cash, difference: diff };
    });
  }

  /* بيجمّع حركة اليوم: بعت كام، دخل كام، طلع كام */
  async function daySummary(dayKey) {
    const day = dayKey || Utils.todayISO();
    const [sales, returns, expenses, treasury, closings] = await Promise.all([
      DB.getAll('sales'), DB.getAll('returns'), DB.getAll('expenses'),
      DB.getAll('treasury'), DB.getAll('dayClosings')
    ]);
    const onDay = (d) => Utils.dateKey(d) === day;

    const daySales = sales.filter(s => !s.voided && onDay(s.date));
    const salesTotal = daySales.reduce((a, s) => a + Number(s.total || 0), 0);
    const cashIn = treasury.filter(m => onDay(m.date) && m.direction === 'in')
      .reduce((a, m) => a + Number(m.amount || 0), 0);
    const cashOut = treasury.filter(m => onDay(m.date) && m.direction === 'out')
      .reduce((a, m) => a + Number(m.amount || 0), 0);
    const dayExpenses = expenses.filter(e => onDay(e.date))
      .reduce((a, e) => a + Number(e.amount || 0), 0);
    const dayReturns = returns.filter(r => r.kind === 'customer' && onDay(r.date))
      .reduce((a, r) => a + Number(r.total || 0), 0);

    /* آخر تقفيل لليوم ده. ممكن يكون قفل أكتر من مرة لو باع بعد
       التقفيل ورجع قفل تاني — بناخد الأخير. */
    const dayClosings = closings.filter(c => c.day === day)
      .sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));
    const closed = dayClosings.length ? dayClosings[dayClosings.length - 1] : null;

    /* لو حصل بيع أو صرف بعد ما قفل، التقفيل بيبقى برقم قديم والدرج
       فيه فلوس مش متحسبة.

       مبنقارنش بالوقت لأن الفاتورة بتتسجل بتاريخ اليوم على نص النهار
       (عشان التوقيت ما يزحلقش يوم)، فوقتها مش بيدل على ترتيبها.
       بنقارن بالرصيد: أول ما تقفل، رصيد الخزنة بيساوي اللي عديته
       بالظبط — فأي فرق بعد كده معناه حصلت حركة. */
    const nowBalance = await getCashBalance();
    let afterClose = 0, afterCount = 0;
    if (closed) {
      afterClose = Math.round((nowBalance - Number(closed.counted || 0)) * 100) / 100;
      afterCount = Math.max(0, treasury.length - Number(closed.treasuryCount || treasury.length));
      if (Math.abs(afterClose) > 0.005 && afterCount === 0) afterCount = 1;
    }

    return {
      day,
      invoices: daySales.length,
      salesTotal: Math.round(salesTotal * 100) / 100,
      returns: Math.round(dayReturns * 100) / 100,
      expenses: Math.round(dayExpenses * 100) / 100,
      cashIn: Math.round(cashIn * 100) / 100,
      cashOut: Math.round(cashOut * 100) / 100,
      expected: await getCashBalance(),
      closed,
      afterClose: Math.round(afterClose * 100) / 100,
      afterCount
    };
  }

  /* ---------- دمج صنفين اتسجلوا بالغلط مرتين ----------

     بيحصل لما يكتب نفس الصنف في سطرين في نفس الفاتورة (البرنامج
     كان بيعمله صنفين بباركودين). النتيجة: الرصيد متقسّم على اتنين،
     والتكلفة المتوسطة غلط، ومنه ملصقين بباركودين.

     الدمج بينقل كل حاجة من الصنف الزيادة للصنف اللي هيفضل: حركات
     المخزن، وسطور فواتير البيع والشرا والمرتجعات. وبعدين بنحسب
     الرصيد والتكلفة من الحركات كلها من الأول عشان يطلعوا صح. */
  async function mergeItems(keepId, dropId) {
    keepId = Number(keepId); dropId = Number(dropId);
    if (!keepId || !dropId || keepId === dropId) throw new Error('اختار صنفين مختلفين');

    return DB.tx(['items', 'stockMovements', 'sales', 'purchases', 'returns'], 'readwrite', async (t) => {
      const itemsStore = t.objectStore('items');
      const keep = await DB.reqToPromise(itemsStore.get(keepId));
      const drop = await DB.reqToPromise(itemsStore.get(dropId));
      if (!keep || !drop) throw new Error('صنف مش موجود');

      let moved = 0, docs = 0;

      // ١) حركات المخزن
      const movStore = t.objectStore('stockMovements');
      const movs = await DB.reqToPromise(movStore.getAll());
      for (const m of movs) {
        if (Number(m.itemId) !== dropId) continue;
        m.itemId = keepId;
        m.updatedAt = Utils.nowISO();
        await DB.reqToPromise(movStore.put(m));
        moved++;
      }

      // ٢) سطور الفواتير والمرتجعات
      for (const store of ['sales', 'purchases', 'returns']) {
        const s = t.objectStore(store);
        for (const doc of await DB.reqToPromise(s.getAll())) {
          let touched = false;
          for (const l of (doc.lines || [])) {
            if (Number(l.itemId) !== dropId) continue;
            l.itemId = keepId;
            touched = true;
          }
          if (touched) {
            doc.updatedAt = Utils.nowISO();
            await DB.reqToPromise(s.put(doc));
            docs++;
          }
        }
      }

      /* ٣) نعيد حساب الرصيد والتكلفة من الحركات كلها بالترتيب —
            زي ما كان هيحصل لو الصنف كان واحد من الأول. */
      const mine = (await DB.reqToPromise(movStore.getAll()))
        .filter(m => Number(m.itemId) === keepId)
        .sort((a, b) => {
          const d = new Date(a.date) - new Date(b.date);
          return d !== 0 ? d : (Number(a.id) - Number(b.id));
        });
      /* لازم نمشي بنفس قواعد البرنامج بالظبط:
           • الشرا              ← بيغيّر المتوسط (_avgIn)
           • إلغاء/تعديل شرا    ← بيرجّع المتوسط (_avgOut)
           • البيع والمرتجع والجرد ← بيغيّروا الكمية بس، المتوسط زي ما هو
         لو حسبنا البيع بـ _avgOut كانت التكلفة هتطلع غلط. */
      let qty = 0, cost = 0;
      for (const m of mine) {
        const q = Number(m.qty || 0);
        const c = Number(m.unitCost || 0);
        const rt = String(m.refType || '');
        if (q > 0 && rt === 'purchase') {
          const av = _avgIn(qty, cost, q, c);
          qty = av.qty; if (c > 0) cost = av.cost;
        } else if (q < 0 && (rt === 'purchase-edit' || rt === 'purchase-void')) {
          const av = _avgOut(qty, cost, -q, c);
          qty = av.qty; cost = av.cost;
        } else {
          qty = Math.round((qty + q) * 1000) / 1000;
        }
      }
      /* الرصيد = رصيد الاتنين مجموعين. ده أأمن من الحساب من الحركات:
         لو صنف رصيده متسجل من غير حركة (استيراد قديم مثلاً) الحساب
         من الحركات كان هيصفّره. والاتنين بيطلعوا نفس الرقم في
         الحالة العادية لأن كل تغيير في الرصيد بيتكتب معاه حركة. */
      const sumStock = Math.round(((Number(keep.stock || 0)) + (Number(drop.stock || 0))) * 1000) / 1000;
      keep.stock = sumStock;
      if (cost > 0) keep.costPrice = Math.round(cost * 10000) / 10000;
      else {
        // مفيش حركات شرا — بناخد متوسط التكلفتين بالرصيد
        const kq = Math.max(0, Number(keep.stock || 0) - Number(drop.stock || 0));
        const dq = Math.max(0, Number(drop.stock || 0));
        const kc = Number(keep.costPrice || 0), dc = Number(drop.costPrice || 0);
        if (kq + dq > 0 && (kc > 0 || dc > 0)) {
          keep.costPrice = Math.round(((kq * kc + dq * dc) / (kq + dq)) * 10000) / 10000;
        } else if (!(kc > 0) && dc > 0) keep.costPrice = dc;
      }
      keep.damagedQty = Math.round(((Number(keep.damagedQty || 0)) + (Number(drop.damagedQty || 0))) * 1000) / 1000;
      // بناخد اللي مكتوب في الصنف الزيادة لو الأساسي فاضي
      if (!(Number(keep.salePrice || 0) > 0) && Number(drop.salePrice || 0) > 0) keep.salePrice = drop.salePrice;
      if (!(keep.category || '').trim() && (drop.category || '').trim()) keep.category = drop.category;
      if (!(Number(keep.minStock || 0) > 0) && Number(drop.minStock || 0) > 0) keep.minStock = drop.minStock;
      keep.updatedAt = Utils.nowISO();
      await DB.reqToPromise(itemsStore.put(keep));

      await DB.reqToPromise(itemsStore.delete(dropId));
      return { moved, docs, stock: keep.stock, cost: keep.costPrice };
    });
  }

  /* بيدوّر على الأصناف اللي اتسجلت مرتين — بنفس الاسم أو بنفس
     الباركود. الاسم بيتقارن بعد ما نشيل المسافات الزيادة. */
  async function duplicateItems() {
    const items = await DB.getAll('items');
    const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const groups = [];
    const seen = new Map();
    for (const it of items) {
      const k = 'n:' + norm(it.name);
      if (!norm(it.name)) continue;
      (seen.get(k) || seen.set(k, []).get(k)).push(it);
    }
    for (const [, list] of seen) {
      if (list.length < 2) continue;
      const prices = [...new Set(list.map(i => Number(i.salePrice || 0)))];
      groups.push({
        name: list[0].name,
        items: list.sort((a, b) => Number(b.stock || 0) - Number(a.stock || 0)),
        samePrice: prices.length === 1,
        prices
      });
    }
    // الباركود المتكرر (المفروض مستحيل، بس بنتأكد)
    const byCode = new Map();
    for (const it of items) {
      const c = String(it.barcode || '').trim();
      if (!c) continue;
      (byCode.get(c) || byCode.set(c, []).get(c)).push(it);
    }
    const codeDups = [];
    for (const [code, list] of byCode) {
      if (list.length > 1) codeDups.push({ barcode: code, items: list });
    }
    return { groups, codeDups };
  }

  // ---------- تسوية مخزون يدوية ----------
  async function adjustStock(itemId, newQty, note) {
    return DB.tx(['items', 'stockMovements'], 'readwrite', async (t) => {
      const itemsStore = t.objectStore('items');
      const item = await DB.reqToPromise(itemsStore.get(itemId));
      if (!item) return false;
      /* بنقرّب على ٣ خانات زي باقي البرنامج. كان بيقرّب على خانتين
         بس، فالجرد بكمية زي ٩٧.١٢٥ متر كان بيسيب فرق بين المخزون
         المسجّل والمحسوب من الحركات. */
      const diff = Math.round((newQty - (item.stock || 0)) * 1000) / 1000;
      item.stock = newQty;
      await DB.reqToPromise(itemsStore.put(item));
      if (diff !== 0) {
        await DB.reqToPromise(t.objectStore('stockMovements').add({
          itemId, type: 'adjustment', qty: diff, unitCost: item.costPrice || 0,
          date: Utils.nowISO(), refType: 'adjustment', refId: null, note: note || 'تسوية جرد'
        }));
      }
      return true;
    });
  }

  // ---------- إعداد رصيد افتتاحي للخزنة ----------
  async function setOpeningCashBalance(amount) {
    return DB.tx(['treasury', 'settings'], 'readwrite', async (t) => {
      const cur = await _readBalance(t);
      if (cur !== 0) return false;
      await _writeTreasuryMove(t, { direction: 'in', amount, source: 'deposit',
        note: 'رصيد افتتاحي', kind: 'capital' });
      return true;
    });
  }

  // ---------- نسخة احتياطية ----------
  /* ================= المركز المالي =================

     المعادلة المحاسبية: الأصول = الالتزامات + حقوق الملكية.
     يعني اللي تحت إيدك (فلوس + بضاعة + فلوس عند الناس + عدد وأجهزة)
     = اللي عليك (للموردين وللموظفين) + اللي يخصك انت فعلاً.

     وحقوق الملكية بتتفصّل: رأس المال اللي حطيته من جيبك،
     ناقص اللي سحبته لنفسك، زايد الأرباح اللي سابتها في المحل. */
  async function financialPosition() {
    const [items, customers, suppliers, employees, assets, treasury] = await Promise.all([
      DB.getAll('items'), DB.getAll('customers'), DB.getAll('suppliers'),
      DB.getAll('employees'), DB.getAll('fixedAssets'), DB.getAll('treasury')
    ]);
    const cash = await getCashBalance();
    const acc = await accumulatedDepreciation();

    const inventory = Math.round(items.reduce((s, i) =>
      s + Math.max(0, Number(i.stock || 0)) * Number(i.costPrice || 0), 0) * 100) / 100;
    const receivable = Math.round(customers.reduce((s, c) =>
      s + Math.max(0, Number(c.balance || 0)), 0) * 100) / 100;
    const assetsCost = Math.round(assets.reduce((s, a) => s + Number(a.cost || 0), 0) * 100) / 100;
    const accumDep = Math.round(assets.reduce((s, a) => s + Number(acc[a.id] || 0), 0) * 100) / 100;
    const assetsNet = Math.round((assetsCost - accumDep) * 100) / 100;

    const payable = Math.round(suppliers.reduce((s, x) =>
      s + Math.max(0, Number(x.balance || 0)), 0) * 100) / 100;
    const employeeDues = Math.round(employees.reduce((s, e) =>
      s + Math.max(0, Number(e.balance || 0)), 0) * 100) / 100;

    /* العميل اللي دفع أكتر من اللي عليه: الزيادة دي **مش ربح** —
       دي أمانة عندك لازم ترجّعها أو تخصمها من مشترياته الجاية.
       وكذلك اللي دفعناه للمورد زيادة هو حقنا عنده (أصل).
       من غير السطرين دول الفلوس دي كانت بتتحسب أرباح محتجزة. */
    const customerCredit = Math.round(customers.reduce((s, c) =>
      s + Math.max(0, -Number(c.balance || 0)), 0) * 100) / 100;
    const supplierPrepaid = Math.round(suppliers.reduce((s, x) =>
      s + Math.max(0, -Number(x.balance || 0)), 0) * 100) / 100;

    const totalAssets = Math.round((cash + inventory + receivable + assetsNet + supplierPrepaid) * 100) / 100;
    const totalLiabilities = Math.round((payable + employeeDues + customerCredit) * 100) / 100;
    const equity = Math.round((totalAssets - totalLiabilities) * 100) / 100;

    // رأس المال اللي دخل من جيبه، والمسحوبات الشخصية
    let capital = 0, drawings = 0;
    for (const m of treasury) {
      if (m.kind === 'capital' && m.direction === 'in') capital += Number(m.amount || 0);
      if (m.kind === 'drawings' && m.direction === 'out') drawings += Number(m.amount || 0);
    }
    capital = Math.round(capital * 100) / 100;
    drawings = Math.round(drawings * 100) / 100;
    // الباقي هو الأرباح اللي اتجمّعت وفضلت في المحل
    const retained = Math.round((equity - capital + drawings) * 100) / 100;

    return {
      cash, inventory, receivable, assetsCost, accumDep, assetsNet,
      supplierPrepaid, totalAssets,
      payable, employeeDues, customerCredit, totalLiabilities,
      equity, capital, drawings, retained
    };
  }

  /* أعمار ديون العملاء: مين مأخر عليك من إمتى.
     الدين اللي عدى عليه ٦٠ يوم بيبقى محتاج متابعة جدية. */
  async function receivableAging() {
    const [sales, customers] = await Promise.all([DB.getAll('sales'), DB.getAll('customers')]);
    const now = Date.now();
    const DAY = 86400000;
    const rows = [];
    for (const c of customers) {
      const bal = Number(c.balance || 0);
      if (bal <= 0.005) continue;
      /* عمر الدين: الفلوس اللي بيدفعها العميل بتسدّد الأقدم الأول
         (ده العُرف المحاسبي وده اللي بيحصل في الواقع).

         فبنجمع فواتيره الآجلة من الأحدث للأقدم لغاية ما نغطي
         الرصيد اللي عليه دلوقتي — آخر فاتورة نوصلها هي أقدم
         فاتورة لسه مش مدفوعة، ومنها بنحسب العمر.

         الطريقة القديمة كانت بتاخد أقدم فاتورة آجل على الإطلاق حتى
         لو سددها من زمان، فكان البرنامج بيقول على عميل منتظم إنه
         متأخر ٩٥ يوم وهو دينه من امبارح. */
      const credit = sales
        .filter(s => !s.voided && Number(s.customerId) === Number(c.id) && Number(s.dueAmount || 0) > 0)
        .sort((a, b) => new Date(b.date) - new Date(a.date));   // الأحدث الأول
      let covered = 0, oldest = null;
      for (const s of credit) {
        oldest = new Date(s.date).getTime();
        covered += Number(s.dueAmount || 0);
        if (covered >= bal - 0.005) break;
      }
      const days = oldest === null ? 0 : Math.floor((now - oldest) / DAY);
      const bucket = days > 90 ? 'over90' : days > 60 ? 'd61_90' : days > 30 ? 'd31_60' : 'd0_30';
      rows.push({ id: c.id, name: c.name, phone: c.phone || '', balance: bal, days, bucket });
    }
    rows.sort((a, b) => b.days - a.days);
    const totals = { d0_30: 0, d31_60: 0, d61_90: 0, over90: 0 };
    rows.forEach(r => { totals[r.bucket] = Math.round((totals[r.bucket] + r.balance) * 100) / 100; });
    return { rows, totals };
  }

  async function exportBackup() {
    const data = {};
    for (const store of DB.STORE_NAMES) {
      data[store] = await DB.getAll(store);
    }
    return { version: 1, exportedAt: Utils.nowISO(), data };
  }

  async function importBackup(backup) {
    if (!backup || !backup.data) throw new Error('ملف النسخة الاحتياطية غير صالح');
    const data = {};
    for (const store of DB.STORE_NAMES) {
      data[store] = Array.isArray(backup.data[store]) ? backup.data[store] : [];
    }
    await DB.replaceAll(data);
  }

  // ---------- اسم العميل/المورد المكتوب بالإيد ----------
  // المستخدم بيكتب الاسم زي ما هو. لو كتب "كاش" أو ساب الخانة فاضية يبقى نقدي (من غير حساب).
  // لو كتب اسم جديد بنفتحله حساب لوحدنا من غير ما يوقف شغله.
  const CASH_WORDS = ['كاش', 'نقدي', 'نقدى', 'cash', 'عميل نقدي', 'مورد نقدي', '-'];

  function isCashName(name) {
    const n = (name || '').trim().toLowerCase();
    return !n || CASH_WORDS.includes(n);
  }

  async function resolveParty(storeName, name) {
    if (isCashName(name)) return null;
    const clean = name.trim();
    const all = await DB.getAll(storeName);
    const found = all.find(p => (p.name || '').trim().toLowerCase() === clean.toLowerCase());
    if (found) return found.id;
    return DB.add(storeName, { name: clean, phone: '', balance: 0 });
  }

  return {
    isCashName, resolveParty, returnSaleItems, returnPurchaseItems, saveReturn, voidReturn,
    getCashBalance, saveSale, voidSale, updateSale, savePurchase, voidPurchase, updatePurchase,
    saveExpense, deleteExpense, manualTreasuryMove,
    collectFromCustomer, payToSupplier, adjustStock, setOpeningCashBalance,
    closeDay, daySummary,
    isManualMove, isReversalMove, reversedMoveIds,
    mergeItems, duplicateItems,
    updateTreasuryMove, deleteTreasuryMove,
    employeeAdvance, payEmployee, employeeAdjust, employeeSales,
    closePayrollMonth, voidPayrollClosing, voidEmployeeMove, monthRange,
    monthlyDepreciation, accumulatedDepreciation, depreciationPlan,
    postDepreciation, voidDepreciation, DEFAULT_LIFE_YEARS,
    financialPosition, receivableAging,
    exportBackup, importBackup
  };
})();
