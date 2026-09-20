/* تحميل النسخة الجديدة من البرنامج (نسخة الكمبيوتر).

   اللي حصل: نزّلنا إصلاح، بس شباك البرنامج اللي مفتوح من الصبح فضل
   شغال بالكود القديم — وكل دقيقة بيعيد الدمج بالحسبة القديمة ويرجّع
   رصيد المورد غلط بعد ما صلّحناه. نسخة الموبايل بتتحدث لوحدها من
   زمان (webapp.js)؛ ده نظيرها للكمبيوتر.

   بيسأل السيرفر كل ٥ دقايق: النسخة اللي على القرص هي نفس اللي شغالة؟
   لو لأ بيوري شريط "فيه تحديث"، وبيعيد تحميل الصفحة لوحده بس لما
   يبقى أكيد إن مفيش شغل هيضيع:
     - مفيش لمسة للماوس أو الكيبورد من ١٠ دقايق
     - مفيش نافذة مفتوحة
     - الشاشة الحالية مش ماسكة فاتورة لسه ما اتحفظتش
   وفي أي وقت يقدر يدوس "حدّث دلوقتي" من الشريط. */
const Updater = (() => {
  const TICK_MS = 60 * 1000;
  const CHECK_MS = 5 * 60 * 1000;
  const IDLE_MS = 10 * 60 * 1000;
  let lastInput = Date.now();
  let lastCheck = 0;
  let pending = null;          // النسخة الجديدة اللي لقيناها على القرص
  let timer = null;
  let reload = () => location.reload();

  function touched() { lastInput = Date.now(); }

  async function newerOnDisk() {
    const res = await fetch('js/state.js?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    const m = (await res.text()).match(/APP_VERSION\s*=\s*'([^']*)'/);
    return (m && m[1] && m[1] !== APP_VERSION) ? m[1] : null;
  }

  // ليه مينفعش نعيد التحميل دلوقتي؟ (null = ينفع)
  function busy() {
    if (Date.now() - lastInput < IDLE_MS) return 'شغال';
    if (document.querySelector('.modal-overlay')) return 'نافذة مفتوحة';
    const mod = (typeof Modules !== 'undefined' && typeof currentRoute !== 'undefined') ? Modules[currentRoute] : null;
    if (mod && typeof mod.hasUnsaved === 'function' && mod.hasUnsaved()) return 'فاتورة لسه ما اتحفظتش';
    return null;
  }

  function showStrip(ver) {
    if (document.getElementById('updateStrip')) return;
    const el = document.createElement('div');
    el.id = 'updateStrip';
    el.className = 'update-strip';
    el.innerHTML = `<span>🆕 فيه نسخة جديدة من البرنامج (${Utils.escapeHtml(ver)}) — هتتحمّل لوحدها أول ما تسيب البرنامج شوية</span>
      <button type="button" id="updateNow">حدّث دلوقتي</button>`;
    document.body.appendChild(el);
    el.querySelector('#updateNow').addEventListener('click', () => reload());
  }

  async function tick(now = Date.now()) {
    try {
      if (!pending && now - lastCheck >= CHECK_MS) {
        lastCheck = now;
        pending = await newerOnDisk();
      }
      if (!pending) return false;
      showStrip(pending);
      if (busy()) return false;
      reload();
      return true;
    } catch (e) { return false; }   // السيرفر مش بيرد؟ نكمل عادي ونجرب بعدين
  }

  function start() {
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev =>
      document.addEventListener(ev, touched, { capture: true, passive: true }));
    if (timer) clearInterval(timer);
    timer = setInterval(() => tick(), TICK_MS);
  }

  return {
    start, tick, busy,
    _test: {
      setLastInput: t => { lastInput = t; },
      setReload: f => { reload = f; },
      reset: () => { pending = null; lastCheck = 0; const s = document.getElementById('updateStrip'); if (s) s.remove(); }
    }
  };
})();
