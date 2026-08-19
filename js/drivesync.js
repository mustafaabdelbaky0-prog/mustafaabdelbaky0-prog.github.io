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

  async function runOnce(silent) {
    if (running) return 0;
    if (!Drive.isSignedIn()) { status.signedIn = false; return 0; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      status.error = 'مفيش نت';
      return 0;
    }
    running = true;
    status.signedIn = true;
    try {
      const added = await pull();
      await push();
      status.lastSync = Utils.nowISO();
      status.error = null;

      if (added > 0) {
        if (!silent && typeof Utils !== 'undefined') {
          Utils.toast('وصلك ' + added + ' سجل جديد من جهاز تاني', 'success');
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
      return added;
    } catch (e) {
      status.error = e.message;
      return 0;
    } finally { running = false; }
  }

  function start() {
    stop();
    setTimeout(() => runOnce(true), 5000);
    timer = setInterval(() => runOnce(true), EVERY_MS);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => runOnce(true));
    }
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  function getStatus() { return Object.assign({}, status, { pending: dirty }); }

  return { start, stop, runOnce, push, pull, markDirty, getStatus };
})();
