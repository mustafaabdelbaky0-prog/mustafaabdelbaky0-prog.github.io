/* تشغيل نسخة الموقع (اللي بتشتغل من الموبايل)

   الفرق عن نسخة الكمبيوتر:
     - البيانات بتتخزن على الموبايل نفسه، وبتتزامن مع الدرايف
     - أول مرة بس بيطلب تسجيل دخول بجوجل
     - مفيش شاشة "توصيل الموبايل" لأننا خلاص على الموبايل */

let currentRoute = null;

const WEB_ROUTES = ['reports','sales','purchases','returns','items',
                    'inventory','parties','expenses','treasury','assets','company','employees','finance'];

async function navigate(route) {
  if (!ROUTES[route] || WEB_ROUTES.indexOf(route) < 0) {
    route = Auth.isSeller() ? 'sales' : 'reports';
  }
  if (!Auth.canSee(route)) {
    const ok = await Auth.loginOwner('شاشة ' + ROUTES[route].title);
    if (!ok) {
      if (currentRoute && currentRoute !== route) return;
      route = 'sales';
    }
  }
  currentRoute = route;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === route));
  document.getElementById('pageTitle').textContent = ROUTES[route].title;
  const container = document.getElementById('pageContent');
  container.innerHTML = '';
  document.getElementById('sidebar').classList.remove('open');
  const mod = Modules[ROUTES[route].mod];
  if (mod && mod.render) await mod.render(container);
  window.scrollTo(0, 0);
}

async function refreshShell() {
  const box = document.getElementById('cashBox');
  if (Auth.isSeller()) { if (box) box.style.display = 'none'; return; }
  if (box) box.style.display = '';
  const bal = await Services.getCashBalance();
  document.getElementById('cashPill').textContent = Utils.formatMoney(bal);
}

function refreshRoleUI() {
  const chip = document.getElementById('roleChip');
  document.querySelectorAll('.nav-item').forEach(n => {
    n.style.display = Auth.canSee(n.dataset.route) ? '' : 'none';
  });
  if (!chip) return;
  if (!Auth.isEnabled()) { chip.style.display = 'none'; return; }
  chip.style.display = '';
  if (Auth.isOwner()) {
    chip.className = 'role-chip owner';
    chip.innerHTML = '👤 صاحب المحل — <strong>خروج</strong>';
  } else {
    chip.className = 'role-chip seller';
    chip.innerHTML = '🔒 بائع — <strong>دخول صاحب المحل</strong>';
  }
  refreshShell();
}

function updateSyncFoot() {
  const el = document.getElementById('syncFoot');
  if (!el) return;
  const s = DriveSync.getStatus();
  if (!s.signedIn) { el.textContent = 'مش متصل بالدرايف'; return; }
  if (s.error) { el.textContent = 'المزامنة: ' + s.error; return; }
  if (s.pending) { el.textContent = 'فيه شغل لسه مترفعش'; return; }
  el.textContent = s.lastSync ? ('آخر مزامنة ' + Utils.formatDateTime(s.lastSync)) : 'بيزامن...';
}

/* شاشة الدخول بجوجل — بتظهر أول مرة بس */
function showSignIn(reason) {
  return new Promise((resolve) => {
    const shell = document.querySelector('.app-shell');
    if (shell) shell.style.display = 'none';
    const overlay = document.createElement('div');
    overlay.innerHTML = `
      <div class="firstrun-wrap">
        <div class="firstrun-card">
          <div class="firstrun-mark">⚡</div>
          <h2>مؤسسة المصطفى<br>للأدوات الكهربائية والحدايد</h2>
          <p class="firstrun-lead">اربط البرنامج بجوجل درايف بتاعك عشان تشتغل من الموبايل.</p>
          <div class="firstrun-note">
            الشغل اللي هتعمله هنا بيتحفظ على الموبايل على طول، وبيروح
            للدرايف أول ما يبقى فيه نت — وكمبيوتر المحل بيسحبه لوحده.
          </div>
          ${reason ? `<div class="firstrun-err">${Utils.escapeHtml(reason)}</div>` : ''}
          <button type="button" class="btn btn-amber firstrun-btn" id="gsiBtn">دخول بحساب جوجل</button>
          <p class="firstrun-warn">
            البرنامج بيشوف بس الملفات اللي بيعملها هو في درايفك — مش بيبص
            على أي حاجة تانية عندك خالص.
          </p>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#gsiBtn').addEventListener('click', async (e) => {
      const b = e.target;
      b.disabled = true; b.textContent = 'بيفتح جوجل...';
      try {
        await Drive.signIn(false);
        overlay.remove();
        if (shell) shell.style.display = '';
        resolve(true);
      } catch (err) {
        b.disabled = false; b.textContent = 'دخول بحساب جوجل';
        const e2 = overlay.querySelector('.firstrun-err');
        const msg = err.message || 'مانفعش';
        if (e2) e2.textContent = msg;
        else b.insertAdjacentHTML('beforebegin', `<div class="firstrun-err">${Utils.escapeHtml(msg)}</div>`);
      }
    });
  });
}

document.getElementById('navList').addEventListener('click', (e) => {
  const item = e.target.closest('.nav-item');
  if (item) navigate(item.dataset.route);
});
document.getElementById('menuToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});
document.getElementById('roleChip').addEventListener('click', async () => {
  if (Auth.isOwner()) Auth.logout(false);
  else if (await Auth.loginOwner('دخول صاحب المحل')) navigate('reports');
});
document.getElementById('syncBtn').addEventListener('click', async (e) => {
  const b = e.target;
  b.disabled = true;
  // لو الإذن خلص وقته بنجدده في الخلفية قبل ما نزامن
  if (!Drive.isSignedIn() && Drive.wasConnected()) {
    try { await Drive.renewQuietly(); } catch (err) { }
  }
  const added = await DriveSync.runOnce(true);
  b.disabled = false;
  updateSyncFoot();
  const m = DriveSync.explain(added);
  Utils.toast(m.text, m.kind);
});

/* بيشوف لو فيه نسخة أحدث منشورة ويحمّلها.
   المتصفح بيمسك الملفات ١٠ دقايق (ده إعداد جيت هب ومش بإيدنا)، فكنا
   بنفضل شغالين بنسخة قديمة بعد كل تحديث. بنسأل عن رقم النسخة من غير
   تخزين مؤقت، ولو مختلف بنعيد فتح الصفحة برقم جديد فتيجي جديدة. */
async function checkForUpdate() {
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const info = await res.json();
    if (!info || !info.version || info.version === APP_VERSION) return;

    // حماية من إعادة الفتح المتكررة لو حاجة مش مظبوطة
    const tried = sessionStorage.getItem('mostafaUpdateTry');
    if (tried === info.stamp) return;
    sessionStorage.setItem('mostafaUpdateTry', info.stamp);

    location.replace(location.pathname + '?v=' + encodeURIComponent(info.stamp));
  } catch (e) { /* مفيش نت — بنكمل بالنسخة اللي عندنا */ }
}

async function init() {
  const verEl = document.getElementById('buildVer');
  if (verEl) verEl.textContent = APP_VERSION;

  checkForUpdate();

  await DB.open();

  /* البرنامج بيفتح على طول من غير ما يستنى جوجل.
     - لو الإذن لسه صالح: تمام.
     - لو خلص وقته: بنجدده في الخلفية من غير ما يظهرلك حاجة.
     - لو دي أول مرة خالص: ساعتها بس بنطلب الدخول.
     كده تدوس على الأيقونة ويفتح زي الكمبيوتر بالظبط. */
  if (!Drive.isSignedIn()) {
    if (Drive.wasConnected()) {
      try { await Drive.renewQuietly(); } catch (e) { }
    } else {
      await showSignIn(null);
    }
  }

  /* الترتيب هنا مقصود: بنجيب اللي في الدرايف الأول، وبعدين الجهاز
     ياخد رقمه. كده الموبايل بيشوف أرقام الأجهزة المستعملة فعلاً
     وياخد رقم فاضي — بدل ما ياخد رقم متكرر ويعمل فواتير بنفس
     أرقام فواتير المحل. */
  if (Drive.isSignedIn()) {
    try { await DriveSync.pullOthers(); } catch (e) { }
  }
  await Device.init();
  try { await DriveSync.runOnce(true); } catch (e) { }

  await Auth.init();
  await AppState.reloadItems();
  await AppState.reloadParties();
  await AppState.reloadCompany();
  refreshRoleUI();
  await refreshShell();

  if (Auth.isSeller()) navigate('sales');
  else if (!AppState.company || !AppState.company.name) navigate('company');
  else navigate('reports');

  DriveSync.start();
  setInterval(updateSyncFoot, 3000);
  updateSyncFoot();
}

init();
