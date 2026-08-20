/* مسح الباركود بالكاميرا

   فيه طريقتين:
   1) مسح مباشر بالكاميرا - بيشتغل بس لو الصفحة على localhost أو HTTPS
      (المتصفحات بتمنع الكاميرا على http العادي لأسباب أمنية)
   2) تصوير الباركود - بيفتح كاميرا الموبايل العادية وياخد صورة وبنفك الرقم منها
      دي بتشتغل في كل الحالات، وهي اللي هتشتغل على الموبايل

   بنختار الطريقة تلقائيًا حسب اللي متاح. */

const Scanner = (() => {

  function canUseLiveCamera() {
    return !!(window.isSecureContext &&
              navigator.mediaDevices &&
              navigator.mediaDevices.getUserMedia);
  }

  function zxingReader() {
    // ZXing بتيجي من ملف محلي - البرنامج بيفضل شغال من غير إنترنت
    const hints = new Map();
    const formats = [
      ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.ITF, ZXing.BarcodeFormat.CODABAR,
      ZXing.BarcodeFormat.QR_CODE
    ];
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    return new ZXing.BrowserMultiFormatReader(hints);
  }

  // ---------- الطريقة ٢: تصوير ----------
  function scanByPhoto() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.setAttribute('capture', 'environment'); // يفتح الكاميرا الخلفية على طول
      input.style.display = 'none';
      document.body.appendChild(input);

      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) { resolve(null); return; }

        const url = URL.createObjectURL(file);
        const closeLoading = showLoading('بنقرا الباركود من الصورة...');
        try {
          const reader = zxingReader();
          const result = await reader.decodeFromImageUrl(url);
          closeLoading();
          resolve(result.getText());
        } catch (e) {
          closeLoading();
          Utils.toast('الباركود مش واضح في الصورة — قرّب الكاميرا وثبّت إيدك وجرب تاني', 'error');
          resolve(null);
        } finally {
          URL.revokeObjectURL(url);
        }
      });

      // لو قفل الكاميرا من غير ما يصوّر
      input.addEventListener('cancel', () => { input.remove(); resolve(null); });
      input.click();
    });
  }

  function showLoading(text) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="width:auto;padding:26px 34px;text-align:center;">
        <div style="font-size:30px;margin-bottom:10px;">📷</div>
        <div style="font-weight:700;">${Utils.escapeHtml(text)}</div>
      </div>`;
    document.body.appendChild(overlay);
    return () => overlay.remove();
  }

  // ---------- الطريقة ١: مسح مباشر ----------
  function scanLive() {
    return new Promise((resolve) => {
      let stream = null;
      let stopped = false;
      let rafId = null;

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" style="width:520px;max-width:100%;">
          <div class="modal-head">
            <h3>وجّه الكاميرا على الباركود</h3>
            <button class="modal-close" type="button">&times;</button>
          </div>
          <div class="modal-body" style="padding:0;">
            <div class="scan-stage">
              <video id="scanVideo" playsinline muted></video>
              <div class="scan-frame"></div>
            </div>
            <div style="padding:14px 18px;">
              <div class="hint" style="margin:0 0 12px;">خلي الباركود جوه الإطار الأحمر</div>
              <button class="btn btn-ghost btn-block" id="usePhotoInstead">مش راضي يقرا؟ صوّره بدل كده</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const video = overlay.querySelector('#scanVideo');

      function cleanup() {
        if (stopped) return;
        stopped = true;
        if (rafId) cancelAnimationFrame(rafId);
        if (stream) stream.getTracks().forEach(t => t.stop());
        overlay.remove();
      }

      overlay.querySelector('.modal-close').addEventListener('click', () => { cleanup(); resolve(null); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { cleanup(); resolve(null); } });
      overlay.querySelector('#usePhotoInstead').addEventListener('click', async () => {
        cleanup();
        resolve(await scanByPhoto());
      });

      (async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } }, audio: false
          });
          video.srcObject = stream;
          await video.play();

          // نستخدم قارئ المتصفح الجاهز لو موجود (أسرع وأدق)، وإلا ZXing
          let detector = null;
          if ('BarcodeDetector' in window) {
            try { detector = new window.BarcodeDetector(); } catch (e) { detector = null; }
          }
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const reader = detector ? null : zxingReader();

          const tick = async () => {
            if (stopped) return;
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
              try {
                let text = null;
                if (detector) {
                  const codes = await detector.detect(video);
                  if (codes && codes.length) text = codes[0].rawValue;
                } else {
                  canvas.width = video.videoWidth;
                  canvas.height = video.videoHeight;
                  ctx.drawImage(video, 0, 0);
                  try {
                    const r = reader.decodeFromCanvas(canvas);
                    if (r) text = r.getText();
                  } catch (e) { /* مفيش باركود في الفريم ده */ }
                }
                if (text) {
                  cleanup();
                  resolve(text);
                  return;
                }
              } catch (e) { /* نكمل محاولة */ }
            }
            rafId = requestAnimationFrame(tick);
          };
          tick();
        } catch (e) {
          cleanup();
          Utils.toast('مقدرناش نفتح الكاميرا — هنجرب بالتصوير', 'error');
          resolve(await scanByPhoto());
        }
      })();
    });
  }

  // ---------- الواجهة اللي بيستخدمها باقي البرنامج ----------
  async function scan() {
    if (typeof ZXing === 'undefined') {
      Utils.toast('مكتبة قراءة الباركود مش محمّلة', 'error');
      return null;
    }
    return canUseLiveCamera() ? scanLive() : scanByPhoto();
  }

  // زرار الكاميرا الجاهز - بيتحط جنب أي خانة
  function buttonHtml(id, title) {
    return `<button type="button" class="btn btn-ghost scan-btn" id="${id}" title="${title || 'مسح الباركود بالكاميرا'}">📷</button>`;
  }

  // ============ جهاز الليزر (USB) ============
  // الجهاز ده بيشتغل زي كيبورد: بيكتب أرقام الباركود بسرعة جدًا وبعدين Enter.
  // المشكلة إن المستخدم بيبص على البضاعة مش على الشاشة، فلو التركيز راح من خانة
  // البحث (مثلًا بعد ما دوس على زرار) المسح بيضيع. عشان كده بنمسك الضغطات على
  // مستوى الصفحة كلها ونرجّعها لخانة البحث تلقائيًا.
  // مهم: لازم يبقى فيه مستقبِل واحد بس في نفس الوقت.
  // من غير كده، لما تسيب شاشة المشتريات وتروح للبيع، مستقبِل المشتريات
  // بيفضل شغال ويشتغل على شاشة البيع بالغلط.
  let activeDetach = null;

  /* ماسك الليزر — بنعرفه من سرعة الكتابة مش من مكان التركيز.

     الطريقة القديمة كانت بتشتغل بس لو التركيز في خانة معيّنة. وده كان
     بيفشل بعد أول مسح، لأن البرنامج بينقل التركيز لخانة الكمية —
     فالمسح اللي بعده كان بيتكتب في الخانة زي ما هو، والصنف مايتعرفش
     إلا لما التركيز يسيبها (يعني مع المسح اللي بعده). النتيجة إن كل
     صنف كان بيظهر متأخر بواحد.

     دلوقتي: الليزر بيكتب أسرع بكتير من أي إنسان، فبنقيس السرعة.
     كل مسح بيقفل عند Enter — يعني المسح اللي بعده بيبتدي من جديد
     حتى لو جه بعده على طول. ولما نتأكد إنه ليزر بنرجّع الخانة اللي
     كتب فيها لحالتها الأولى عشان مايسيبش أرقام في مكان غلط.

     ومهم: بنمسك الضغطة قبل ما توصل للخانة نفسها (capture) وبنوقفها،
     عشان خانة الباركود ماتحاولش تدوّر على الصنف مرتين. */
  function attachHardwareScanner(inputEl, onScan) {
    if (activeDetach) { activeDetach(); activeDetach = null; }

    const FAST_MS = 40;        // أقصى وقت بين حرفين عشان يتحسب ليزر
    const NEW_BURST_MS = 400;  // سكوت أطول من كده = مسح جديد
    const MIN_LEN = 3;

    let buffer = '';
    let lastTime = 0;
    let fastHits = 0;
    let burstOpen = false;
    let burstTarget = null;
    let burstValue = '';

    function startBurst(e) {
      buffer = '';
      fastHits = 0;
      burstOpen = true;
      const t = e.target;
      burstTarget = (t && typeof t.value === 'string') ? t : null;
      burstValue = burstTarget ? burstTarget.value : '';
    }

    function endBurst() {
      buffer = '';
      fastHits = 0;
      burstOpen = false;
      burstTarget = null;
      burstValue = '';
    }

    // نرجّع الخانة لحالتها قبل المسح، ونبلّغ البرنامج بالتغيير
    function restoreTarget() {
      if (!burstTarget || typeof burstTarget.value !== 'string') return;
      if (burstTarget.value === burstValue) return;
      burstTarget.value = burstValue;
      try { burstTarget.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) { }
    }

    function handler(e) {
      // النوافذ المنبثقة (كلمة السر مثلاً) ليها كلامها
      if (document.querySelector('.modal-overlay')) { endBurst(); return; }
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const now = Date.now();
      const gap = now - lastTime;

      if (e.key === 'Enter') {
        const code = buffer.trim();
        // لازم أغلب الحروف تكون جت بسرعة الليزر
        const looksScanned = burstOpen && code.length >= MIN_LEN &&
                             fastHits >= Math.floor(code.length * 0.6);
        lastTime = now;

        if (looksScanned) {
          e.preventDefault();
          e.stopPropagation();   // الخانة نفسها ماتشوفش الـ Enter ده
          restoreTarget();
          endBurst();
          onScan(code);
        } else {
          endBurst();
        }
        return;
      }

      if (e.key.length === 1) {
        if (!burstOpen || gap > NEW_BURST_MS) startBurst(e);
        else if (gap <= FAST_MS) fastHits++;
        buffer += e.key;
        lastTime = now;
        return;
      }
      lastTime = now;
    }

    document.addEventListener('keydown', handler, true);
    activeDetach = () => {
      document.removeEventListener('keydown', handler, true);
      if (activeDetach) activeDetach = null;
    };
    return activeDetach;
  }

  return { scan, buttonHtml, canUseLiveCamera, attachHardwareScanner };
})();
