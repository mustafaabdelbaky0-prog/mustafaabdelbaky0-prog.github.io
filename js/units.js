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

  function find(unitName) {
    return LIST.find(u => u.name === unitName) || { name: unitName || 'قطعة', decimals: true, pack: 'كرتونة' };
  }

  function isBaseUnit(name) {
    return LIST.some(u => u.name === (name || '').trim());
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

  return { LIST, PACK_TYPES, find, allowsDecimals, step, packLabel, fmtQty,
           optionsHtml, isBaseUnit };
})();
