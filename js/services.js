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

  async function _writeTreasuryMove(t, { direction, amount, source, refId, note, date }) {
    amount = Math.round((Number(amount) || 0) * 100) / 100;
    if (amount <= 0) return null;
    const curBal = await _readBalance(t);
    const newBal = Math.round(((direction === 'in') ? curBal + amount : curBal - amount) * 100) / 100;
    await DB.reqToPromise(t.objectStore('settings').put({ key: CASH_KEY, value: newBal }));
    const when = date || Utils.nowISO();
    const store = t.objectStore('treasury');
    const id = await DB.reqToPromise(store.add({
      date: when, direction, amount, source,
      refId: refId ?? null, note: note || '', balanceAfter: newBal
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
        customerId: sale.customerId || null, paidNow, dueAmount, voided: false
      }));

      if (paidNow > 0) {
        await _writeTreasuryMove(t, { direction: 'in', amount: paidNow, source: 'sale', refId: saleId, note: `فاتورة بيع ${number}` });
      }
      if (dueAmount > 0 && sale.customerId) {
        await _bumpPartyBalance(t, 'customers', sale.customerId, dueAmount);
      }
      return { id: saleId, number, total, dueAmount };
    });
  }

  async function voidSale(saleId) {
    return DB.tx(['items', 'stockMovements', 'sales', 'treasury', 'settings', 'customers'], 'readwrite', async (t) => {
      const salesStore = t.objectStore('sales');
      const sale = await DB.reqToPromise(salesStore.get(saleId));
      if (!sale || sale.voided) return false;
      const itemsStore = t.objectStore('items');
      for (const line of sale.lines) {
        const item = await DB.reqToPromise(itemsStore.get(line.itemId));
        if (item) {
          item.stock = Math.round(((item.stock || 0) + line.qty) * 1000) / 1000;
          await DB.reqToPromise(itemsStore.put(item));
        }
        await DB.reqToPromise(t.objectStore('stockMovements').add({
          itemId: line.itemId, type: 'return_in', qty: Math.abs(line.qty),
          unitCost: line.cost || 0, date: Utils.nowISO(), refType: 'sale-void', refId: saleId, note: 'إلغاء فاتورة بيع ' + sale.number
        }));
      }
      if (sale.paidNow > 0) {
        await _writeTreasuryMove(t, { direction: 'out', amount: sale.paidNow, source: 'sale', refId: saleId, note: `إلغاء فاتورة بيع ${sale.number}` });
      }
      if (sale.dueAmount > 0 && sale.customerId) {
        await _bumpPartyBalance(t, 'customers', sale.customerId, -sale.dueAmount);
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
          refId: saleId, note: `تعديل فاتورة بيع ${old.number}` });
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
        customerId: sale.customerId || null, paidNow, dueAmount,
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

      // ١) نرجّع أثر القديم — البضاعة تطلع من المخزن تاني
      for (const line of (old.lines || [])) {
        const item = await DB.reqToPromise(itemsStore.get(line.itemId));
        if (item) {
          item.stock = Math.round(((item.stock || 0) - line.qty) * 1000) / 1000;
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
          refId: purchaseId, note: `تعديل فاتورة شراء ${old.number}` });
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
          item.stock = Math.round(((item.stock || 0) + line.qty) * 1000) / 1000;
          if (line.cost) item.costPrice = line.cost;
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

  // ---------- المشتريات ----------
  // purchase: { date, supplierId, lines:[{itemId,name,barcode,qty,cost}], paidNow }
  async function savePurchase(purchase) {
    return DB.tx(['items', 'stockMovements', 'purchases', 'treasury', 'settings', 'suppliers'], 'readwrite', async (t) => {
      const itemsStore = t.objectStore('items');
      const movStore = t.objectStore('stockMovements');
      const total = Math.round(purchase.lines.reduce((s, l) => s + l.qty * l.cost, 0) * 100) / 100;
      const paidNow = Math.min(purchase.paidNow ?? total, total);
      const dueAmount = Math.round((total - paidNow) * 100) / 100;

      for (const line of purchase.lines) {
        const item = await DB.reqToPromise(itemsStore.get(line.itemId));
        if (item) {
          item.stock = Math.round(((item.stock || 0) + line.qty) * 1000) / 1000;
          item.costPrice = line.cost;
          // بنفتكر آخر مورد جبنا منه الصنف — عشان لما نرجّعه يطلع اسمه لوحده
          if (purchase.supplierId) item.lastSupplierId = purchase.supplierId;
          await DB.reqToPromise(itemsStore.put(item));
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
        await _writeTreasuryMove(t, { direction: 'out', amount: paidNow, source: 'purchase', refId: purchaseId, note: `فاتورة شراء ${number}` });
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
          item.stock = Math.round(((item.stock || 0) - line.qty) * 1000) / 1000;
          await DB.reqToPromise(itemsStore.put(item));
        }
        await DB.reqToPromise(t.objectStore('stockMovements').add({
          itemId: line.itemId, type: 'return_out', qty: -Math.abs(line.qty),
          unitCost: line.cost || 0, date: Utils.nowISO(), refType: 'purchase-void', refId: purchaseId, note: 'إلغاء فاتورة شراء ' + purchase.number
        }));
      }
      if (purchase.paidNow > 0) {
        await _writeTreasuryMove(t, { direction: 'in', amount: purchase.paidNow, source: 'purchase', refId: purchaseId, note: `إلغاء فاتورة شراء ${purchase.number}` });
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
    return DB.tx(['items', 'stockMovements', 'returns', 'treasury', 'settings', 'customers', 'suppliers'], 'readwrite', async (t) => {
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

      doc.voided = true;
      doc.voidedAt = now;
      await DB.reqToPromise(store.put(doc));
      return true;
    });
  }

  async function saveReturn(doc) {
    return DB.tx(['items', 'stockMovements', 'returns', 'treasury', 'settings', 'customers', 'suppliers'], 'readwrite', async (t) => {
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
        lines.push({
          itemId: item.id, name: item.name, unit: item.unit, qty, price,
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
      await _writeTreasuryMove(t, { direction: 'in', amount: exp.amount, source: 'expense', refId: expenseId, note: 'إلغاء مصروف: ' + exp.category });
      await DB.reqToPromise(store.delete(expenseId));
      return true;
    });
  }

  // ---------- الخزنة اليدوية ----------
  async function manualTreasuryMove(direction, amount, note) {
    return DB.tx(['treasury', 'settings'], 'readwrite', (t) =>
      _writeTreasuryMove(t, { direction, amount, source: direction === 'in' ? 'deposit' : 'withdrawal', note })
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

  /* ---------- تقفيل اليومية ----------
     آخر اليوم بتعدّ اللي في الدرج وتكتبه. البرنامج بيقارنه باللي عنده:
       - لو زي بعضه: بيتسجل تقفيل نضيف.
       - لو فيه فرق: بيسجّل حركة خزنة بالفرق عشان رصيد البرنامج يبقى
         مطابق للفلوس اللي معاك فعلاً، وبيفضل الفرق متسجّل عشان تراجعه.
     من غير ده، أي فرق صغير بيفضل مستخبي لحد ما يكبر ومتعرفش سببه. */
  async function closeDay({ date, counted, note }) {
    return DB.tx(['dayClosings', 'treasury', 'settings'], 'readwrite', async (t) => {
      const when = date || Utils.nowISO();
      const day = Utils.dateKey(when);

      const store = t.objectStore('dayClosings');
      const existing = (await DB.reqToPromise(store.getAll()))
        .find(c => Utils.dateKey(c.date) === day);
      if (existing) throw new Error('اليوم ده متقفّل خلاص (' + day + ')');

      const expected = await _readBalance(t);
      const cash = Math.round((Number(counted) || 0) * 100) / 100;
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

      const id = await DB.reqToPromise(store.add({
        date: when, day, expected, counted: cash, difference: diff,
        note: note || '', moveId, closedAt: Utils.nowISO(),
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

    return {
      day,
      invoices: daySales.length,
      salesTotal: Math.round(salesTotal * 100) / 100,
      returns: Math.round(dayReturns * 100) / 100,
      expenses: Math.round(dayExpenses * 100) / 100,
      cashIn: Math.round(cashIn * 100) / 100,
      cashOut: Math.round(cashOut * 100) / 100,
      expected: await getCashBalance(),
      closed: closings.find(c => c.day === day) || null
    };
  }

  // ---------- تسوية مخزون يدوية ----------
  async function adjustStock(itemId, newQty, note) {
    return DB.tx(['items', 'stockMovements'], 'readwrite', async (t) => {
      const itemsStore = t.objectStore('items');
      const item = await DB.reqToPromise(itemsStore.get(itemId));
      if (!item) return false;
      const diff = Math.round((newQty - (item.stock || 0)) * 100) / 100;
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
      await _writeTreasuryMove(t, { direction: 'in', amount, source: 'deposit', note: 'رصيد افتتاحي' });
      return true;
    });
  }

  // ---------- نسخة احتياطية ----------
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
    exportBackup, importBackup
  };
})();
