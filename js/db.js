/* طبقة البيانات - البيانات محفوظة على الكمبيوتر (السيرفر) عشان الموبايل والكمبيوتر يشوفوا نفس الحاجة
   الواجهة هنا مطابقة للقديمة بالظبط عشان services.js وباقي الشاشات ما تتغيرش */

const DB = (() => {

  const STORE_NAMES = ['items','stockMovements','sales','purchases','returns','expenses','treasury',
                       'customers','suppliers','fixedAssets','company','settings','dayClosings',
                       'employees','employeeMoves','payrollClosings'];

  // الجداول اللي مفتاحها مش "id"
  function keyNameOf(store) {
    return store === 'settings' ? 'key' : 'id';
  }

  // نسخة البيانات اللي في الذاكرة (مرآة لللي على السيرفر)
  let mirror = null;      // { version, data: { store: [rows] } }
  let listeners = [];

  function clone(v) {
    return v === undefined || v === null ? v : JSON.parse(JSON.stringify(v));
  }

  function rowsOf(store) {
    if (!mirror) return [];
    return mirror.data[store] || (mirror.data[store] = []);
  }

  // ---------- الاتصال بالسيرفر ----------
  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    if (res.status === 409) {
      const err = new Error('version_conflict');
      err.conflict = true;
      throw err;
    }
    if (!res.ok) throw new Error('server_error_' + res.status);
    return res.json();
  }

  /* مصدر البيانات قابل للتبديل:
       - على كمبيوتر المحل: السيرفر المحلي (الافتراضي تحت)
       - على الموقع من الموبايل: جوجل درايف (js/backend-drive.js)
     الاتنين بيقدّموا نفس التلات دوال، فباقي البرنامج مش بيفرق معاه. */
  const ServerBackend = {
    async load() {
      const p = await fetchJson('api/data', { cache: 'no-store' });
      return { version: p.version, data: p.data || {} };
    },
    async commit(baseVersion, ops) {
      const p = await fetchJson('api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseVersion, ops })
      });
      return p.version;
    },
    async replace(data) {
      const p = await fetchJson('api/replace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data })
      });
      return p.version;
    }
  };

  function backend() {
    return (typeof window !== 'undefined' && window.DB_BACKEND) ? window.DB_BACKEND : ServerBackend;
  }

  async function loadFromServer() {
    const payload = await backend().load();
    const data = {};
    STORE_NAMES.forEach(s => { data[s] = Array.isArray(payload.data[s]) ? payload.data[s] : []; });
    mirror = { version: payload.version, data };
    return mirror;
  }

  async function open() {
    if (!mirror) await loadFromServer();
    return mirror;
  }

  async function reload() {
    await loadFromServer();
    listeners.forEach(fn => { try { fn(); } catch (e) {} });
    return mirror;
  }

  function onChange(fn) { listeners.push(fn); }
  function currentVersion() { return mirror ? mirror.version : -1; }

  // ---------- تنفيذ العمليات محليًا بعد ما السيرفر يقبلها ----------
  function applyOpsToMirror(ops) {
    ops.forEach(op => {
      const key = keyNameOf(op.store);
      const rows = rowsOf(op.store);
      if (op.type === 'clear') {
        mirror.data[op.store] = [];
      } else if (op.type === 'delete') {
        mirror.data[op.store] = rows.filter(r => r[key] !== op.id);
      } else if (op.type === 'put') {
        const idx = rows.findIndex(r => r[key] === op.row[key]);
        if (idx >= 0) rows[idx] = clone(op.row);
        else rows.push(clone(op.row));
      }
    });
  }

  async function commitOps(ops) {
    if (!ops.length) return;
    const newVersion = await backend().commit(mirror.version, ops);
    applyOpsToMirror(ops);
    mirror.version = newVersion;
  }

  // ---------- المعاملة (transaction) ----------
  // بتشتغل على طبقة مؤقتة فوق المرآة، وتسجّل العمليات، وتبعتها مرة واحدة في الآخر.
  // لو السيرفر رفض (حد تاني كتب قبلنا) بنعيد التحميل وننفذ الدالة من الأول.
  function makeTx(ops) {
    const overlay = {};   // store -> { key -> row | DELETED }
    const DELETED = Symbol('deleted');

    function overlayOf(store) {
      return overlay[store] || (overlay[store] = {});
    }

    function readRow(store, key) {
      const ov = overlayOf(store);
      if (Object.prototype.hasOwnProperty.call(ov, key)) {
        return ov[key] === DELETED ? undefined : clone(ov[key]);
      }
      const kn = keyNameOf(store);
      const found = rowsOf(store).find(r => String(r[kn]) === String(key));
      return found ? clone(found) : undefined;
    }

    /* وقت آخر تعديل — بيتحط على كل صف بيتكتب.
       لما الموبايل والكمبيوتر يتقابلوا، ده اللي بيحدد الأحدث. */
    function stamp(row) {
      try { row.updatedAt = Utils.nowISO(); } catch (e) { }
    }

    /* كل جهاز بياخد أرقامه من المدى بتاعه هو بس — عشان لو الموبايل
       والكمبيوتر عملوا سجلات وهما مقطوعين عن بعض، ميطلعوش نفس الرقم
       ويمسحوا شغل بعض أول ما يتزامنوا. */
    function nextId(store) {
      const kn = keyNameOf(store);
      const base = (typeof Device !== 'undefined') ? Device.idBase() : 0;
      const ceil = (typeof Device !== 'undefined') ? Device.idCeiling() : Infinity;
      let max = base;
      const consider = (r) => {
        const v = Number(r[kn]);
        if (v >= base && v < ceil && v > max) max = v;
      };
      rowsOf(store).forEach(consider);
      Object.values(overlayOf(store)).forEach(r => { if (r !== DELETED) consider(r); });
      return max + 1;
    }

    return {
      objectStore(store) {
        const kn = keyNameOf(store);
        return {
          get(key) { return readRow(store, key); },
          getAll() {
            const ov = overlayOf(store);
            const base = rowsOf(store).filter(r => !Object.prototype.hasOwnProperty.call(ov, r[kn]));
            const extra = Object.values(ov).filter(r => r !== DELETED);
            return clone(base.concat(extra));
          },
          // put بيضيف صف جديد لو مالوش رقم، وبيعدّل الموجود لو ليه رقم.
          // مهم جدًا: لازم يولّد رقم لوحده زي ما قاعدة البيانات القديمة كانت بتعمل،
          // وإلا كل الأصناف الجديدة هتتخزن برقم فاضي وتدوس على بعض.
          put(row) {
            const copy = clone(row);
            if (copy[kn] === undefined || copy[kn] === null || copy[kn] === '') copy[kn] = nextId(store);
            stamp(copy);
            overlayOf(store)[copy[kn]] = copy;
            ops.push({ store, type: 'put', row: copy });
            return copy[kn];
          },
          add(row) {
            const copy = clone(row);
            if (copy[kn] === undefined || copy[kn] === null || copy[kn] === '') copy[kn] = nextId(store);
            stamp(copy);
            overlayOf(store)[copy[kn]] = copy;
            ops.push({ store, type: 'put', row: copy });
            return copy[kn];
          },
          delete(key) {
            overlayOf(store)[key] = DELETED;
            ops.push({ store, type: 'delete', id: key });
            return undefined;
          },
          clear() {
            ops.push({ store, type: 'clear' });
            overlay[store] = {};
            return undefined;
          }
        };
      }
    };
  }

  const MAX_ATTEMPTS = 12;

  async function tx(storeNames, mode, fn) {
    await open();
    let lastErr = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const ops = [];
      const t = makeTx(ops);
      let result;
      try {
        result = await fn(t);
      } catch (e) {
        throw e; // خطأ في المنطق نفسه - مش هينفع نعيد المحاولة
      }
      if (mode !== 'readwrite' || ops.length === 0) return result;
      try {
        await commitOps(ops);
        return result;
      } catch (e) {
        lastErr = e;
        if (e.conflict) {
          // حد تاني كتب قبلنا. بنستنى شوية بشكل عشوائي عشان لو فيه كذا عملية
          // مع بعض مايفضلوش يتصادموا في نفس اللحظة كل مرة، وبعدين نعيد من الأول.
          await new Promise(r => setTimeout(r, 20 + Math.random() * 60 * (attempt + 1)));
          await loadFromServer();
          continue;
        }
        throw e;
      }
    }
    throw lastErr || new Error('العملية مانجحتش بعد كذا محاولة — جرب تاني');
  }

  // reqToPromise كانت بتلف طلبات IndexedDB - دلوقتي القيم جاهزة فبنرجعها زي ما هي
  function reqToPromise(v) { return Promise.resolve(v); }

  // ---------- قراءة ----------
  async function getAll(store) {
    await open();
    return clone(rowsOf(store));
  }

  async function get(store, key) {
    await open();
    const kn = keyNameOf(store);
    const found = rowsOf(store).find(r => String(r[kn]) === String(key));
    return found ? clone(found) : undefined;
  }

  async function getAllByIndex(store, indexName, value) {
    await open();
    return clone(rowsOf(store).filter(r => r[indexName] === value));
  }

  // ---------- كتابة مباشرة (كل واحدة معاملة لوحدها) ----------
  async function add(store, obj) {
    return tx([store], 'readwrite', (t) => t.objectStore(store).add(obj));
  }

  async function put(store, obj) {
    return tx([store], 'readwrite', (t) => t.objectStore(store).put(obj));
  }

  async function del(store, key) {
    return tx([store], 'readwrite', (t) => t.objectStore(store).delete(key));
  }

  async function clearStore(store) {
    return tx([store], 'readwrite', (t) => t.objectStore(store).clear());
  }

  // ---------- استبدال كل البيانات (استرجاع نسخة احتياطية) ----------
  async function replaceAll(data) {
    const version = await backend().replace(data);
    await loadFromServer();
    mirror.version = version;
    return version;
  }

  return {
    open, reload, onChange, currentVersion, tx, reqToPromise,
    getAll, get, getAllByIndex, add, put, delete: del, clearStore, replaceAll,
    STORE_NAMES
  };
})();
