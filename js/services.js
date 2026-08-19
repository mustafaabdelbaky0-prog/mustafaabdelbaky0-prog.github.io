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
    const id = await DB.reqToPromise(t.objectStore('treasury').add({
      date: date || Utils.nowISO(), direction, amount, source,
      refId: refId ?? null, note: note || '', balanceAfter: newBal
    }));
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
          item.stock = Math.round(((item.stock || 0) - line.qty) * 100) / 100;
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
          item.stock = Math.round(((item.stock || 0) + line.qty) * 100) / 100;
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
          item.stock = Math.round(((item.stock || 0) + line.qty) * 100) / 100;
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
      for (const line of purchase.lines) {
        const item = await DB.reqToPromise(itemsStore.get(line.itemId));
        if (item) {
          item.stock = Math.round(((item.stock || 0) - line.qty) * 100) / 100;
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
          partyId: l.partyId || null
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
      await _writeTreasuryMove(t, { direction: 'out', amount: expense.amount, source: 'expense', refId: id, note: expense.category });
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
  async function collectFromCustomer(customerId, amount, note) {
    return DB.tx(['customers', 'treasury', 'settings'], 'readwrite', async (t) => {
      await _bumpPartyBalance(t, 'customers', customerId, -amount);
      return _writeTreasuryMove(t, { direction: 'in', amount, source: 'collect', refId: customerId, note: note || 'تحصيل من عميل' });
    });
  }

  async function payToSupplier(supplierId, amount, note) {
    return DB.tx(['suppliers', 'treasury', 'settings'], 'readwrite', async (t) => {
      await _bumpPartyBalance(t, 'suppliers', supplierId, -amount);
      return _writeTreasuryMove(t, { direction: 'out', amount, source: 'pay', refId: supplierId, note: note || 'سداد لمورد' });
    });
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
    isCashName, resolveParty, returnSaleItems, returnPurchaseItems, saveReturn,
    getCashBalance, saveSale, voidSale, savePurchase, voidPurchase,
    saveExpense, deleteExpense, manualTreasuryMove,
    collectFromCustomer, payToSupplier, adjustStock, setOpeningCashBalance,
    exportBackup, importBackup
  };
})();
