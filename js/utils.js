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

  // توليد باركود داخلي للأصناف اللي مالهاش باركود مطبوع
  function genInternalBarcode() {
    return '2' + Date.now().toString().slice(-11);
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

  return {
    formatMoney, formatDate, formatDateTime, todayISO, nowISO, dateKey,
    genInternalBarcode, debounce, el, escapeHtml,
    beep, toast, openModal, confirmDialog
  };
})();
