/* هوية الجهاز — أساس شغل أكتر من جهاز على نفس البيانات

   المشكلة اللي بيحلها الملف ده:
   لو الموبايل والكمبيوتر الاتنين عملوا سجل جديد وهما مش شايفين بعض،
   كل واحد فيهم هياخد نفس الرقم (أكبر رقم + ١)، وأول ما يتقابلوا
   واحد هيمسح التاني. ونفس الحكاية في أرقام الفواتير.

   الحل: كل جهاز بياخد رقم لوحده، وليه مدى أرقام خاص بيه:
     الجهاز ١ (الكمبيوتر الأساسي) : 1 .. 999,999,999   (زي ما كان بالظبط)
     الجهاز ٢ (الموبايل)          : 2,000,000,001 ..
     الجهاز ٣                     : 3,000,000,001 ..
   فمستحيل اتنين يطلعوا نفس الرقم حتى لو مفيش نت خالص بينهم.

   وأرقام الفواتير: الجهاز الأساسي بيفضل ف-00001 زي ما هو،
   وأي جهاز تاني بياخد علامة: ف-م2-00001 — عشان تعرف الفاتورة اتكتبت منين. */

const Device = (() => {
  const KEY = 'mostafaDeviceNo';
  const NAME_KEY = 'mostafaDeviceName';
  const RANGE = 1000000000;   // مدى أرقام كل جهاز
  const LIST_KEY = 'devices';

  let no = null;
  let name = null;

  function guessName() {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'موبايل أندرويد';
    if (/iphone|ipad|ipod/i.test(ua)) return 'آيفون';
    if (['localhost', '127.0.0.1'].includes(location.hostname)) return 'كمبيوتر المحل';
    return 'جهاز';
  }

  /* بيحجز رقم جهاز جديد. الحجز بيتم جوه معاملة، فلو جهازين حاولوا
     ياخدوا نفس الرقم في نفس اللحظة، واحد بس هينجح والتاني هيعيد
     المحاولة وياخد الرقم اللي بعده. */
  // الرقم ١ محجوز لكمبيوتر المحل وحده. أي جهاز تاني بيبدأ من ٢.
  // من غير القاعدة دي، الموبايل — لأنه بيبدأ ببيانات فاضية — كان
  // بياخد رقم ١ هو كمان، فيطلعوا فواتير بنفس الأرقام وتدوس على بعض.
  function isShopPc() {
    return ['localhost', '127.0.0.1'].includes(location.hostname);
  }

  async function claim(desiredName) {
    let claimed = null;
    const first = isShopPc() ? 1 : 2;
    await DB.tx(['settings'], 'readwrite', async (t) => {
      const store = t.objectStore('settings');
      const rec = await DB.reqToPromise(store.get(LIST_KEY));
      const list = (rec && Array.isArray(rec.value)) ? rec.value.slice() : [];
      const used = new Set(list.map(d => Number(d.no)));
      let n = first;
      while (used.has(n)) n++;
      claimed = n;
      list.push({ no: n, name: desiredName, since: Utils.nowISO() });
      await DB.reqToPromise(store.put({ key: LIST_KEY, value: list }));
    });
    return claimed;
  }

  async function init() {
    name = localStorage.getItem(NAME_KEY) || guessName();
    const stored = Number(localStorage.getItem(KEY) || 0);

    /* إصلاح ذاتي: الرقم ١ لكمبيوتر المحل وحده.
       الموبايل كان بياخد رقم ١ في النسخة القديمة من البرنامج، وساعتها
       بيتجاهل ملف الكمبيوتر (فاكره بتاعه هو) فمبيشوفش بياناته ولا كلمة
       السر، وكمان بيدوس على ملفه في الدرايف. فلو لقينا جهاز مش
       الكمبيوتر ماسك الرقم ١، بيسيبه وياخد رقم جديد لوحده. */
    if (stored === 1 && !isShopPc()) {
      localStorage.removeItem(KEY);
      no = await claim(name);
      localStorage.setItem(KEY, String(no));
      localStorage.setItem(NAME_KEY, name);
      return no;
    }

    if (stored >= 1) {
      no = stored;
      // نتأكد إنه لسه مسجّل في البيانات (يمكن البيانات اترجعت من نسخة قديمة)
      try {
        const rec = await DB.get('settings', LIST_KEY);
        const list = (rec && Array.isArray(rec.value)) ? rec.value : [];
        if (!list.some(d => Number(d.no) === no)) {
          await DB.tx(['settings'], 'readwrite', async (t) => {
            const store = t.objectStore('settings');
            const r = await DB.reqToPromise(store.get(LIST_KEY));
            const l = (r && Array.isArray(r.value)) ? r.value.slice() : [];
            if (!l.some(d => Number(d.no) === no)) {
              l.push({ no, name, since: Utils.nowISO() });
              await DB.reqToPromise(store.put({ key: LIST_KEY, value: l }));
            }
          });
        }
      } catch (e) { /* مش مشكلة — الرقم محجوز محليًا على أي حال */ }
      return no;
    }

    no = await claim(name);
    localStorage.setItem(KEY, String(no));
    localStorage.setItem(NAME_KEY, name);
    return no;
  }

  // أول رقم في مدى الجهاز ده. الجهاز الأساسي بيفضل على الأرقام القديمة.
  function idBase() {
    if (no === null) return 0;
    return no === 1 ? 0 : no * RANGE;
  }
  function idCeiling() { return idBase() + RANGE; }

  // العلامة اللي بتتحط في رقم الفاتورة: الجهاز الأساسي من غير علامة
  function tag() {
    if (no === null || no === 1) return '';
    return 'م' + no;
  }

  function current() { return no; }
  function currentName() { return name; }

  async function list() {
    const rec = await DB.get('settings', LIST_KEY);
    return (rec && Array.isArray(rec.value)) ? rec.value : [];
  }

  async function rename(newName) {
    name = (newName || '').trim() || guessName();
    localStorage.setItem(NAME_KEY, name);
    await DB.tx(['settings'], 'readwrite', async (t) => {
      const store = t.objectStore('settings');
      const r = await DB.reqToPromise(store.get(LIST_KEY));
      const l = (r && Array.isArray(r.value)) ? r.value.slice() : [];
      const row = l.find(d => Number(d.no) === no);
      if (row) { row.name = name; } else { l.push({ no, name, since: Utils.nowISO() }); }
      await DB.reqToPromise(store.put({ key: LIST_KEY, value: l }));
    });
  }

  return { init, current, currentName, idBase, idCeiling, tag, list, rename, RANGE };
})();
