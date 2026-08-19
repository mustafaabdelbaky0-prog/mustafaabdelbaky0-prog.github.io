/* مصدر البيانات لنسخة الموقع (الموبايل)

   البيانات بتتخزن على الموبايل نفسه (localStorage) عشان البرنامج يشتغل
   حتى لو النت قطع في نص شغلك. وكل شوية بيتزامن مع جوجل درايف:
   بيقرا ملفات الأجهزة التانية ويدمجها، وبيكتب ملفه هو.

   نفس فكرة الكمبيوتر بالظبط — كل جهاز بيكتب ملف باسمه لوحده،
   فمفيش جهازين بيكتبوا نفس الملف ومفيش تصادم. */

(() => {
  const KEY = 'mostafaData';
  const STORES = ['items','stockMovements','sales','purchases','returns','expenses','treasury',
                  'customers','suppliers','fixedAssets','company','settings'];

  function emptyData() {
    const d = {};
    STORES.forEach(s => d[s] = []);
    return d;
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { version: 0, data: emptyData() };
      const p = JSON.parse(raw);
      const data = emptyData();
      STORES.forEach(s => { if (Array.isArray(p.data && p.data[s])) data[s] = p.data[s]; });
      return { version: Number(p.version || 0), data };
    } catch (e) {
      return { version: 0, data: emptyData() };
    }
  }

  function writeLocal(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      // الذاكرة اتملت — ده بيحصل لو البيانات كبرت جدًا
      if (typeof Utils !== 'undefined') {
        Utils.toast('مساحة التخزين على الموبايل اتملت', 'error');
      }
      throw e;
    }
  }

  function keyNameOf(store) { return store === 'settings' ? 'key' : 'id'; }

  function applyOps(state, ops) {
    ops.forEach(op => {
      const kn = keyNameOf(op.store);
      const rows = state.data[op.store] || (state.data[op.store] = []);
      if (op.type === 'clear') { state.data[op.store] = []; }
      else if (op.type === 'delete') {
        state.data[op.store] = rows.filter(r => String(r[kn]) !== String(op.id));
      } else if (op.type === 'put') {
        const i = rows.findIndex(r => String(r[kn]) === String(op.row[kn]));
        if (i >= 0) rows[i] = op.row; else rows.push(op.row);
      }
    });
  }

  window.DB_BACKEND = {
    async load() { return readLocal(); },

    async commit(baseVersion, ops) {
      const state = readLocal();
      applyOps(state, ops);
      state.version = Number(state.version || 0) + 1;
      writeLocal(state);
      DriveSync.markDirty();
      return state.version;
    },

    async replace(data) {
      const state = { version: Number(readLocal().version || 0) + 1, data: data || emptyData() };
      writeLocal(state);
      DriveSync.markDirty();
      return state.version;
    },

    _readLocal: readLocal,
    _writeLocal: writeLocal
  };
})();


