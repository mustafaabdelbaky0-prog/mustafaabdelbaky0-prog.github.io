/* المزامنة عن طريق جوجل درايف — نفس الملف بيشتغل على الكمبيوتر والموبايل

   ليه اتكتبت كده:
   الإذن اللي بناخده من جوجل (drive.file) بيخلي البرنامج يشوف الملفات
   اللي هو عملها بنفسه بس. فلما كان الكمبيوتر بيكتب ملفاته عن طريق
   برنامج جوجل درايف المتسطب، الموبايل مكانش بيشوفها خالص — لأن اللي
   عملها هو البرنامج المتسطب مش برنامجنا.

   الحل: الجهازين يكتبوا ويقروا بنفس الطريقة (Drive API). ساعتها
   الاتنين "نفس البرنامج" عند جوجل، فكل واحد بيشوف ملفات التاني.

   وكل جهاز بيكتب ملف باسمه لوحده — جهاز-1.json للكمبيوتر،
   جهاز-2.json للموبايل — فمفيش جهازين بيكتبوا نفس الملف. */

const DriveSync = (() => {
  const EVERY_MS = 45000;
  let timer = null;
  let running = false;
  let dirty = false;
  let status = { signedIn: false, lastSync: null, error: null, devices: 0, pending: false };

  function myFile() { return 'جهاز-' + (Device.current() || 1) + '.json'; }
  function markDirty() { dirty = true; }

  async function snapshot() {
    const data = {};
    for (const s of DB.STORE_NAMES) data[s] = await DB.getAll(s);
    return data;
  }

  // بنكتب نسخة الجهاز ده عشان باقي الأجهزة تقراها
  async function push() {
    const data = await snapshot();
    await Drive.writeFile(myFile(), {
      device: Device.current(),
      deviceName: Device.currentName(),
      savedAt: Utils.nowISO(),
      data
    });
    dirty = false;
  }

  /* بنقرا ملفات الأجهزة التانية وندمجها. بيرجّع عدد السجلات الجديدة. */
  async function pull() {
    const files = await Drive.list();
    const mine = myFile();
    const others = files.filter(f => /^جهاز-\d+\.json$/.test(f.name) && f.name !== mine);
    status.devices = others.length;
    if (!others.length) return 0;

    let merged = await snapshot();
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
      await DB.replaceAll(merged);
      await DB.reload();
    }
    return added;
  }

  /* ---------- على الكمبيوتر: المزامنة عن طريق جوجل درايف المسطّب ----------

     المطلوب إن الكمبيوتر يرفع لوحده أول ما يلقط نت من غير دوسة ولا
     إذن. المتصفح مش بيقدر (إذن جوجل بيخلص كل ساعة وتجديده محتاج
     دوسة). لكن السيرفر بيكتب ملف الجهاز في فولدر جوجل درايف المسطّب،
     وبرنامج جوجل بيرفعه لوحده أول ما يلاقي نت — وبينزّل ملف الموبايل
     في نفس الفولدر، والسيرفر بيديهولنا من هنا. مفيش أي إذن في الموضوع.

     المتصفح لسه بيرفع بالـ API في حالة واحدة بس: أول مرة، عشان الملف
     يتعمل "باسم البرنامج" فالموبايل يقدر يشوفه. بعدها السيرفر بيكمّل. */
  const onPc = () => typeof window !== 'undefined' && !window.DB_BACKEND;
  let local = { ready: false, mine: false, lastPush: null, lastPull: null, pending: false, error: null, files: [] };

  async function tellServerWhoAmI() {
    if (!onPc()) return;
    try {
      await fetch('api/device', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ no: Device.current(), name: Device.currentName() }) });
    } catch (e) { }
  }

  async function pullLocal() {
    if (!onPc()) return 0;
    let info;
    try {
      const res = await fetch('api/cloud', { cache: 'no-store' });
      if (!res.ok) return 0;
      info = await res.json();
    } catch (e) { return 0; }
    local = Object.assign(local, info);
    const others = (info.files || []).filter(f => /^جهاز-\d+\.json$/.test(f.name));
    status.devices = Math.max(status.devices || 0, others.length);
    if (!others.length) return 0;

    let merged = await snapshot();
    let added = 0;
    for (const f of others) {
      try {
        const r = await fetch('api/cloud/file?name=' + encodeURIComponent(f.name), { cache: 'no-store' });
        if (!r.ok) continue;
        const doc = await r.json();
        if (!doc || !doc.data) continue;
        const out = Merge.combine(merged, doc.data);
        merged = out.data;
        added += out.report.added;
      } catch (e) { }
    }
    if (added > 0) {
      await DB.replaceAll(merged);
      await DB.reload();
    }
    if (local.ready) status.lastSync = Utils.nowISO();
    return added;
  }

  async function afterAdded(added, silent) {
    if (added <= 0) return;
    if (!silent && typeof Utils !== 'undefined') {
      Utils.toast('وصلك ' + added + ' سجل جديد من جهاز تاني', 'success');
    }
    /* مهم: كلمة السر ممكن تكون وصلت مع الدمج، فلازم البرنامج
       يعيد قراءتها. من غير كده بيفضل مقارن بالقديمة ويقول "غلط". */
    if (typeof Auth !== 'undefined' && Auth.refreshPin) {
      try { await Auth.refreshPin(); } catch (e) { }
    }
    if (typeof AppState !== 'undefined') {
      await AppState.reloadItems();
      await AppState.reloadParties();
      await AppState.reloadCompany();
    }
    if (typeof navigate === 'function' && typeof currentRoute === 'string' && currentRoute) {
      try { await navigate(currentRoute); } catch (e) { }
    }
    if (typeof refreshShell === 'function') { try { await refreshShell(); } catch (e) { } }
  }

  async function runOnce(silent) {
    if (running) return 0;
    running = true;
    try {
      /* على الكمبيوتر: الأول من السيرفر (من غير إذن). ده الطريق
         الأساسي — بيشتغل دايمًا. */
      let added = 0;
      if (onPc()) {
        try { added += await pullLocal(); } catch (e) { }
        /* السيرفر بيرفع ملفنا لوحده لو الملف موجود عنده. لو مش موجود
           (أول مرة) المتصفح هو اللي بيعمله بالـ API — محتاج إذن. */
        if (local.ready && local.mine) {
          status.signedIn = Drive.isSignedIn();
          status.error = local.error || null;
          await afterAdded(added, silent);
          return added;
        }
      }

      /* الإذن خلص؟ التجديد بيحصل مع أول دوسة من المستخدم (شوف onGesture
         تحت) — مش من هنا، لأن المتصفح بيمنع نافذة جوجل من غير دوسة. */
      if (!Drive.isSignedIn()) { status.signedIn = false; await afterAdded(added, silent); return added; }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        status.error = 'مفيش نت';
        await afterAdded(added, silent);
        return added;
      }
      status.signedIn = true;
      added += await pull();
      await push();
      status.lastSync = Utils.nowISO();
      status.error = null;
      await afterAdded(added, silent);
      return added;
    } catch (e) {
      status.error = e.message;
      return 0;
    } finally { running = false; }
  }


  /* ---------- تجديد الإذن مع أول دوسة ----------

     إذن جوجل بيخلص كل ساعة. التجديد بيفتح نافذة صغيرة بتقفل لوحدها
     (المستخدم مسجّل في كروم بحسابه فجوجل بتوافق فورًا). بس المتصفح
     بيمنع أي نافذة ماتفتحتش بدوسة من المستخدم — فالتجديد من التايمر
     كان بيفشل بصمت، والبرنامج يقول "مش مربوط" مع إنه مربوط.

     الحل: بنستنى أول دوسة من المستخدم في أي مكان في البرنامج ونجدد
     جواها. هو بيدوس طول الوقت، فالتجديد بيحصل من غير ما يحس. */
  let lastRenewTry = 0;
  let gestureHooked = false;

  function onGesture() {
    // على الكمبيوتر والسيرفر ماسك المزامنة: مفيش داعي لأي إذن ولا نافذة
    if (onPc() && local.ready && local.mine) return;
    if (!Drive.wasConnected() || Drive.isSignedIn()) return;
    if (Date.now() - lastRenewTry < 60000) return;   // مش هنزنّ كل دوسة
    lastRenewTry = Date.now();
    Drive.renewQuietly().then(ok => {
      if (!ok) return;
      status.signedIn = true;
      try { window.dispatchEvent(new Event('drive-renewed')); } catch (e) { }
      runOnce(true);
    }).catch(() => { });
  }

  function hookGesture() {
    if (gestureHooked || typeof document === 'undefined') return;
    gestureHooked = true;
    if (Drive.wasConnected()) Drive.preload();
    document.addEventListener('click', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
  }

  function start() {
    stop();
    hookGesture();
    tellServerWhoAmI();
    setTimeout(() => runOnce(true), 5000);
    timer = setInterval(() => runOnce(true), EVERY_MS);
    if (typeof window !== 'undefined') {
      // أول ما النت يرجع بنرفع على طول
      window.addEventListener('online', () => runOnce(true));
    }
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  // الجهاز مربوط بس الإذن محتاج تجديد (هيتجدد مع أول دوسة)
  function needsRenew() { return Drive.wasConnected() && !Drive.isSignedIn(); }

  function getStatus() { return Object.assign({}, status, { pending: dirty, local: Object.assign({}, local) }); }

  /* رسالة تشرح للمستخدم ليه المزامنة مجابتش حاجة.
     قبل كده كانت بتقول "كل حاجة متزامنة" حتى لو الجهاز التاني
     أصلاً مرفعش حاجة — فيفضل يدوس زرار المزامنة ومش فاهم إيه الناقص. */
  function explain(added) {
    if (!Drive.isSignedIn()) {
      if (Drive.wasConnected()) return { text: 'إذن جوجل بيتجدد — ثواني وجرّب تاني', kind: 'info' };
      return { text: 'الجهاز ده مش مربوط بجوجل — اربطه الأول', kind: 'error' };
    }
    if (status.error) return { text: status.error, kind: 'error' };
    if (added > 0) return { text: 'وصلك ' + added + ' سجل جديد', kind: 'success' };
    if (!status.devices) {
      return { text: 'مفيش أجهزة تانية رفعت حاجة لسه — افتح البرنامج على الجهاز التاني واربطه بجوجل', kind: 'info' };
    }
    return { text: 'كل حاجة متزامنة', kind: 'info' };
  }

  return { start, stop, runOnce, push, pull, pullLocal, markDirty, getStatus, explain, needsRenew };
})();
