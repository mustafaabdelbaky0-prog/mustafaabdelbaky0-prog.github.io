/* أدوات مشتركة: تنسيق، إشعارات، نوافذ منبثقة */

const Utils = (() => {

  // بنستخدم الأرقام العادية (1234) مش الهندية (١٢٣٤) - دي اللي على الآلة الحاسبة
  // وعلى أسعار البضاعة، وأسهل وأسرع في القراءة وقت الشغل.
  const LOCALE = 'ar-EG-u-nu-latn';

  function formatMoney(n) {
    const v = Number(n || 0);
    return v.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';
  }

  function formatDate(d) {
    const date = d ? new Date(d) : new Date();
    return date.toLocaleDateString(LOCALE, { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  function formatDateTime(d) {
    const date = d ? new Date(d) : new Date();
    return date.toLocaleDateString(LOCALE, { year: 'numeric', month: '2-digit', day: '2-digit' }) +
      ' - ' + date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  }

  // اليوم بتوقيت المحل مش بتوقيت جرينتش. لو استعملنا toISOString هنا،
  // فاتورة الساعة ١٢ ونص بالليل كانت هتتسجل بتاريخ امبارح (فرق التوقيت ساعتين/تلاتة).
  function dateKey(d) {
    const date = d ? new Date(d) : new Date();
    const p = n => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
  }

  function todayISO() {
    return dateKey();
  }

  function nowISO() {
    return new Date().toISOString();
  }

  /* باركود داخلي للأصناف اللي مالهاش باركود من المصنع.

     رقم قصير بالترتيب: 10001، 10002، 10003...
     قصير عشان تقدر تنطقه في التليفون وتكتبه بالإيد لو الملصق اتخرش،
     وفي نفس الوقت مايتلخبطش مع باركود المصنع (اللي بيبقى ٨ أو ١٢
     أو ١٣ رقم).

     كل جهاز ليه مدى لوحده (الكمبيوتر 1xxxx والموبايل 2xxxx) عشان
     لو الاتنين عملوا صنف جديد وهما مقطوعين عن بعض مايطلعش نفس الرقم. */
  const BARCODE_SEQ_KEY = 'itemBarcodeSeq';

  async function genInternalBarcode() {
    const no = (typeof Device !== 'undefined' && Device.current()) ? Device.current() : 1;
    const base = no * 10000;

    const rec = await DB.get('settings', BARCODE_SEQ_KEY + ':' + no);
    let seq = rec ? Number(rec.value) : 0;

    // بنتأكد إن الرقم مش مستعمل — لو جه صنف من الجهاز التاني بنعدّي عليه
    const taken = new Set((await DB.getAll('items')).map(i => String(i.barcode || '')));
    let code;
    do { seq++; code = String(base + seq); } while (taken.has(code) && seq < 9999);

    await DB.put('settings', { key: BARCODE_SEQ_KEY + ':' + no, value: seq });
    return code;
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  // ---------- صوت التأكيد ----------
  // مع جهاز الليزر المستخدم بيبص على البضاعة مش على الشاشة،
  // فالصوت هو اللي بيقوله إن المسح نجح ولا لأ.
  let audioCtx = null;
  function beep(kind = 'ok') {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      const now = audioCtx.currentTime;
      if (kind === 'error') {
        osc.frequency.setValueAtTime(220, now);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
        osc.start(now); osc.stop(now + 0.28);
      } else {
        osc.frequency.setValueAtTime(1750, now);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
        osc.start(now); osc.stop(now + 0.11);
      }
    } catch (e) { /* الصوت مش ضروري للشغل */ }
  }

  // ---------- Toast ----------
  let toastBox;
  function toast(msg, type = 'info') {
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'toast-box';
      document.body.appendChild(toastBox);
    }
    const item = document.createElement('div');
    item.className = `toast toast-${type}`;
    item.textContent = msg;
    toastBox.appendChild(item);
    requestAnimationFrame(() => item.classList.add('show'));
    setTimeout(() => {
      item.classList.remove('show');
      setTimeout(() => item.remove(), 250);
    }, 2600);
  }

  // ---------- Modal ----------
  function openModal({ title, bodyHtml, onMount, wide }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal ${wide ? 'modal-wide' : ''}">
        <div class="modal-head">
          <h3>${escapeHtml(title)}</h3>
          <button class="modal-close" type="button">&times;</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const escHandler = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
    if (onMount) onMount(overlay.querySelector('.modal-body'), close);
    return { close, overlay };
  }

  function confirmDialog(message) {
    return new Promise((resolve) => {
      const { close } = openModal({
        title: 'تأكيد',
        bodyHtml: `
          <p style="margin:0 0 18px;font-size:15px;line-height:1.85;white-space:pre-line;">${escapeHtml(message)}</p>
          <div class="form-actions">
            <button class="btn btn-ghost" id="cd-no" type="button">إلغاء</button>
            <button class="btn btn-danger" id="cd-yes" type="button">تأكيد</button>
          </div>`,
        onMount: (body) => {
          body.querySelector('#cd-yes').addEventListener('click', () => { close(); resolve(true); });
          body.querySelector('#cd-no').addEventListener('click', () => { close(); resolve(false); });
        }
      });
    });
  }

  /* ---------- منع تسجيل نفس العملية مرتين ----------

     المشكلة اللي حصلت فعلاً في المحل: دفعة لمورد اتسجلت ١١ مرة.
     السيرفر كان بيعلّق ثواني وهو بيعمل ملف الإكسيل، فالمستخدم
     دوس "حفظ" ومحصلش حاجة، فدوس تاني وتالت... وكل دوسة اتسجلت
     عملية كاملة لوحدها.

     السبب الأصلي اتصلّح في السيرفر، بس ده مايمنعش إن أي تأخير
     تاني (شبكة، موبايل، جهاز بطيء) يعمل نفس الحكاية. فالحل إن
     الزرار نفسه يقفل وهو شغال ويقول "بيسجل..." — كده المستخدم
     شايف إن البرنامج بيشتغل، ولو دوس تاني مفيش حاجة بتحصل.

     الاستعمال:  Utils.guardSubmit(form, async () => { ... })  */
  function guardSubmit(form, handler) {
    if (!form) return;
    let busy = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;                       // شغال بالفعل — الدوسة دي مالهاش لازمة
      busy = true;
      const btn = form.querySelector('button[type="submit"], .btn-primary, .btn-amber');
      const was = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'بيسجل...'; }
      try {
        await handler(e);
      } catch (err) {
        toast(err && err.message ? err.message : 'حصلت مشكلة', 'error');
      } finally {
        busy = false;
        // لو الشاشة اتقفلت خلاص مفيش حاجة نرجّعها
        if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = was; }
      }
    });
  }

  /* اسم الخانة من الكلاس بتاعها: "cell f-qty num" ← "qty".
     بنستعملها عشان Enter ينزّل على نفس العمود في السطر اللي تحت
     زي الإكسيل — في فواتير الشرا والبيع والمرتجعات. */
  function fieldOf(el) {
    const m = String((el && el.className) || '').match(/\bf-([a-z]+)\b/);
    return m ? m[1] : 'barcode';
  }

  return {
    formatMoney, formatDate, formatDateTime, todayISO, nowISO, dateKey,
    genInternalBarcode, debounce, el, escapeHtml, fieldOf,
    beep, toast, openModal, confirmDialog, guardSubmit
  };
})();

/* ======================= البحث اللي بيفهم العربي =======================

   البحث القديم كان بيدوّر على الحروف بالظبط زي ما اتكتبت. وده مع
   أسماء أصناف المحل مبيشتغلش: عندنا ٥٧٨ صنف، ٢٩٠ منهم الرقم لازق
   في الحرف ("لمبه 9وات")، و٢٦٠ فيهم ة وه مختلطين ("لمبة" / "لمبه").
   فلو كتب "لمبة 9 وات" كان بيلاقي صفر — مع إن عنده ٦ لمبات ٩ وات.

   البحث ده بيعمل ٣ حاجات:

   ١) تطبيع: بيخلي الكلمتين يتقارنوا بعد ما نسوّي الاختلافات اللي
      ملهاش معنى: ة=ه، ى=ي، أإآ=ا، الأرقام العربي=إنجليزي، وبيفصل
      الرقم عن الحرف ("9وات" ← "9 وات")، وبيشيل التشكيل.

   ٢) كلمات مش جملة: "9 وات لمبه" بتلاقي "لمبه 9وات". كل كلمة
      كتبها لازم تتلقي في مكان ما — بأي ترتيب.

   ٣) ترتيب النتايج: الباركود المطابق الأول، وبعدين اللي اسمه
      بيبدأ باللي كتبه، وبعدين الباقي — عشان اللي في دماغه يطلع فوق. */
const Search = (() => {

  const AR_DIGITS = { '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
                      '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9' };

  function norm(s) {
    let t = String(s == null ? '' : s).toLowerCase();
    t = t.replace(/[٠-٩۰-۹]/g, ch => AR_DIGITS[ch] || ch);        // ٩ ← 9
    t = t.replace(/[ً-ْـ]/g, '');                   // تشكيل وتطويل
    t = t.replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
         .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
    // علامات ملهاش معنى في البحث تبقى مسافات — بس النقطة اللي بين رقمين
    // (1.5 ملي) بتفضل
    t = t.replace(/\.(?!\d)|(?<!\d)\./g, ' ');
    t = t.replace(/[-_/\\×*+,،؛;:()\[\]{}"'«»<>!?؟@#%^&=|~`]/g, ' ');
    // الرقم اللازق في الحرف يتفصل: "9وات" ← "9 وات"، "اصلي1.5ملي" ← "اصلي 1.5 ملي"
    t = t.replace(/(\d)(?=[^\d\s.])/g, '$1 ').replace(/([^\d\s.])(?=\d)/g, '$1 ');
    return t.replace(/\s+/g, ' ').trim();
  }

  function tokens(s) {
    return norm(s).split(' ').filter(Boolean);
  }

  /* درجة مطابقة نص لاستعلام. صفر = مش مطابق.
     بنقيس على كلمات الاستعلام: كل كلمة لازم تتلقي (بداية كلمة =
     أقوى، جوه كلمة = أضعف). */
  function scoreText(text, qTokens, nText) {
    const t = nText != null ? nText : norm(text);
    if (!t) return 0;
    const words = t.split(' ');
    let total = 0;
    for (const q of qTokens) {
      let best = 0;
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (w === q)                 { best = Math.max(best, 30 - Math.min(i, 9)); }
        else if (w.startsWith(q))    { best = Math.max(best, 20 - Math.min(i, 9)); }
        else if (w.includes(q))      { best = Math.max(best, 8); }
      }
      if (!best) return 0;           // كلمة مش موجودة = الصنف مش هو
      total += best;
    }
    const q = qTokens.join(' ');
    if (t === q) total += 100;             // الاسم هو هو بالظبط — الأول دايمًا
    else if (t.startsWith(q)) total += 40; // بيبدأ بالجملة كلها زي ما كتبها
    /* الاسم الأقصر أقرب للي في دماغه — بس بدرجات واسعة، عشان الأصناف
       المتقاربة تفضل بترتيبها الطبيعي (ترتيب التسجيل) مش تتقلب على
       فرق حرفين */
    return total + Math.max(0, 10 - Math.floor(t.length / 8));
  }

  /* البحث في الأصناف: بالاسم أو الباركود أو التصنيف.
     بيرجّع قايمة مرتبة من الأحسن للأقل. */
  function items(query, list) {
    const all = list || (typeof AppState !== 'undefined' ? AppState.items : []) || [];
    const q = norm(query);
    if (!q) return all.slice();
    const qt = q.split(' ');
    const out = [];
    for (const it of all) {
      const bc = norm(it.barcode);
      let s = 0;
      if (bc && bc === q) s = 1000;
      else if (bc && bc.startsWith(q)) s = 500;
      else {
        s = scoreText(it.name, qt);
        if (!s && bc && bc.includes(q)) s = 60;
        if (!s && it.category) s = scoreText(it.category, qt) ? 5 : 0;
      }
      if (s) out.push({ it, s });
    }
    out.sort((a, b) => b.s - a.s);
    return out.map(o => o.it);
  }

  // هل النص ده مطابق للاستعلام؟ (للفلترة البسيطة: سطور فاتورة، قوايم)
  function matches(text, query) {
    const q = norm(query);
    if (!q) return true;
    return scoreText(text, q.split(' ')) > 0;
  }

  // مطابقة أي واحد من كذا نص (اسم + باركود + تصنيف مثلاً)
  function matchesAny(texts, query) {
    const q = norm(query);
    if (!q) return true;
    const qt = q.split(' ');
    // الكلمات ممكن تتوزع على النصوص: "سلك 10167" ← الاسم والباركود
    const joined = texts.map(norm).filter(Boolean).join(' ');
    return scoreText(null, qt, joined) > 0;
  }

  return { norm, tokens, items, matches, matchesAny, scoreText };
})();
