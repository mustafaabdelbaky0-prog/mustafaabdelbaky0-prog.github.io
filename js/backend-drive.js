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


/* حلقة المزامنة مع الدرايف */
const DriveSync = (() => {
  const EVERY_MS = 60000;
  let timer = null, running = false, dirty = false;
  let status = { signedIn: false, lastSync: null, error: null, devices: 0, pending: false };

  function myFile() { return 'جهاز-' + (Device.current() || 2) + '.json'; }

  function markDirty() { dirty = true; status.pending = true; }

  async function pushMine() {
    const state = window.DB_BACKEND._readLocal();
    await Drive.writeFile(myFile(), {
      device: Device.current(),
      deviceName: Device.currentName(),
      savedAt: Utils.nowISO(),
      data: state.data
    });
    dirty = false;
    status.pending = false;
  }

  async function pullOthers() {
    const files = await Drive.list();
    const mine = myFile();
    const others = files.filter(f => /^جهاز-\d+\.json$/.test(f.name) && f.name !== mine);
    status.devices = others.length;
    if (!others.length) return 0;

    let merged = window.DB_BACKEND._readLocal().data;
    let added = 0;
    for (const f of others) {
      try {
        const doc = await Drive.readFile(f.id);
        if (!doc || !doc.data) continue;
        const out = Merge.combine(merged, doc.data);
        merged = out.data;
        added += out.report.added;
      } catch (e) { /* ملف واحد باظ ما يوقفش الباقي */ }
    }

    if (added > 0) {
      const cur = window.DB_BACKEND._readLocal();
      window.DB_BACKEND._writeLocal({ version: Number(cur.version || 0) + 1, data: merged });
      await DB.reload();
    }
    return added;
  }

  async function runOnce(silent) {
    if (running) return 0;
    if (!Drive.isSignedIn()) { status.signedIn = false; return 0; }
    if (!navigator.onLine) { status.error = 'مفيش نت'; return 0; }
    running = true;
    status.signedIn = true;
    try {
      const added = await pullOthers();
      await pushMine();
      status.lastSync = Utils.nowISO();
      status.error = null;

      if (added > 0) {
        if (!silent && typeof Utils !== 'undefined') {
          Utils.toast('وصلك ' + added + ' سجل جديد من المحل', 'success');
        }
        if (typeof AppState !== 'undefined') {
          await AppState.reloadItems();
          await AppState.reloadParties();
        }
        if (typeof navigate === 'function' && typeof currentRoute === 'string') {
          try { await navigate(currentRoute); } catch (e) { }
        }
      }
      return added;
    } catch (e) {
      status.error = e.message;
      return 0;
    } finally { running = false; }
  }

  function start() {
    stop();
    setTimeout(() => runOnce(true), 4000);
    timer = setInterval(() => runOnce(true), EVERY_MS);
    // أول ما النت يرجع، نزامن على طول
    window.addEventListener('online', () => runOnce(true));
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  function getStatus() { return Object.assign({}, status, { pending: dirty }); }

  return { start, stop, runOnce, markDirty, getStatus, pushMine, pullOthers };
})();
