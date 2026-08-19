/* الصلاحيات: صاحب المحل والبائع

   - صاحب المحل: بيشوف كل حاجة (الأرباح، الخزنة، المشتريات والتكلفة، المصروفات...)
   - البائع: بيبيع ويسجّل مرتجعات العملاء بس — مش بيشوف تكلفة ولا ربح ولا رصيد خزنة

   لو مفيش كلمة سر متحطة، البرنامج بيشتغل عادي كأن صاحب المحل هو اللي فاتحه
   (عشان ميقفلش على حد بالغلط). أول ما يحط كلمة سر، البرنامج بيبدأ بوضع البائع. */

const Auth = (() => {
  const PIN_KEY = 'ownerPin';
  const ROLE_KEY = 'mostafaRole';
  const IDLE_MINUTES = 15;

  // الشاشات اللي لصاحب المحل بس
  const OWNER_ROUTES = ['reports', 'purchases', 'expenses', 'treasury', 'assets', 'company', 'connect'];

  let role = 'owner';
  let pinHash = null;
  let lastActivity = Date.now();
  let idleTimer = null;

  async function hash(pin) {
    const data = new TextEncoder().encode('mostafa-store:' + pin);
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 0;
    for (const b of data) h = ((h << 5) - h + b) | 0;
    return 'x' + Math.abs(h).toString(16);
  }

  async function init() {
    const rec = await DB.get('settings', PIN_KEY);
    pinHash = rec ? rec.value : null;
    // مهم: كل مرة البرنامج يتفتح بيبدأ بوضع البائع طول ما فيه كلمة سر.
    // مش بنفتكر إن الجهاز ده لصاحب المحل — لأن أي حد بيفتح البرنامج
    // الصبح يبقى بائع لحد ما صاحب المحل يدخل بنفسه.
    role = pinHash ? 'seller' : 'owner';
    localStorage.removeItem(ROLE_KEY);
    return role;
  }

  /* بيعيد قراءة كلمة السر من البيانات.
     لازم تتنده بعد أي مزامنة تجيب بيانات جديدة — لأن البرنامج بيقرا
     كلمة السر مرة واحدة وقت الفتح. من غير كده، الموبايل يفضل مقارن
     بكلمة سر قديمة ويقول "غلط" رغم إنك بتكتب الصح. */
  async function refreshPin() {
    let newHash = null;
    try {
      const rec = await DB.get('settings', PIN_KEY);
      newHash = rec ? rec.value : null;
    } catch (e) { return false; }
    if (newHash === pinHash) return false;

    pinHash = newHash;
    // مبقاش فيه كلمة سر خالص؟ يبقى مفيش حاجة تتقفل
    if (!pinHash && role !== 'owner') setRole('owner');
    if (typeof refreshRoleUI === 'function') refreshRoleUI();
    return true;
  }

  function isEnabled() { return !!pinHash; }
  function current() { return role; }
  function isOwner() { return role === 'owner'; }
  function isSeller() { return !!pinHash && role === 'seller'; }

  function canSee(route) {
    if (!pinHash) return true;
    if (role === 'owner') return true;
    return !OWNER_ROUTES.includes(route);
  }

  // ---------- لو صاحب المحل ساب الجهاز، بيرجع لوضع البائع لوحده ----------
  function touch() { lastActivity = Date.now(); }
  function startIdleWatch() {
    stopIdleWatch();
    ['click', 'keydown', 'input'].forEach(e => document.addEventListener(e, touch, true));
    idleTimer = setInterval(() => {
      if (role === 'owner' && pinHash && (Date.now() - lastActivity) > IDLE_MINUTES * 60000) {
        logout(true);
      }
    }, 30000);
  }
  function stopIdleWatch() {
    if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
    ['click', 'keydown', 'input'].forEach(e => document.removeEventListener(e, touch, true));
  }

  // الصلاحية بتفضل للجلسة الحالية بس — مش بتتحفظ على الجهاز
  function setRole(r) {
    role = r;
    if (r === 'owner') { lastActivity = Date.now(); startIdleWatch(); } else { stopIdleWatch(); }
    if (typeof refreshRoleUI === 'function') refreshRoleUI();
  }

  function logout(auto) {
    if (!pinHash) return;
    setRole('seller');
    if (typeof Utils !== 'undefined') {
      Utils.toast(auto ? 'اتقفل تلقائيًا — رجعنا لوضع البائع' : 'خرجت من حساب صاحب المحل', 'info');
    }
    if (typeof navigate === 'function') navigate('sales');
  }

  function loginOwner(reason) {
    if (!pinHash) return Promise.resolve(true);
    if (role === 'owner') { touch(); return Promise.resolve(true); }

    return new Promise((resolve) => {
      const { close } = Utils.openModal({
        title: 'دخول صاحب المحل',
        bodyHtml: `
          <p class="muted" style="font-size:13px;margin-bottom:14px;">
            ${Utils.escapeHtml(reason || 'الجزء ده لصاحب المحل بس')} — اكتب كلمة السر.
          </p>
          <form id="pinForm" autocomplete="off">
            <div class="field">
              <input type="password" id="pinInput" inputmode="numeric"
                     autocomplete="one-time-code" name="otp-${Date.now()}" readonly
                     placeholder="••••" style="text-align:center;font-size:24px;letter-spacing:8px;">
              <div class="hint" id="pinErr" style="color:var(--danger);"></div>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" id="pinCancel">إلغاء</button>
              <button type="submit" class="btn btn-amber">دخول</button>
            </div>
          </form>`,
        onMount: (body) => {
          /* المتصفح بيحفظ كلمة السر وبيملاها لوحده، وساعتها أي حد
             يفتح النافذة يلاقيها مكتوبة ويدوس إنتر ويدخل.
             عشان كده: الخانة بتفضل للقراءة بس في الأول (المتصفح
             مبيملاش خانة زي دي)، وبنفضيها كذا مرة بعد ما تتفتح. */
          const inp = body.querySelector('#pinInput');
          // أول ما يكتب بإيده بنبطّل مسح، عشان مانمسحش اللي هو كتبه.
          // الكتابة الحقيقية بس هي اللي بتوقفه — الملء التلقائي مبيعملش
          // ضغطة زرار حقيقية، فمش بيعدّي من هنا.
          let typed = false;
          inp.addEventListener('keydown', (e) => { if (e.isTrusted) typed = true; });
          inp.addEventListener('paste', () => { typed = true; });

          const wipe = () => { if (!typed && inp.value) inp.value = ''; };
          wipe();
          [40, 150, 400].forEach(ms => setTimeout(wipe, ms));
          setTimeout(() => {
            inp.removeAttribute('readonly');
            wipe();
            inp.focus();
          }, 80);
          body.querySelector('#pinCancel').addEventListener('click', () => { close(); resolve(false); });
          body.querySelector('#pinForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const val = body.querySelector('#pinInput').value;
            if (await hash(val) === pinHash) {
              setRole('owner');
              close();
              resolve(true);
            } else {
              Utils.beep('error');
              body.querySelector('#pinErr').textContent = 'كلمة السر غلط';
              body.querySelector('#pinInput').value = '';
              body.querySelector('#pinInput').focus();
            }
          });
        }
      });
    });
  }

  async function requireOwner(reason) {
    if (!pinHash) return true;
    if (role === 'owner') { touch(); return true; }
    return loginOwner(reason);
  }

  async function setPin(pin) {
    if (!pin) {
      await DB.delete('settings', PIN_KEY);
      pinHash = null;
      setRole('owner');
      return;
    }
    pinHash = await hash(pin);
    await DB.put('settings', { key: PIN_KEY, value: pinHash });
    setRole('owner');
  }

  return {
    init, refreshPin, isEnabled, current, isOwner, isSeller, canSee,
    loginOwner, logout, requireOwner, setPin, OWNER_ROUTES
  };
})();

// اسم قديم عشان الكود اللي بينده Lock.require يفضل شغال
const Lock = {
  require: (reason) => Auth.requireOwner(reason),
  isEnabled: () => Auth.isEnabled(),
  setPin: (p) => Auth.setPin(p),
  isProtectedRoute: (r) => !Auth.canSee(r)
};
