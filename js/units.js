/* الوحدات المستخدمة في المحل
   عندنا كهرباء (بالقطعة)، حدايد (بالكيلو - كسور)، ومفاتيح (بالنسخة) */

const Units = (() => {

  const LIST = [
    { name: 'قطعة',   decimals: false, pack: 'كرتونة' },
    { name: 'كيلو',   decimals: true,  pack: 'شيكارة' },
    { name: 'متر',    decimals: true,  pack: 'لفة' },
    { name: 'نسخة',   decimals: false, pack: '' },
    { name: 'عبوة',   decimals: false, pack: 'كرتونة' },
    { name: 'لفة',    decimals: true,  pack: 'كرتونة' },
    { name: 'طن',     decimals: true,  pack: '' },
    { name: 'شنطة',   decimals: false, pack: '' }
  ];

  // أنواع العبوات اللي بيشتري بيها من المورد
  const PACK_TYPES = ['كرتونة', 'شيكارة', 'علبة', 'لفة', 'دستة', 'شنطة', 'طرد'];

  /* طرق البيع الجاهزة لكل وحدة.

     اللي بيتشرى بالكيلو بيتباع ربع كيلو و١٠٠ جرام، واللي بالمتر
     بيتباع نص متر و٥٠ سم. دي حاجات البرنامج عارفها لوحده — مش
     محتاج يكتبها على كل صنف.

     factor = كام من الوحدة الأساسية في الواحدة دي:
     جرام = ٠.٠٠١ كيلو، ربع كيلو = ٠.٢٥ كيلو، سم = ٠.٠١ متر. */
  const SUB_UNITS = {
    'كيلو': [
      { name: 'نص كيلو', factor: 0.5 },
      { name: 'ربع كيلو', factor: 0.25 },
      { name: 'جرام', factor: 0.001 }
    ],
    'طن': [{ name: 'كيلو', factor: 0.001 }],
    'متر': [
      { name: 'نص متر', factor: 0.5 },
      { name: 'سم', factor: 0.01 }
    ]
  };

  function subUnits(unitName) {
    return (SUB_UNITS[(unitName || '').trim()] || []).map(s => ({ name: s.name, factor: s.factor }));
  }
  function hasSubUnits(unitName) { return subUnits(unitName).length > 0; }

  function find(unitName) {
    return LIST.find(u => u.name === unitName) || { name: unitName || 'قطعة', decimals: true, pack: 'كرتونة' };
  }

  function isBaseUnit(name) {
    return LIST.some(u => u.name === (name || '').trim());
  }

  /* العكس: من اسم العبوة نعرف الوحدة اللي جواها.
     لفة ← متر، شيكارة ← كيلو. بيوفر خطوة: أول ما يكتب نوع العبوة
     البرنامج يحط الوحدة الصح لوحده بدل ما يكتبها كل مرة. */
  function baseUnitFor(packName) {
    const p = (packName || '').trim();
    if (!p) return '';
    const hit = LIST.find(u => u.pack === p);
    return hit ? hit.name : '';
  }

  // الحاجات اللي بتتباع بالكيلو أو المتر لازم تقبل كسور (٢ ونص كيلو)
  function allowsDecimals(unitName) {
    return find(unitName).decimals;
  }

  function step(unitName) {
    return allowsDecimals(unitName) ? '0.01' : '1';
  }

  function packLabel(unitName) {
    return find(unitName).pack || 'كرتونة';
  }

  // بيعرض الكمية بشكل مرتب: ٣ مش ٣.٠٠ ، بس ٢.٥ تفضل ٢.٥
  function fmtQty(qty, unitName) {
    const n = Number(qty || 0);
    const txt = Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
    return unitName ? `${txt} ${unitName}` : txt;
  }

  function optionsHtml(selected) {
    const known = LIST.map(u => u.name);
    const extra = selected && !known.includes(selected) ? [selected] : [];
    return known.concat(extra)
      .map(u => `<option value="${u}" ${u === selected ? 'selected' : ''}>${u}</option>`).join('');
  }

  /* كل طرق البيع المتاحة لصنف: الوحدة الأساسية، والعبوة الكاملة
     لو ليها سعر، والطرق اللي البرنامج عارفها (ربع كيلو، سم...)،
     وأي طريقة هو كتبها بإيده على الصنف (مسمار، شنطة...).

     كل طريقة فيها:
       name   اسمها اللي بيشوفه
       factor كام من الوحدة الأساسية فيها
       price  سعر الواحدة منها
     والبرنامج بيحسب: الكمية بالوحدة الأساسية = العدد × factor */
  function sellWays(it, basePrice) {
    const unit = (it && it.unit) || 'قطعة';
    const bp = Number(basePrice != null ? basePrice : (it && it.salePrice) || 0);
    const r2 = n => Math.round(Number(n || 0) * 100) / 100;
    const ways = [{ key: 'base', name: unit, factor: 1, price: bp }];

    const size = Number((it && it.packSize) || 0);
    const pPrice = Number((it && it.packPrice) || 0);
    if (size > 0 && pPrice > 0) {
      ways.push({ key: 'pack', name: (it && it.packName) || packLabel(unit), factor: size, price: pPrice });
    }

    // اللي هو كتبه بإيده: "الكيلو فيه ١٢٠ مسمار"
    (Array.isArray(it && it.sellUnits) ? it.sellUnits : []).forEach((s, i) => {
      const per = Number(s && s.per || 0);
      const nm = String(s && s.name || '').trim();
      if (!nm || !(per > 0)) return;
      const f = 1 / per;
      ways.push({ key: 'own' + i, name: nm, factor: f, price: Number(s.price || 0) || r2(bp * f) });
    });

    subUnits(unit).forEach(s => {
      if (ways.some(w => w.name === s.name)) return;
      ways.push({ key: 'sub:' + s.name, name: s.name, factor: s.factor, price: r2(bp * s.factor) });
    });
    return ways;
  }

  // الخطوة في خانة العدد حسب طريقة البيع المختارة
  function stepFor(way, unit) {
    if (!way || way.key === 'base') return step(unit);
    return way.factor < 1 ? '1' : '0.01';
  }

  return { LIST, PACK_TYPES, SUB_UNITS, find, allowsDecimals, step, packLabel, fmtQty,
           baseUnitFor, optionsHtml, isBaseUnit, subUnits, hasSubUnits, sellWays, stepFor };
})();
