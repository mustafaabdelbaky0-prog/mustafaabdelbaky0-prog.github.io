/* استوديو صور المنتجات.

   صاحب المحل بيصوّر بالموبايل على الترابيزة: الصورة بتطلع مايلة،
   فيها نص المحل، الإضاءة صفرا، وكل صورة بمقاس. لو رفعناها كده
   الموقع بيبقى شكله مبهدل.

   الملف ده بيعمل اللي المصوّر بيعمله بالظبط، جوه المتصفح ومن غير
   نت ولا برامج: يقصّ حوالين المنتج، ينضّف الخلفية ويخليها بيضا،
   يظبط الإضاءة، ويطلّع كل الصور بنفس المقاس المربع — فالموقع كله
   بيبقى على نسق واحد.

   قاعدة مهمة: إحنا بننضّف الخلفية والإضاءة بس. المنتج نفسه — لونه
   وشكله وحجمه بالنسبة لنفسه — مبنلمسوش. الزبون لازم يستلم اللي شافه.

   الخلفية بتتشال بطريقة بسيطة ومفهومة: بنبص على حواف الصورة، نعرف
   لون الخلفية، وبنمشي من الحواف لجوه طول ما اللون قريب منه. يعني
   لو صوّر على ورقة بيضا أو حيطة سادة هتتشال تمام. لو الخلفية فيها
   رخام أو حاجات، بيقفل الزرار ويستعمل القص والإضاءة بس. */
const Photo = (() => {

  const OUT = 1000;          // الصورة الناتجة: مربع ١٠٠٠×١٠٠٠
  const WORK = 900;          // بنشتغل على نسخة أصغر عشان السرعة
  const MARGIN = 0.08;       // فراغ حوالين المنتج

  // ---------- أدوات ----------
  function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* صور الموبايل بتبقى جواها علامة "الصورة دي مقلوبة كذا درجة".
     from-image بتخلي المتصفح يظبطها لوحده قبل ما نشتغل عليها. */
  async function loadImage(file) {
    // ممكن يتبعتلنا كانفس جاهزة (الاختبارات، أو صورة اتعدّلت قبل كده)
    if (file && (file.getContext || typeof ImageBitmap !== 'undefined' && file instanceof ImageBitmap)) return file;
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      return await new Promise((res, rej) => {
        const im = new Image();
        const u = URL.createObjectURL(file);
        im.onload = () => { URL.revokeObjectURL(u); res(im); };
        im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('الصورة مش مقروءة')); };
        im.src = u;
      });
    }
  }

  // بنصغّر الصورة للشغل عليها (الأصل ممكن يكون ١٢ ميجابكسل)
  function toWork(img) {
    const scale = Math.min(1, WORK / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = canvasOf(w, h);
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  }

  // لون الخلفية = الوسيط بتاع بكسلات الحواف (الوسيط مش المتوسط عشان
  // لو ركن الصورة فيه حاجة غريبة ما تلخبطش الحسبة)
  function edgeColor(data, w, h) {
    const R = [], G = [], B = [];
    const push = (x, y) => {
      const i = (y * w + x) * 4;
      R.push(data[i]); G.push(data[i + 1]); B.push(data[i + 2]);
    };
    const step = Math.max(1, Math.round(Math.min(w, h) / 120));
    for (let x = 0; x < w; x += step) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y += step) { push(0, y); push(w - 1, y); }
    const mid = a => { a.sort((p, q) => p - q); return a[Math.floor(a.length / 2)] || 255; };
    return { r: mid(R), g: mid(G), b: mid(B) };
  }

  /* قناع الخلفية: بنبدأ من كل بكسل على الحافة ونمشي لجوه طول ما
     اللون قريب من لون الخلفية. اللي ما نوصلهوش = المنتج. */
  function bgMask(data, w, h, bg, tol) {
    const mask = new Uint8Array(w * h);      // 1 = خلفية
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let sp = 0;
    const near = (i) => {
      const d = Math.abs(data[i * 4] - bg.r) + Math.abs(data[i * 4 + 1] - bg.g) + Math.abs(data[i * 4 + 2] - bg.b);
      return d <= tol * 3;
    };
    const seed = (i) => { if (!seen[i] && near(i)) { seen[i] = 1; stack[sp++] = i; } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (sp > 0) {
      const i = stack[--sp];
      mask[i] = 1;
      const x = i % w, y = (i / w) | 0;
      if (x > 0) seed(i - 1);
      if (x < w - 1) seed(i + 1);
      if (y > 0) seed(i - w);
      if (y < h - 1) seed(i + w);
    }
    return mask;
  }

  // بنوسّع القناع شوية عشان الهالة الفاتحة حوالين المنتج تختفي
  function grow(mask, w, h, times) {
    let m = mask;
    for (let t = 0; t < times; t++) {
      const n = new Uint8Array(m);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (m[i]) continue;
          if (m[i - 1] && m[i + 1] && m[i - w] && m[i + w]) n[i] = 1;   // محاصر = خلفية
        }
      }
      m = n;
    }
    return m;
  }

  // حدود المنتج (أصغر مستطيل حواليه)
  function boxOf(mask, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return { x: 0, y: 0, w, h, empty: true };
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, empty: false };
  }

  /* ظبط الإضاءة: بنمد الفاتح لفاتح والغامق لغامق شوية عشان الصورة
     ما تبقاش "مغسولة". بنحسب على المنتج نفسه مش على الخلفية. */
  function levels(data, mask, w, h, amount) {
    if (amount <= 0) return;
    const hist = new Uint32Array(256);
    let n = 0;
    for (let i = 0; i < w * h; i++) {
      if (mask && mask[i]) continue;
      const l = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000 | 0;
      hist[l]++; n++;
    }
    if (n < 50) return;
    const at = (p) => {
      let acc = 0, want = n * p;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= want) return v; }
      return 255;
    };
    let lo = at(0.01), hi = at(0.99);
    if (hi - lo < 25) return;                       // الصورة أصلاً مظبوطة
    lo = lo * amount; hi = 255 - (255 - hi) * amount;
    const scale = 255 / Math.max(1, hi - lo);
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.max(0, Math.min(255, Math.round((v - lo) * scale)));
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = lut[data[i * 4]];
      data[i * 4 + 1] = lut[data[i * 4 + 1]];
      data[i * 4 + 2] = lut[data[i * 4 + 2]];
    }
  }

  /* قوة التنضيف المناسبة بتفرق من صورة لصورة: منتج غامق على ورقة
     بيضا بيحتاج قوة عالية، ومنتج فاتح على ورقة بيضا لو زوّدنا القوة
     المنتج نفسه بيتاكل. فبنجرّب كذا قيمة ونختار أكبر واحدة لسه
     سايبة المنتج موجود — من غير ما المستخدم يفهم في الكلام ده. */
  function autoTol(work) {
    const w = work.width, h = work.height;
    const data = work.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const bg = edgeColor(data, w, h);
    const tries = [10, 14, 18, 24, 30, 38, 48, 60, 75];
    let best = 24, bestCov = 0;
    for (const t of tries) {
      const m = bgMask(data, w, h, bg, t);
      let cov = 0;
      for (let i = 0; i < m.length; i++) cov += m[i];
      cov /= (w * h);
      if (cov > 0.94) break;               // بدأ ياكل المنتج — نقف عند اللي قبله
      if (cov > bestCov) { bestCov = cov; best = t; }
    }
    return { tol: best, cover: bestCov };
  }

  /* الناتج: مربع أبيض، المنتج في النص، بنفس الفراغ في كل الصور. */
  function compose(work, opt) {
    const w = work.width, h = work.height;
    const wctx = work.getContext('2d', { willReadFrequently: true });
    const img = wctx.getImageData(0, 0, w, h);
    const data = img.data;

    let mask = null, box = { x: 0, y: 0, w, h, empty: false };
    if (opt.clean) {
      const bg = edgeColor(data, w, h);
      mask = grow(bgMask(data, w, h, bg, opt.tol), w, h, 1);
      box = boxOf(mask, w, h);
      // لو القناع بلع الصورة كلها أو مبلعش حاجة، يبقى الخلفية مش سادة
      const covered = mask.reduce((a, v) => a + v, 0) / (w * h);
      if (covered > 0.97 || covered < 0.04) { mask = null; box = { x: 0, y: 0, w, h, empty: false }; }
    }
    if (opt.light > 0) levels(data, mask, w, h, opt.light);

    // بنحط شفافية على الخلفية عشان حوافها تطلع ناعمة مع الأبيض
    if (mask) {
      for (let i = 0; i < w * h; i++) if (mask[i]) data[i * 4 + 3] = 0;
    }
    const cut = canvasOf(w, h);
    cut.getContext('2d').putImageData(img, 0, 0);

    // القص: حوالين المنتج + فراغ، ومربع
    let bx = box.x, by = box.y, bw = box.w, bh = box.h;
    if (!opt.crop) { bx = 0; by = 0; bw = w; bh = h; }
    const side = Math.max(bw, bh) * (1 + MARGIN * 2);
    const cx = bx + bw / 2, cy = by + bh / 2;

    const out = canvasOf(OUT, OUT);
    const octx = out.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, OUT, OUT);

    // مركز المنتج يقع في نص المربع بالظبط
    const k = OUT / side;
    const dw = w * k, dh = h * k;
    const px = OUT / 2 - cx * k;
    const py = OUT / 2 - cy * k;

    if (opt.shadow && mask) {
      // ظل خفيف تحت المنتج — زي أي صورة منتج، بيدي إحساس إنه واقف
      const sy = py + (by + bh) * k;
      const sw = bw * k * 0.78, sh = Math.max(8, bh * k * 0.07);
      const g = octx.createRadialGradient(OUT / 2, sy, 0, OUT / 2, sy, sw / 2);
      g.addColorStop(0, 'rgba(0,0,0,.22)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      octx.save();
      octx.translate(OUT / 2, Math.min(OUT - sh, sy));
      octx.scale(1, sh / (sw / 2) * 1.6);
      octx.translate(-OUT / 2, -Math.min(OUT - sh, sy));
      octx.fillStyle = g;
      octx.beginPath();
      octx.arc(OUT / 2, Math.min(OUT - sh, sy), sw / 2, 0, Math.PI * 2);
      octx.fill();
      octx.restore();
    }

    octx.imageSmoothingQuality = 'high';
    octx.drawImage(cut, px, py, dw, dh);
    return { canvas: out, box, masked: !!mask, dw, dh, px, py };
  }

  function toB64(canvas, q) {
    return canvas.toDataURL('image/jpeg', q || 0.86).split(',')[1];
  }

  // ---------- الشاشة ----------
  /* بيفتح الاستوديو على صورة. بيرجّع الصورة جاهزة (base64) لما يدوس
     "استعمل الصورة"، أو null لو قفل من غير ما ياخدها. */
  async function open(file) {
    let work;
    try {
      const img = await loadImage(file);
      work = toWork(img);
    } catch (e) {
      Utils.toast(e.message || 'مقدرناش نفتح الصورة', 'error');
      return null;
    }
    return new Promise((resolve) => openStudio(work, resolve));
  }

  function openStudio(work, resolve) {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };

    const auto = autoTol(work);
    const st = { clean: true, tol: auto.tol, light: 0.75, crop: true, shadow: true };
    let src = work;

    const { close, overlay } = Utils.openModal({
      title: '📸 استوديو الصور',
      wide: true,
      bodyHtml: `
        <div class="ph-wrap">
          <div class="ph-view">
            <canvas id="phCv" width="${OUT}" height="${OUT}"></canvas>
            <div class="ph-badge" id="phBadge"></div>
            <button type="button" class="btn btn-ghost btn-sm ph-before" id="phBefore">اضغط مطوّل تشوف الأصلية</button>
          </div>
          <div class="ph-side">
            <label class="ph-sw"><input type="checkbox" id="phClean" checked> نضّف الخلفية وخليها بيضا</label>
            <div class="ph-row" id="phTolRow">
              <span>قوة التنضيف</span>
              <input type="range" id="phTol" min="10" max="90" value="${auto.tol}">
            </div>
            <div class="hint" id="phWarn" hidden></div>

            <label class="ph-sw"><input type="checkbox" id="phCrop" checked> قصّ حوالين المنتج</label>
            <label class="ph-sw"><input type="checkbox" id="phShadow" checked> ظل خفيف تحته</label>
            <div class="ph-row">
              <span>ظبط الإضاءة</span>
              <input type="range" id="phLight" min="0" max="100" value="75">
            </div>
            <button type="button" class="btn btn-ghost btn-sm" id="phRot">↻ لفّها ٩٠°</button>

            <div class="ph-tips">
              <strong>عشان الصورة تطلع أحلى:</strong>
              <ul>
                <li>حط المنتج على <b>ورقة بيضا</b> أو حتة سادة</li>
                <li>صوّر جنب الشباك بالنهار — <b>من غير فلاش</b></li>
                <li>خلي الموبايل فوق المنتج مستوي، ومتقربش أوي</li>
                <li>سيب فراغ حوالين المنتج، إحنا هنقصّه</li>
              </ul>
            </div>

            <div class="form-actions" style="margin-top:14px;">
              <button type="button" class="btn btn-ghost" id="phCancel">إلغاء</button>
              <button type="button" class="btn btn-amber" id="phOk">استعمل الصورة</button>
            </div>
          </div>
        </div>`,
      onMount: (mb, closeMe) => {
        const cv = mb.querySelector('#phCv');
        const ctx = cv.getContext('2d');
        const badge = mb.querySelector('#phBadge');
        const warn = mb.querySelector('#phWarn');
        let last = null, busy = false, again = false;

        const draw = () => {
          if (busy) { again = true; return; }
          busy = true;
          setTimeout(() => {
            try {
              const r = compose(src, st);
              last = r;
              ctx.clearRect(0, 0, OUT, OUT);
              ctx.drawImage(r.canvas, 0, 0);
              badge.textContent = OUT + '×' + OUT;
              const on = mb.querySelector('#phClean').checked;
              warn.hidden = !(on && !r.masked);
              if (on && !r.masked) {
                warn.textContent = 'الخلفية مش سادة كفاية فما اتشالتش — حرّك «قوة التنضيف» يمين وشمال، أو صوّرها على ورقة بيضا سادة.';
              }
            } catch (e) { Utils.toast('مشكلة في معالجة الصورة', 'error'); }
            busy = false;
            if (again) { again = false; draw(); }
          }, 0);
        };

        const sync = () => {
          st.clean = mb.querySelector('#phClean').checked;
          st.tol = Number(mb.querySelector('#phTol').value);
          st.light = Number(mb.querySelector('#phLight').value) / 100;
          st.crop = mb.querySelector('#phCrop').checked;
          st.shadow = mb.querySelector('#phShadow').checked;
          mb.querySelector('#phTolRow').style.opacity = st.clean ? '' : '.4';
          draw();
        };
        ['phClean', 'phCrop', 'phShadow'].forEach(id =>
          mb.querySelector('#' + id).addEventListener('change', sync));
        ['phTol', 'phLight'].forEach(id =>
          mb.querySelector('#' + id).addEventListener('input', sync));

        mb.querySelector('#phRot').addEventListener('click', () => {
          const c = canvasOf(src.height, src.width);
          const x = c.getContext('2d');
          x.translate(c.width / 2, c.height / 2);
          x.rotate(Math.PI / 2);
          x.drawImage(src, -src.width / 2, -src.height / 2);
          src = c;
          draw();
        });

        // ضغطة مطوّلة = الصورة زي ما هي قبل أي تعديل
        const bb = mb.querySelector('#phBefore');
        const showRaw = () => { ctx.clearRect(0, 0, OUT, OUT); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, OUT, OUT);
          const k = Math.min(OUT / src.width, OUT / src.height);
          ctx.drawImage(src, (OUT - src.width * k) / 2, (OUT - src.height * k) / 2, src.width * k, src.height * k); };
        const back = () => { if (last) { ctx.clearRect(0, 0, OUT, OUT); ctx.drawImage(last.canvas, 0, 0); } };
        ['mousedown', 'touchstart'].forEach(e => bb.addEventListener(e, showRaw));
        ['mouseup', 'mouseleave', 'touchend'].forEach(e => bb.addEventListener(e, back));

        mb.querySelector('#phCancel').addEventListener('click', closeMe);
        mb.querySelector('#phOk').addEventListener('click', () => {
          if (!last) return;
          const b64 = toB64(last.canvas, 0.86);
          settle(b64);
          closeMe();
        });

        draw();
      }
    });

    /* لو قفل النافذة بالـ × أو بالضغط برّه أو Esc، لازم اللي مستنينا
       يعرف إنه ما اختارش صورة — وإلا الرفع بيفضل مستني للأبد. */
    const watch = new MutationObserver(() => {
      if (!document.body.contains(overlay)) { watch.disconnect(); settle(null); }
    });
    watch.observe(document.body, { childList: true });
  }

  return { open, _compose: compose, _bgMask: bgMask, _edgeColor: edgeColor, _boxOf: boxOf, OUT };
})();
