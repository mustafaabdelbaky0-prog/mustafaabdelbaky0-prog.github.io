/* استوديو صور المنتجات.

   صاحب المحل بيصوّر بالموبايل وهو ماسك المنتج بإيده، والخلفية بلاط
   أو رفوف. مفيش حاجة أوتوماتيك هتعرف تفرّق بين إيده والمنتج — فالأداة
   هنا زي الأستيكة بالظبط: بيمسح بإيده اللي مش عايزه، ويختار لون
   الخلفية اللي يعجبه.

   إزاي بتشتغل من جوه:
   - عندنا صورتين فوق بعض: الصورة الأصلية، و"قناع" بيقول أنهي جزء
     لسه ظاهر. المسح بيشيل من القناع، والرجوع بيرجّع فيه.
   - العصا السحرية بتمسح منطقة كاملة قريبة في اللون من اللي دوس عليها
     (بلاط، حيطة، ورقة) بدوسة واحدة.
   - في الآخر بنقص حوالين اللي فضل، ونحطه في نص مربع بلون الخلفية
     اللي اختاره — فكل الصور بتطلع بنفس المقاس والشكل.

   قاعدة مهمة: المنتج نفسه مبنلمسوش. بنشيل اللي حواليه ونظبط
   الإضاءة بس. الزبون لازم يستلم اللي شافه. */
const Photo = (() => {

  const OUT = 1000;          // الصورة الناتجة: مربع ١٠٠٠×١٠٠٠
  const WORK = 820;          // بنشتغل على نسخة أصغر عشان السرعة
  const MARGIN = 0.08;       // فراغ حوالين المنتج
  const UNDO_MAX = 14;

  const BGS = [
    { id: 'white', name: 'أبيض', c: '#ffffff' },
    { id: 'soft', name: 'رمادي فاتح', c: '#F2F2F0' },
    { id: 'warm', name: 'بيج', c: '#FBF3EC' },
    { id: 'brand', name: 'برتقالي فاتح', c: '#FFF0E8' },
    { id: 'dark', name: 'أسود', c: '#141414' }
  ];

  function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* أيقونات مرسومة بالكود مش رموز جاهزة — الرموز الجديدة مش موجودة
     في خطوط ويندوز كلها وكانت بتطلع مربعات فاضية. */
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    erase: svg('<path d="M7 20h12"/><path d="M15.5 4.5 20 9 11 18H6.5L4 15.5z"/><path d="M10.5 9.5 15 14"/>'),
    wand: svg('<path d="M5 19 16 8"/><path d="M14 6l4 4"/><path d="M18 3v3M21 5h-3M6 4v2M7 5H5M19 15v2M20 16h-2"/>'),
    back: svg('<path d="M4 13a8 8 0 1 0 2.3-5.6"/><path d="M4 4v5h5"/>'),
    undo: svg('<path d="M3 7h11a5 5 0 0 1 0 10H8"/><path d="M6 4 3 7l3 3"/>')
  };

  /* صور الموبايل جواها علامة "مقلوبة كذا درجة" — المتصفح بيظبطها */
  async function loadImage(file) {
    if (file && (file.getContext || (typeof ImageBitmap !== 'undefined' && file instanceof ImageBitmap))) return file;
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

  function toWork(img) {
    const scale = Math.min(1, WORK / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = canvasOf(w, h);
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  }

  /* العصا السحرية: من النقطة اللي دوس عليها بنمشي في كل اتجاه طول ما
     اللون قريب. بترجّع قناع بالمنطقة دي عشان نشيلها. */
  function wandRegion(src, x0, y0, tol) {
    const w = src.width, h = src.height;
    const d = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const start = (y0 * w + x0) * 4;
    const r0 = d[start], g0 = d[start + 1], b0 = d[start + 2];
    const seen = new Uint8Array(w * h);
    const out = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let sp = 0;
    const push = (i) => {
      if (seen[i]) return;
      const k = i * 4;
      if (Math.abs(d[k] - r0) + Math.abs(d[k + 1] - g0) + Math.abs(d[k + 2] - b0) > tol * 3) return;
      seen[i] = 1; stack[sp++] = i;
    };
    push(y0 * w + x0);
    while (sp > 0) {
      const i = stack[--sp];
      out[i] = 1;
      const x = i % w, y = (i / w) | 0;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
    }
    return out;
  }

  // بنحوّل منطقة لقناع نقدر نرسم بيه
  function regionToCanvas(region, w, h) {
    const c = canvasOf(w, h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) if (region[i]) img.data[i * 4 + 3] = 255;
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /* الخلفية السادة (ورقة بيضا مثلاً): بنمشي من حواف الصورة لجوه.
     بتشتغل كبداية بس لو الصورة فعلاً مصوّرة على خلفية سادة. */
  /* لون الخلفية = اللون الأكتر تكرارًا على حواف الصورة.

     كان بيتحسب وسيط كل لون لوحده (أحمر لوحده، أخضر لوحده) — وده كان
     بيطلّع لون مش موجود في الصورة أصلاً. مع بلاط بلونين، الوسيط كان
     بيقع بينهم فالاتنين يبقوا "قريبين من الخلفية" والبرنامج يفتكر
     الخلفية سادة ويشيلها كلها غلط. دلوقتي بنجيب لون حقيقي. */
  function edgeColor(d, w, h) {
    const bins = new Map();
    const step = Math.max(1, Math.round(Math.min(w, h) / 150));
    const add = (x, y) => {
      const i = (y * w + x) * 4;
      const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      let b = bins.get(key);
      if (!b) { b = { n: 0, r: 0, g: 0, bl: 0 }; bins.set(key, b); }
      b.n++; b.r += d[i]; b.g += d[i + 1]; b.bl += d[i + 2];
    };
    for (let x = 0; x < w; x += step) { add(x, 0); add(x, h - 1); }
    for (let y = 0; y < h; y += step) { add(0, y); add(w - 1, y); }
    let best = null;
    bins.forEach(b => { if (!best || b.n > best.n) best = b; });
    if (!best) return { r: 255, g: 255, b: 255, share: 0 };
    let all = 0; bins.forEach(b => all += b.n);
    return {
      r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.bl / best.n),
      share: best.n / all
    };
  }
  function edgeRegion(src, tol) {
    const w = src.width, h = src.height;
    const d = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const bg = edgeColor(d, w, h);
    const seen = new Uint8Array(w * h), out = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let sp = 0;
    const push = (i) => {
      if (seen[i]) return;
      const k = i * 4;
      if (Math.abs(d[k] - bg.r) + Math.abs(d[k + 1] - bg.g) + Math.abs(d[k + 2] - bg.b) > tol * 3) return;
      seen[i] = 1; stack[sp++] = i;
    };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    let n = 0;
    while (sp > 0) {
      const i = stack[--sp];
      out[i] = 1; n++;
      const x = i % w, y = (i / w) | 0;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
    }
    return { region: out, cover: n / (w * h) };
  }
  /* الخلفية سادة فعلاً؟ بنبص على بكسلات الحواف: لو أغلبها نفس اللون
     تقريبًا يبقى ورقة أو حيطة. لو نصها لون ونصها لون (بلاط) يبقى
     خلفية مش سادة — وساعتها مبنشيلش حاجة لوحدنا، لأن التخمين الغلط
     بيبوّظ الصورة وهو مش فاهم ليه. */
  function edgeUniform(src) {
    const w = src.width, h = src.height;
    const d = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const bg = edgeColor(d, w, h);
    let near = 0, all = 0;
    const step = Math.max(1, Math.round(Math.min(w, h) / 150));
    const chk = (x, y) => {
      const i = (y * w + x) * 4;
      all++;
      if (Math.abs(d[i] - bg.r) + Math.abs(d[i + 1] - bg.g) + Math.abs(d[i + 2] - bg.b) <= 45) near++;
    };
    for (let x = 0; x < w; x += step) { chk(x, 0); chk(x, h - 1); }
    for (let y = 0; y < h; y += step) { chk(0, y); chk(w - 1, y); }
    return all ? near / all : 0;
  }

  function autoStart(src) {
    if (edgeUniform(src) < 0.85) return null;      // خلفية مش سادة — سيبها له
    let best = null;
    for (const t of [12, 18, 26]) {
      const r = edgeRegion(src, t);
      if (r.cover > 0.9) break;
      if (r.cover > 0.25) best = r;
    }
    return best;
  }

  /* الإضاءة: بنمد الفاتح والغامق شوية عشان الصورة ما تبقاش مغسولة.
     بنحسبها على اللي فاضل من المنتج بس، مش على الخلفية. */
  function levels(data, keep, w, h, amount) {
    if (amount <= 0) return;
    const hist = new Uint32Array(256);
    let n = 0;
    for (let i = 0; i < w * h; i++) {
      if (keep && !keep[i]) continue;
      const l = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000 | 0;
      hist[l]++; n++;
    }
    if (n < 50) return;
    const at = (p) => { let acc = 0; const want = n * p; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= want) return v; } return 255; };
    let lo = at(0.01), hi = at(0.99);
    if (hi - lo < 25) return;
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

  /* بيطلّع الصورة النهائية: الصورة × القناع، مقصوصة ومتوسطة في مربع
     بلون الخلفية المختار. */
  function compose(src, maskCv, opt) {
    const w = src.width, h = src.height;
    const o = Object.assign({ bg: '#ffffff', crop: true, shadow: true, light: 0.7 }, opt || {});

    // الصورة × القناع
    const cut = canvasOf(w, h);
    const cx2 = cut.getContext('2d', { willReadFrequently: true });
    cx2.drawImage(src, 0, 0);
    if (maskCv) {
      cx2.globalCompositeOperation = 'destination-in';
      cx2.drawImage(maskCv, 0, 0);
      cx2.globalCompositeOperation = 'source-over';
    }

    // الإضاءة + حدود اللي فاضل
    const img = cx2.getImageData(0, 0, w, h);
    const d = img.data;
    const keep = new Uint8Array(w * h);
    let x0 = w, y0 = h, x1 = -1, y1 = -1, any = 0;
    for (let i = 0; i < w * h; i++) {
      if (d[i * 4 + 3] < 24) continue;
      keep[i] = 1; any++;
      const x = i % w, y = (i / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (!any) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
    if (o.light > 0) { levels(d, keep, w, h, o.light); cx2.putImageData(img, 0, 0); }

    let bx = x0, by = y0, bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (!o.crop) { bx = 0; by = 0; bw = w; bh = h; }

    const out = canvasOf(OUT, OUT);
    const octx = out.getContext('2d');
    octx.fillStyle = o.bg;
    octx.fillRect(0, 0, OUT, OUT);

    const side = Math.max(bw, bh) * (1 + MARGIN * 2);
    const k = OUT / side;
    const ccx = bx + bw / 2, ccy = by + bh / 2;
    const px = OUT / 2 - ccx * k, py = OUT / 2 - ccy * k;

    if (o.shadow && any) {
      const sy = Math.min(OUT - 30, py + (by + bh) * k + 6);
      const sw = Math.max(40, bw * k * 0.8);
      octx.save();
      octx.translate(OUT / 2, sy);
      octx.scale(1, 0.16);
      const g = octx.createRadialGradient(0, 0, 0, 0, 0, sw / 2);
      g.addColorStop(0, 'rgba(0,0,0,.28)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      octx.fillStyle = g;
      octx.beginPath(); octx.arc(0, 0, sw / 2, 0, Math.PI * 2); octx.fill();
      octx.restore();
    }

    octx.imageSmoothingQuality = 'high';
    octx.drawImage(cut, px, py, w * k, h * k);
    return { canvas: out, kept: any, box: { x: bx, y: by, w: bw, h: bh } };
  }

  function toB64(canvas, q) { return canvas.toDataURL('image/jpeg', q || 0.86).split(',')[1]; }

  // ---------- الشاشة ----------
  async function open(file, opts) {
    let work;
    try { work = toWork(await loadImage(file)); }
    catch (e) { Utils.toast(e.message || 'مقدرناش نفتح الصورة', 'error'); return null; }
    return new Promise((resolve) => studio(work, resolve, opts || {}));
  }

  function studio(src, resolve, opts) {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };

    const W = src.width, H = src.height;
    // القناع: أبيض = ظاهر، شفاف = مشيل
    const mask = canvasOf(W, H);
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#fff'; mctx.fillRect(0, 0, W, H);

    // لو الخلفية سادة، بنبدأ وهي مشيلة — بيوفر عليه شغل
    let startedAuto = false;
    if (opts.clean !== false) {
      const auto = autoStart(src);
      if (auto) {
        mctx.globalCompositeOperation = 'destination-out';
        mctx.drawImage(regionToCanvas(auto.region, W, H), 0, 0);
        mctx.globalCompositeOperation = 'source-over';
        startedAuto = true;
      }
    }

    const st = {
      tool: 'erase', size: Math.max(18, Math.round(W / 16)), wandTol: 30,
      bg: (opts.bg || '#ffffff'),
      crop: opts.crop !== false, shadow: opts.shadow !== false,
      light: opts.light !== undefined ? opts.light : 0.7
    };
    const undo = [];
    const snap = () => {
      undo.push(mctx.getImageData(0, 0, W, H));
      if (undo.length > UNDO_MAX) undo.shift();
    };

    const { close, overlay } = Utils.openModal({
      title: '📸 استوديو الصور',
      wide: true,
      bodyHtml: `
        <div class="ph-wrap">
          <div class="ph-view">
            <div class="ph-stage">
              <canvas id="phEdit"></canvas>
              <canvas id="phCur"></canvas>
            </div>
            <div class="ph-hint" id="phHint"></div>
          </div>

          <div class="ph-side">
            <div class="ph-tools">
              <button type="button" class="ph-tool on" data-tool="erase" title="امسح اللي مش عايزه">${IC.erase}<span>امسح</span></button>
              <button type="button" class="ph-tool" data-tool="wand" title="دوسة واحدة تشيل خلفية متشابهة">${IC.wand}<span>عصا</span></button>
              <button type="button" class="ph-tool" data-tool="back" title="رجّع اللي مسحته بالغلط">${IC.back}<span>رجّع</span></button>
              <button type="button" class="ph-tool" id="phUndo" title="تراجع عن آخر خطوة">${IC.undo}<span>تراجع</span></button>
            </div>

            <div class="ph-row" id="phSizeRow">
              <span>حجم الفرشة</span>
              <input type="range" id="phSize" min="8" max="${Math.round(W / 3)}" value="${st.size}">
            </div>
            <div class="ph-row" id="phTolRow" hidden>
              <span>حساسية العصا</span>
              <input type="range" id="phTol" min="8" max="90" value="${st.wandTol}">
            </div>

            <label class="lbl" style="margin-top:6px;">لون الخلفية</label>
            <div class="ph-bgs" id="phBgs">
              ${BGS.map(b => `<button type="button" class="ph-bg ${b.c === st.bg ? 'on' : ''}"
                 data-c="${b.c}" title="${b.name}" style="background:${b.c}"></button>`).join('')}
              <label class="ph-bg ph-pick" title="لون تاني">
                <input type="color" id="phColor" value="#ffffff"><span>🎨</span>
              </label>
            </div>

            <label class="ph-sw"><input type="checkbox" id="phCrop" ${st.crop ? 'checked' : ''}> قصّ حوالين المنتج</label>
            <label class="ph-sw"><input type="checkbox" id="phShadow" ${st.shadow ? 'checked' : ''}> ظل خفيف تحته</label>
            <div class="ph-row">
              <span>ظبط الإضاءة</span>
              <input type="range" id="phLight" min="0" max="100" value="${Math.round(st.light * 100)}">
            </div>
            <div class="ph-row2">
              <button type="button" class="btn btn-ghost btn-sm" id="phRot">لفّها ٩٠°</button>
              <button type="button" class="btn btn-ghost btn-sm" id="phReset">ابدأ من الأول</button>
            </div>

            <div class="ph-tips">
              <strong>الطريقة:</strong>
              <ol>
                <li><b>العصا</b> — دوس على الخلفية (البلاط، الحيطة) تتشال كلها مرة واحدة. دوس كذا مرة على الأماكن الباقية.</li>
                <li><b>امسح</b> — امسح على إيدك أو أي حاجة زيادة.</li>
                <li><b>رجّع</b> — لو مسحت من المنتج بالغلط.</li>
              </ol>
            </div>

            <div class="form-actions" style="margin-top:12px;">
              <button type="button" class="btn btn-ghost" id="phCancel">إلغاء</button>
              <button type="button" class="btn btn-amber" id="phOk">استعمل الصورة</button>
            </div>
          </div>
        </div>`,
      onMount: (mb, closeMe) => {
        const edit = mb.querySelector('#phEdit');
        const cur = mb.querySelector('#phCur');
        const ectx = edit.getContext('2d');
        const cctx = cur.getContext('2d');
        const hint = mb.querySelector('#phHint');
        let VW = 0, VH = 0;                 // مقاس العرض على الشاشة

        function fit() {
          const box = edit.parentElement.getBoundingClientRect();
          const maxW = Math.max(240, Math.min(460, box.width || 420));
          const k = Math.min(maxW / W, 460 / H);
          VW = Math.round(W * k); VH = Math.round(H * k);
          [edit, cur].forEach(c => { c.width = VW; c.height = VH; c.style.width = VW + 'px'; c.style.height = VH + 'px'; });
        }

        // الرسم على الشاشة: شطرنج خفيف ورا عشان المشيل يبان
        function paint() {
          ectx.clearRect(0, 0, VW, VH);
          ectx.fillStyle = st.bg;
          ectx.fillRect(0, 0, VW, VH);
          const tmp = canvasOf(W, H);
          const t = tmp.getContext('2d');
          t.drawImage(src, 0, 0);
          t.globalCompositeOperation = 'destination-in';
          t.drawImage(mask, 0, 0);
          ectx.drawImage(tmp, 0, 0, VW, VH);
          hint.textContent = startedAuto
            ? 'شلنا الخلفية اللي عرفناها — كمّل بالعصا والممحاة لو فاضل حاجة'
            : 'استعمل «العصا» على الخلفية و«امسح» على إيدك';
        }

        function brushCursor(x, y) {
          cctx.clearRect(0, 0, VW, VH);
          if (x == null || st.tool === 'wand') return;
          const r = st.size * (VW / W) / 2;
          cctx.beginPath(); cctx.arc(x, y, r, 0, Math.PI * 2);
          cctx.strokeStyle = st.tool === 'back' ? '#1D6B3D' : '#B3261E';
          cctx.lineWidth = 2; cctx.stroke();
          cctx.strokeStyle = 'rgba(255,255,255,.9)'; cctx.lineWidth = 1; cctx.stroke();
        }

        const toWorkXY = (e) => {
          const r = edit.getBoundingClientRect();
          return {
            x: Math.round((e.clientX - r.left) / r.width * W),
            y: Math.round((e.clientY - r.top) / r.height * H),
            vx: e.clientX - r.left, vy: e.clientY - r.top
          };
        };

        let drawing = false, lastP = null;
        function stroke(a, b) {
          mctx.globalCompositeOperation = st.tool === 'back' ? 'source-over' : 'destination-out';
          mctx.strokeStyle = '#fff'; mctx.fillStyle = '#fff';
          mctx.lineWidth = st.size; mctx.lineCap = 'round'; mctx.lineJoin = 'round';
          mctx.beginPath();
          mctx.moveTo(a.x, a.y); mctx.lineTo(b.x, b.y);
          mctx.stroke();
          mctx.globalCompositeOperation = 'source-over';
        }

        cur.addEventListener('pointerdown', (e) => {
          const p = toWorkXY(e);
          if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) return;
          snap();
          if (st.tool === 'wand') {
            const reg = wandRegion(src, p.x, p.y, st.wandTol);
            mctx.globalCompositeOperation = 'destination-out';
            mctx.drawImage(regionToCanvas(reg, W, H), 0, 0);
            mctx.globalCompositeOperation = 'source-over';
            paint();
            return;
          }
          drawing = true; lastP = p;
          cur.setPointerCapture(e.pointerId);
          stroke(p, p); paint();
        });
        cur.addEventListener('pointermove', (e) => {
          const p = toWorkXY(e);
          brushCursor(p.vx, p.vy);
          if (!drawing) return;
          stroke(lastP, p); lastP = p; paint();
        });
        const stop = () => { drawing = false; lastP = null; };
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => cur.addEventListener(ev, stop));
        cur.addEventListener('pointerleave', () => brushCursor(null));

        // الأدوات
        mb.querySelectorAll('.ph-tool[data-tool]').forEach(b => b.addEventListener('click', () => {
          st.tool = b.dataset.tool;
          mb.querySelectorAll('.ph-tool[data-tool]').forEach(x => x.classList.toggle('on', x === b));
          mb.querySelector('#phSizeRow').hidden = st.tool === 'wand';
          mb.querySelector('#phTolRow').hidden = st.tool !== 'wand';
        }));
        mb.querySelector('#phUndo').addEventListener('click', () => {
          const s = undo.pop();
          if (!s) { Utils.toast('مفيش حاجة نرجع فيها', 'info'); return; }
          mctx.putImageData(s, 0, 0); paint();
        });
        mb.querySelector('#phSize').addEventListener('input', e => { st.size = Number(e.target.value); });
        mb.querySelector('#phTol').addEventListener('input', e => { st.wandTol = Number(e.target.value); });

        mb.querySelector('#phBgs').addEventListener('click', (e) => {
          const b = e.target.closest('.ph-bg[data-c]');
          if (!b) return;
          st.bg = b.dataset.c;
          mb.querySelectorAll('.ph-bg[data-c]').forEach(x => x.classList.toggle('on', x === b));
          paint();
        });
        mb.querySelector('#phColor').addEventListener('input', (e) => {
          st.bg = e.target.value;
          mb.querySelectorAll('.ph-bg[data-c]').forEach(x => x.classList.remove('on'));
          paint();
        });

        mb.querySelector('#phCrop').addEventListener('change', e => { st.crop = e.target.checked; });
        mb.querySelector('#phShadow').addEventListener('change', e => { st.shadow = e.target.checked; });
        mb.querySelector('#phLight').addEventListener('input', e => { st.light = Number(e.target.value) / 100; });

        mb.querySelector('#phRot').addEventListener('click', () => {
          Utils.toast('اللف بيبدأ من الأول', 'info');
          const rot = (cv) => {
            const c = canvasOf(cv.height, cv.width);
            const x = c.getContext('2d');
            x.translate(c.width / 2, c.height / 2);
            x.rotate(Math.PI / 2);
            x.drawImage(cv, -cv.width / 2, -cv.height / 2);
            return c;
          };
          const ns = rot(src), nm = rot(mask);
          settle(null); closeMe();
          studio(ns, resolve, Object.assign({}, opts, { clean: false, bg: st.bg }));
          void nm;
        });
        mb.querySelector('#phReset').addEventListener('click', () => {
          snap();
          mctx.globalCompositeOperation = 'source-over';
          mctx.fillStyle = '#fff'; mctx.fillRect(0, 0, W, H);
          startedAuto = false;
          paint();
        });

        mb.querySelector('#phCancel').addEventListener('click', closeMe);
        mb.querySelector('#phOk').addEventListener('click', () => {
          const r = compose(src, mask, st);
          if (!r.kept) { Utils.toast('الصورة اتمسحت كلها — دوس «ابدأ من الأول»', 'error'); return; }
          const b64 = toB64(r.canvas, 0.86);
          settle(b64);
          closeMe();
        });

        fit(); paint();
        window.addEventListener('resize', () => { fit(); paint(); });
      }
    });

    const watch = new MutationObserver(() => {
      if (!document.body.contains(overlay)) { watch.disconnect(); settle(null); }
    });
    watch.observe(document.body, { childList: true });
  }

  return { open, compose, wandRegion, edgeRegion, autoStart, regionToCanvas, BGS, OUT, _toWork: toWork };
})();
