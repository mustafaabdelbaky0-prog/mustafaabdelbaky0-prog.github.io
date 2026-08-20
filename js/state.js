/* الحالة المشتركة بين كل الشاشات - لازم تتحمل قبل ملفات js/modules/* */

// رقم النسخة - بيظهر تحت في القايمة عشان تعرف إن التحديث وصلك فعلاً
const APP_VERSION = '2026-08-20 · تصليح قارئ الليزر';

const Modules = {};

const AppState = {
  items: [],
  customers: [],
  suppliers: [],
  company: null,

  async reloadItems() {
    this.items = await DB.getAll('items');
    this.refreshLowStockBadge();
    return this.items;
  },

  /* الأصناف اللي خلصت أو قربت تخلص — بيظهر رقمها جنب "المخزون"
     في القايمة، عشان تعرف من غير ما تفتح الشاشة وتدوّر. */
  lowStockItems() {
    return this.items.filter(i =>
      i.active !== false && Number(i.minStock || 0) > 0 &&
      Number(i.stock || 0) <= Number(i.minStock));
  },

  refreshLowStockBadge() {
    try {
      const el = document.getElementById('lowBadge');
      if (!el) return;
      const n = this.lowStockItems().length;
      if (n > 0) {
        el.textContent = n;
        el.hidden = false;
        el.title = n + ' صنف خلص أو قرب يخلص';
      } else {
        el.hidden = true;
      }
    } catch (e) { }
  },
  async reloadParties() {
    this.customers = await DB.getAll('customers');
    this.suppliers = await DB.getAll('suppliers');
  },
  async reloadCompany() { this.company = await DB.get('company', 1); },

  // الاقتراحات بتتجمع من اللي اتكتب قبل كده — أي حاجة جديدة تكتبها بتتحفظ
  // مع الصنف، فبتظهر في القايمة تلقائيًا المرة الجاية.
  _uniq(list) {
    return [...new Set(list.map(v => (v || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ar'));
  },
  packTypeSuggestions() {
    return this._uniq(Units.PACK_TYPES.concat(this.items.map(i => i.packName)));
  },
  categorySuggestions() {
    return this._uniq(['كهرباء', 'حدايد', 'مفاتيح', 'سباكة', 'أدوات', 'دهانات']
      .concat(this.items.map(i => i.category)));
  },
  unitSuggestions() {
    return this._uniq(Units.LIST.map(u => u.name).concat(this.items.map(i => i.unit)));
  },

  findItemsLive(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];
    const exactBarcode = this.items.filter(i => i.barcode && i.barcode.toLowerCase() === q);
    if (exactBarcode.length) return exactBarcode;
    return this.items.filter(i =>
      (i.name && i.name.toLowerCase().includes(q)) ||
      (i.barcode && i.barcode.toLowerCase().includes(q))
    ).slice(0, 20);
  }
};

const ROUTES = {
  reports: { title: 'الرئيسية', mod: 'reports' },
  sales: { title: 'نقطة البيع', mod: 'sales' },
  purchases: { title: 'المشتريات', mod: 'purchases' },
  returns: { title: 'المرتجعات', mod: 'returns' },
  items: { title: 'الأصناف', mod: 'items' },
  inventory: { title: 'المخزون', mod: 'inventory' },
  parties: { title: 'العملاء والموردين', mod: 'parties' },
  expenses: { title: 'المصروفات', mod: 'expenses' },
  treasury: { title: 'الخزنة', mod: 'treasury' },
  assets: { title: 'الأصول الثابتة', mod: 'assets' },
  connect: { title: 'توصيل الموبايل', mod: 'connect' },
  company: { title: 'بيانات المؤسسة', mod: 'company' }
};
