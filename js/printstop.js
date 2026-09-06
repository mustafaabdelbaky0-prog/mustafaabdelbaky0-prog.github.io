/* وقف الطباعة

   المشكلة: البرنامج بيطبع صامت (من غير نافذة الطباعة) عشان الملصق
   يخرج على طول من غير لخبطة. الحلو في ده إنه سريع، الوحش إن مفيش
   زرار "إلغاء" — لو دوس ١٠٠ ملصق بالغلط، مفيش قدامه غير إنه يطفي
   الطابعة ويشيل الرول.

   الحل: أول ما الطباعة تبدأ بيظهر شريط أحمر فيه زرار "وقف الطباعة".
   الزرار بيكلّم السيرفر، والسيرفر بيمسح أوامر الطباعة المنتظرة في
   الويندوز.

   مهم يعرفه: الورق اللي دخل الطابعة خلاص بيخرج — الطابعة عندها
   ذاكرة صغيرة جواها. اللي بيقف هو الباقي، وده الجزء الكبير. */

const PrintStop = (() => {

  const SHOW_MS = 45000;    // الشريط بيفضل ظاهر ٤٥ ثانية بعد الطباعة
  let bar = null, hideTimer = null, pollTimer = null;

  // البرنامج على الموبايل/الويب مالوش سيرفر — الزرار مالوش لازمة هناك
  function hasServer() {
    return typeof DB !== 'undefined' && location.protocol.indexOf('http') === 0;
  }

  function build() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'print-stop';
    bar.hidden = true;
    bar.innerHTML = `
      <div class="ps-text">
        <strong id="psTitle">بيطبع...</strong>
        <span class="ps-sub" id="psSub"></span>
      </div>
      <button type="button" class="btn btn-danger" id="psStop">🛑 وقف الطباعة</button>
      <button type="button" class="icon-btn" id="psClose" title="إخفاء">✕</button>`;
    document.body.appendChild(bar);

    bar.querySelector('#psStop').addEventListener('click', stopNow);
    bar.querySelector('#psClose').addEventListener('click', hide);
    return bar;
  }

  function hide() {
    clearTimeout(hideTimer); clearInterval(pollTimer);
    if (bar) bar.hidden = true;
  }

  async function jobs() {
    try {
      const r = await fetch('/api/print/jobs', { cache: 'no-store' });
      if (!r.ok) return null;
      const d = await r.json();
      return Array.isArray(d.jobs) ? d.jobs : [];
    } catch (e) { return null; }
  }

  /* أمر عالق: الطابعة نفسها واقفة (مطفية أو الورق خلص) فويندوز
     مش قادر يمسحه. الحل إنه يشغّل الطابعة — ساعتها بيتلغي لوحده. */
  function stuck(list) {
    return (list || []).filter(j =>
      String(j.printerStatus || '') === 'Error' ||
      String(j.printerStatus || '') === 'Offline' ||
      String(j.status || '').indexOf('Deleting') >= 0);
  }

  /* بنحدّث الشريط بعدد الورق اللي لسه ما اتطبعش — عشان يشوف
     إن الوقف نفع فعلاً */
  async function refresh() {
    const list = await jobs();
    if (!bar || bar.hidden) return;
    const sub = bar.querySelector('#psSub');
    if (list === null) { sub.textContent = ''; return; }
    if (!list.length) {
      bar.querySelector('#psTitle').textContent = 'الطباعة خلصت';
      sub.textContent = 'مفيش ورق منتظر في الطابعة';
      clearInterval(pollTimer);
      hideTimer = setTimeout(hide, 4000);
      return;
    }
    const pages = list.reduce((s, j) => s + (Number(j.pages) || 0), 0);
    const done = list.reduce((s, j) => s + (Number(j.printed) || 0), 0);
    const left = Math.max(0, pages - done);
    sub.textContent = left > 0
      ? `لسه ${left} ورقة من ${pages} — دوس وقف لو دي غلط`
      : `${pages} ورقة في الطابعة`;
  }

  async function stopNow() {
    const btn = bar && bar.querySelector('#psStop');
    if (btn) { btn.disabled = true; btn.textContent = 'بيوقف...'; }
    let n = 0, ok = false;
    try {
      const r = await fetch('/api/print/cancel', { method: 'POST' });
      if (r.ok) { const d = await r.json(); n = Number(d.cancelled) || 0; ok = true; }
    } catch (e) { }
    if (btn) { btn.disabled = false; btn.textContent = '🛑 وقف الطباعة'; }

    if (!ok) {
      Utils.toast('مقدرناش نوصل للطابعة — اطفيها وشغّلها تاني', 'error');
      return;
    }
    // نشوف فضل إيه — ممكن يكون فيه أمر عالق لأن الطابعة نفسها واقفة
    const left = await jobs();
    const bad = stuck(left);
    if (bad.length) {
      bar.querySelector('#psTitle').textContent = 'الطابعة نفسها واقفة';
      bar.querySelector('#psSub').textContent =
        'الورق مش بيتلغي لأن الطابعة مطفية أو الورق خلص — شغّلها وهيتلغي لوحده';
      Utils.beep('error');
    } else {
      bar.querySelector('#psTitle').textContent = n > 0 ? 'الطباعة وقفت' : 'مفيش حاجة تتوقف';
      bar.querySelector('#psSub').textContent = n > 0
        ? 'الورق اللي كان داخل الطابعة هيخرج، والباقي وقف'
        : 'الطابعة خلّصت الورق كله خلاص';
      Utils.beep(n > 0 ? 'ok' : 'error');
    }
    clearInterval(pollTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, bad.length ? 12000 : 6000);
  }

  /* بننده دي بعد ما نبعت الطباعة. count = عدد الورق المتوقع */
  function watch(count, what) {
    if (!hasServer()) return;
    build();
    clearTimeout(hideTimer); clearInterval(pollTimer);
    bar.hidden = false;
    bar.querySelector('#psStop').disabled = false;
    bar.querySelector('#psStop').textContent = '🛑 وقف الطباعة';
    bar.querySelector('#psTitle').textContent =
      count > 0 ? `بيطبع ${count} ${what || 'ورقة'}` : 'بيطبع...';
    bar.querySelector('#psSub').textContent = 'لو دي غلط دوس وقف على طول';
    refresh();
    pollTimer = setInterval(refresh, 1500);
    hideTimer = setTimeout(hide, SHOW_MS);
  }

  return { watch, stopNow, hide, jobs };
})();
