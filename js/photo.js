/* استوديو صور المنتجات.

   الفكرة: صاحب المحل بيصوّر بالموبايل وهو ماسك المنتج بإيده،
   والخلفية بلاط أو رفوف، والإضاءة صفرا من لمبة المحل. الملف ده
   بيعمل اللي المصوّر المحترف بيعمله، وبنفس الترتيب:

     ١) يعدّل ميل الصورة (الموبايل عمره ما بيبقى مظبوط)
     ٢) يعزل المنتج — مربع حوالينه، وعصا للخلفية، وممحاة لإيده
     ٣) ينعّم الحواف وينضّف البقع الصغيرة اللي فضلت
     ٤) يصحّح لون الإضاءة والسطوع والتباين والوضوح
     ٥) يحطه على خلفية بلون واحد بنفس الفراغ وظل خفيف
     ٦) يطلّعه بنفس المقاس في كل مرة — ١٠٠٠×١٠٠٠

   كل ده جوه المتصفح، من غير نت ولا برامج ولا حساب على أي موقع.

   قاعدة ثابتة: المنتج نفسه مبنغيّروش. بنشيل اللي حواليه ونظبط
   الإضاءة بس — الزبون لازم يستلم اللي شافه بالظبط.

   ملحوظتين فنيتين:
   • القناع (اللي بيحدد الظاهر من المشيل) محفوظ بإحداثيات الصورة
     الأصلية، والميل والتكبير بيتطبقوا وقت العرض بس. عشان كده تقدر
     تعدّل الميل بعد ما تمسح من غير ما اللي مسحته يتهجّص.
   • الشغل بيحصل على نسخة صغيرة (سريعة) والتصدير من نسخة كبيرة،
     والقناع بيتكبّر معاها — فالصورة النهائية تطلع واضحة. */
const Photo = (() => {

  const OUT = 1000;          // الناتج: مربع ١٠٠٠×١٠٠٠
  const WORK = 760;          // نسخة الشغل (سريعة)
  const FULL = 1500;         // نسخة التصدير (واضحة)
  const MARGIN = 0.08;       // فراغ حوالين المنتج
  const UNDO_MAX = 16;

  const BGS = [
    { name: 'أبيض', c: '#ffffff' },
    { name: 'رمادي فاتح', c: '#F2F2F0' },
    { name: 'بيج', c: '#FBF3EC' },
    { name: 'برتقالي فاتح', c: '#FFF0E8' },
    { name: 'كحلي', c: '#16324B' },
    { name: 'أسود', c: '#141414' }
  ];

  function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  const ctx2 = (c) => c.getContext('2d', { willReadFrequently: true });

  /* أيقونات مرسومة — الرموز الجاهزة مش موجودة في كل خطوط ويندوز
     وكانت بتطلع مربعات فاضية. */
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    erase: svg('<path d="M7 20h12"/><path d="M15.5 4.5 20 9 11 18H6.5L4 15.5z"/><path d="M10.5 9.5 15 14"/>'),
    wand: svg('<path d="M5 19 16 8"/><path d="M14 6l4 4"/><path d="M18 3v3M21 5h-3M6 4v2M7 5H5M19 15v2M20 16h-2"/>'),
    back: svg('<path d="M4 13a8 8 0 1 0 2.3-5.6"/><path d="M4 4v5h5"/>'),
    box: svg('<path d="M3.5 8.5v-3a2 2 0 0 1 2-2h3M15.5 3.5h3a2 2 0 0 1 2 2v3M20.5 15.5v3a2 2 0 0 1-2 2h-3M8.5 20.5h-3a2 2 0 0 1-2-2v-3"/>'),
    undo: svg('<path d="M3 7h11a5 5 0 0 1 0 10H8"/><path d="M6 4 3 7l3 3"/>'),
    hand: svg('<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V12m0-1a1.5 1.5 0 0 1 3 0v4a5 5 0 0 1-5 5h-1.5a5 5 0 0 1-5-5v-3a1.5 1.5 0 0 1 3 0"/>'),
    zin: svg('<circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M16.5 16.5 21 21"/>'),
    zout: svg('<circle cx="11" cy="11" r="7"/><path d="M8 11h6M16.5 16.5 21 21"/>')
  };

  // ---------- تحميل الصورة ----------
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
  function scaleTo(img, max) {
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = canvasOf(Math.max(1, Math.round(img.width * s)), Math.max(1, Math.round(img.height * s)));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  // ---------- التعرّف على الخلفية ----------
  /* لون الخلفية = اللون الأكتر تكرارًا على الحواف.
     (كان وسيط كل قناة لوحده، وده بيطلّع لون مش موجود في الصورة —
      مع بلاط بلونين كان بيقع بينهم، فالاتنين يبقوا "خلفية"، فالأرضية
      كلها كانت بتتشال.) */
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
    let best = null, all = 0;
    bins.forEach(b => { all += b.n; if (!best || b.n > best.n) best = b; });
    if (!best) return { r: 255, g: 255, b: 255, share: 0 };
    return { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n),
             b: Math.round(best.bl / best.n), share: best.n / all };
  }

  // نسبة الحواف اللي لونها قريب من لون الخلفية — بتقول هل الخلفية سادة ولا لأ
  function edgeUniform(src) {
    const w = src.width, h = src.height;
    const d = ctx2(src).getImageData(0, 0, w, h).data;
    const bg = edgeColor(d, w, h);
    let near = 0, all = 0;
    const step = Math.max(1, Math.round(Math.min(w, h) / 150));
    const chk = (x, y) => {
      const i = (y * w + x) * 4; all++;
      if (Math.abs(d[i] - bg.r) + Math.abs(d[i + 1] - bg.g) + Math.abs(d[i + 2] - bg.b) <= 45) near++;
    };
    for (let x = 0; x < w; x += step) { chk(x, 0); chk(x, h - 1); }
    for (let y = 0; y < h; y += step) { chk(0, y); chk(w - 1, y); }
    return all ? near / all : 0;
  }

  /* منطقة لونها قريب من نقطة معيّنة — العصا السحرية.
     all=false: المتصل بالنقطة بس (الافتراضي، آمن).
     all=true : اللون ده في الصورة كلها — مفيد لما الخلفية متقطعة
                ورا المنتج فمش وصلة واحدة. */
  function wandRegion(src, x0, y0, tol, all) {
    const w = src.width, h = src.height;
    const d = ctx2(src).getImageData(0, 0, w, h).data;
    const s = (y0 * w + x0) * 4;
    const r0 = d[s], g0 = d[s + 1], b0 = d[s + 2];
    const out = new Uint8Array(w * h);
    const like = (i) => Math.abs(d[i * 4] - r0) + Math.abs(d[i * 4 + 1] - g0) + Math.abs(d[i * 4 + 2] - b0) <= tol * 3;
    if (all) {
      for (let i = 0; i < w * h; i++) if (like(i)) out[i] = 1;
      return out;
    }
    const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
    let sp = 0;
    const push = (i) => { if (!seen[i] && like(i)) { seen[i] = 1; stack[sp++] = i; } };
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

  // الخلفية الموصولة بحواف الصورة — للتنضيف التلقائي في الأول
  function edgeRegion(src, tol) {
    const w = src.width, h = src.height;
    const d = ctx2(src).getImageData(0, 0, w, h).data;
    const bg = edgeColor(d, w, h);
    const seen = new Uint8Array(w * h), out = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let sp = 0, n = 0;
    const push = (i) => {
      if (seen[i]) return;
      const k = i * 4;
      if (Math.abs(d[k] - bg.r) + Math.abs(d[k + 1] - bg.g) + Math.abs(d[k + 2] - bg.b) > tol * 3) return;
      seen[i] = 1; stack[sp++] = i;
    };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
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

  /* بداية تلقائية — بس لو الخلفية سادة فعلاً. لو بلاط أو رفوف
     مبنخمّنش حاجة، عشان ماناكلش من المنتج. */
  function autoStart(src) {
    if (edgeUniform(src) < 0.85) return null;
    let best = null;
    for (const t of [12, 18, 26]) {
      const r = edgeRegion(src, t);
      if (r.cover > 0.9) break;
      if (r.cover > 0.25) best = r;
    }
    return best;
  }

  function regionToCanvas(region, w, h) {
    const c = canvasOf(w, h);
    const x = c.getContext('2d');
    const img = x.createImageData(w, h);
    for (let i = 0; i < w * h; i++) if (region[i]) img.data[i * 4 + 3] = 255;
    x.putImageData(img, 0, 0);
    return c;
  }

  // ---------- تصحيح اللون والإضاءة ----------
  /* إضاءة المحل صفرا، فالصورة بتطلع مايلة للأصفر. بنشوف أفتح ٥٪ في
     الصورة ونعتبرها "المفروض تكون بيضا"، وبنعدّل القنوات على أساسها —
     بحد أقصى ٣٥٪ عشان منجيش على ألوان المنتج الحقيقية. */
  function whiteBalanceGains(d, n) {
    const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256);
    for (let i = 0; i < n; i++) { hr[d[i * 4]]++; hg[d[i * 4 + 1]]++; hb[d[i * 4 + 2]]++; }
    const top = (hist) => {
      let acc = 0; const want = n * 0.95;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= want) return Math.max(1, v); }
      return 255;
    };
    const r = top(hr), g = top(hg), b = top(hb);
    const m = Math.max(r, g, b);
    const cap = (x) => Math.max(0.74, Math.min(1.35, m / x));
    return { r: cap(r), g: cap(g), b: cap(b) };
  }

  /* نسخة معدّلة اللون من الصورة. بتتحسب مرة واحدة لما يحرّك مؤشر،
     والفرشة بترسم فوقها — عشان الرسم يفضل سريع. */
  function adjust(src, o) {
    const w = src.width, h = src.height;
    const c = canvasOf(w, h);
    const x = ctx2(c);
    x.drawImage(src, 0, 0);
    if (!o || (!o.wb && !o.bright && !o.contrast && !o.sharp)) return c;

    const img = x.getImageData(0, 0, w, h);
    const d = img.data, n = w * h;
    const g = o.wb ? whiteBalanceGains(d, n) : { r: 1, g: 1, b: 1 };
    const br = (o.bright || 0) * 1.6;                       // المؤشر -٥٠..٥٠
    const ct = 1 + (o.contrast || 0) / 70;
    const gains = [g.r, g.g, g.b];
    const lut = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
    for (let ch = 0; ch < 3; ch++) {
      for (let v = 0; v < 256; v++) {
        let t = v * gains[ch] + br;
        t = (t - 128) * ct + 128;
        lut[ch][v] = t < 0 ? 0 : t > 255 ? 255 : t | 0;
      }
    }
    for (let i = 0; i < n; i++) {
      d[i * 4] = lut[0][d[i * 4]];
      d[i * 4 + 1] = lut[1][d[i * 4 + 1]];
      d[i * 4 + 2] = lut[2][d[i * 4 + 2]];
    }
    x.putImageData(img, 0, 0);
    if (o.sharp > 0) sharpen(x, w, h, o.sharp / 100);
    return c;
  }

  /* وضوح: بنطرح نسخة مغبّشة من الأصل ونزوّد الفرق — ده اللي بيخلي
     الكتابة على العلبة تتقرا والسلك يبان مبروم. */
  function sharpen(x, w, h, amount) {
    const base = x.getImageData(0, 0, w, h);
    const blurCv = canvasOf(w, h);
    const bx = blurCv.getContext('2d');
    bx.filter = 'blur(' + Math.max(0.8, w / 640).toFixed(2) + 'px)';
    bx.drawImage(x.canvas, 0, 0);
    bx.filter = 'none';
    const bl = bx.getImageData(0, 0, w, h).data;
    const d = base.data, k = amount * 1.15;
    for (let i = 0; i < w * h * 4; i++) {
      if ((i & 3) === 3) continue;
      const v = d[i] + (d[i] - bl[i]) * k;
      d[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    x.putImageData(base, 0, 0);
  }

  // ---------- تنضيف القناع ----------
  /* بعد المسح بتفضل بقع صغيرة من الخلفية هنا وهناك. بنشيل أي بقعة
     أصغر من ١.٥٪ من أكبر قطعة — دي مش منتج، دي زبالة. */
  function despeckle(maskCv) {
    const w = maskCv.width, h = maskCv.height;
    const x = ctx2(maskCv);
    const img = x.getImageData(0, 0, w, h);
    const a = img.data;
    const lab = new Int32Array(w * h).fill(-1);
    const stack = new Int32Array(w * h);
    const sizes = [];
    for (let s = 0; s < w * h; s++) {
      if (lab[s] >= 0 || a[s * 4 + 3] < 24) continue;
      const id = sizes.length;
      let sp = 0, n = 0;
      lab[s] = id; stack[sp++] = s;
      while (sp > 0) {
        const i = stack[--sp]; n++;
        const px = i % w, py = (i / w) | 0;
        const go = (j) => { if (lab[j] < 0 && a[j * 4 + 3] >= 24) { lab[j] = id; stack[sp++] = j; } };
        if (px > 0) go(i - 1);
        if (px < w - 1) go(i + 1);
        if (py > 0) go(i - w);
        if (py < h - 1) go(i + w);
      }
      sizes.push(n);
    }
    if (sizes.length < 2) return 0;
    const min = Math.max.apply(null, sizes) * 0.015;
    let killed = 0;
    for (let i = 0; i < w * h; i++) {
      const id = lab[i];
      if (id >= 0 && sizes[id] < min) { a[i * 4 + 3] = 0; killed++; }
    }
    if (killed) x.putImageData(img, 0, 0);
    return killed;
  }

  // ---------- التركيب النهائي ----------
  /* بياخد الصورة والقناع والإعدادات ويطلّع المربع النهائي.
     بيتنادى على نسخة الشغل للمعاينة، وعلى النسخة الكبيرة للتصدير. */
  function compose(srcCv, maskCv, opt) {
    const o = Object.assign({
      bg: '#ffffff', crop: true, shadow: 1, feather: 1.2, angle: 0,
      wb: false, bright: 0, contrast: 0, sharp: 0, clean: true, adjusted: null
    }, opt || {});

    const base = o.adjusted || adjust(srcCv, o);
    const W = base.width, H = base.height;

    // القناع: نعومة الحواف (بتتكبّر مع مقاس الصورة) + تنضيف البقع
    let mk = null;
    if (maskCv) {
      mk = canvasOf(W, H);
      const mx = ctx2(mk);
      const f = o.feather * Math.max(0.5, W / WORK);
      if (f > 0.05) mx.filter = 'blur(' + f.toFixed(2) + 'px)';
      mx.drawImage(maskCv, 0, 0, W, H);
      mx.filter = 'none';
      if (o.clean) despeckle(mk);
    }

    // الصورة × القناع
    const cut = canvasOf(W, H);
    const cx = ctx2(cut);
    cx.drawImage(base, 0, 0);
    if (mk) {
      cx.globalCompositeOperation = 'destination-in';
      cx.drawImage(mk, 0, 0);
      cx.globalCompositeOperation = 'source-over';
    }

    // الميل
    const ang = (o.angle || 0) * Math.PI / 180;
    let work = cut, WW = W, HH = H;
    if (ang) {
      const ca = Math.abs(Math.cos(ang)), sa = Math.abs(Math.sin(ang));
      WW = Math.round(W * ca + H * sa); HH = Math.round(W * sa + H * ca);
      work = canvasOf(WW, HH);
      const wx = work.getContext('2d');
      wx.imageSmoothingQuality = 'high';
      wx.translate(WW / 2, HH / 2); wx.rotate(ang);
      wx.drawImage(cut, -W / 2, -H / 2);
    }

    // حدود اللي فاضل
    const d = ctx2(work).getImageData(0, 0, WW, HH).data;
    let x0 = WW, y0 = HH, x1 = -1, y1 = -1, any = 0;
    for (let i = 0; i < WW * HH; i++) {
      if (d[i * 4 + 3] < 24) continue;
      any++;
      const x = i % WW, y = (i / WW) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (!any) { x0 = 0; y0 = 0; x1 = WW - 1; y1 = HH - 1; }

    let bx = x0, by = y0, bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (!o.crop) { bx = 0; by = 0; bw = WW; bh = HH; }

    const out = canvasOf(OUT, OUT);
    const ox = out.getContext('2d');
    ox.fillStyle = o.bg; ox.fillRect(0, 0, OUT, OUT);

    const side = Math.max(bw, bh) * (1 + MARGIN * 2);
    const k = OUT / side;
    const px = OUT / 2 - (bx + bw / 2) * k, py = OUT / 2 - (by + bh / 2) * k;

    if (o.shadow > 0 && any) {
      const sy = Math.min(OUT - 24, py + (by + bh) * k + 8);
      const sw = Math.max(40, bw * k * 0.82);
      ox.save();
      ox.translate(OUT / 2, sy);
      ox.scale(1, 0.15);
      const g = ox.createRadialGradient(0, 0, 0, 0, 0, sw / 2);
      g.addColorStop(0, 'rgba(0,0,0,' + (0.17 * o.shadow).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ox.fillStyle = g;
      ox.beginPath(); ox.arc(0, 0, sw / 2, 0, Math.PI * 2); ox.fill();
      ox.restore();
    }

    ox.imageSmoothingQuality = 'high';
    ox.drawImage(work, px, py, WW * k, HH * k);
    return { canvas: out, kept: any, box: { x: bx, y: by, w: bw, h: bh } };
  }

  const toB64 = (c, q) => c.toDataURL('image/jpeg', q || 0.88).split(',')[1];
  const AR = (s) => String(s).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
  // عند الصفر مبنكتبش حاجة — رقم لوحده في الركن بيبقى مش مفهوم
  const degTxt = (a) => a ? AR(a.toFixed(1).replace(/\.0$/, '')) + '°' : '';

  // ---------- الشاشة ----------
  async function open(file, opts) {
    let img;
    try { img = await loadImage(file); }
    catch (e) { Utils.toast(e.message || 'مقدرناش نفتح الصورة', 'error'); return null; }
    return new Promise((res) => studio(scaleTo(img, WORK), scaleTo(img, FULL), res, opts || {}));
  }

  function studio(src, full, resolve, opts) {
    let settled = false, handoff = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };

    const W = src.width, H = src.height;
    const mask = canvasOf(W, H);
    const mctx = ctx2(mask);
    let autoDone = false;

    if (opts.mask) {                        // جاي من لفّة ٩٠° — بنكمّل على نفس الشغل
      mctx.drawImage(opts.mask, 0, 0, W, H);
      autoDone = true;
    } else {
      mctx.fillStyle = '#fff'; mctx.fillRect(0, 0, W, H);
      const auto = opts.clean === false ? null : autoStart(src);
      if (auto) {
        mctx.globalCompositeOperation = 'destination-out';
        mctx.drawImage(regionToCanvas(auto.region, W, H), 0, 0);
        mctx.globalCompositeOperation = 'source-over';
        autoDone = true;
      }
    }

    const st = {
      tool: 'box', size: Math.max(16, Math.round(W / 18)), wandTol: 30, wandAll: false,
      bg: opts.bg || '#ffffff',
      crop: opts.crop !== false, shadow: 1, feather: 1.2, clean: true,
      angle: 0, wb: false, bright: 0, contrast: 0, sharp: 0,
      zoom: 1, panX: 0, panY: 0, hand: false
    };
    // جاي من لفّة ٩٠°؟ ياخد نفس الإعدادات اللي كان وصلها — ميبدأش من الأول
    if (opts.keep) {
      Object.assign(st, opts.keep, { zoom: 1, panX: 0, panY: 0, hand: false });
      st.size = Math.min(st.size, Math.round(W / 2.5));
    }

    let adjCv = null, adjKey = null;
    const adjNow = () => {
      const key = [st.wb, st.bright, st.contrast, st.sharp].join('|');
      if (key !== adjKey || !adjCv) { adjCv = adjust(src, st); adjKey = key; }
      return adjCv;
    };

    const undo = [];
    const snap = () => {
      undo.push(mctx.getImageData(0, 0, W, H));
      if (undo.length > UNDO_MAX) undo.shift();
    };

    const { close, overlay } = Utils.openModal({
      title: '📸 استوديو الصور',
      wide: true, cls: 'modal-photo',
      bodyHtml: `
        <div class="ph-wrap">
          <div class="ph-view">
            <div class="ph-stage" id="phStage">
              <canvas id="phEdit"></canvas>
              <canvas id="phCur"></canvas>
            </div>
            <div class="ph-zoom">
              <button type="button" class="ph-zb" id="phZout" title="تصغير">${IC.zout}</button>
              <input type="range" id="phZoom" min="100" max="500" value="100" aria-label="تكبير">
              <button type="button" class="ph-zb" id="phZin" title="تكبير">${IC.zin}</button>
              <button type="button" class="ph-zb" id="phHand" title="تحريك الصورة">${IC.hand}</button>
              <button type="button" class="btn btn-ghost btn-sm" id="phFit">الصورة كلها</button>
            </div>
            <div class="ph-hint" id="phHint"></div>
          </div>

          <div class="ph-side">
            <div class="ph-prev">
              <canvas id="phPrev" width="150" height="150"></canvas>
              <div class="ph-prev-t">شكلها على الموقع<small id="phPrevN"></small></div>
            </div>

            <div class="ph-scroll">
            <div class="ph-tools">
              <button type="button" class="ph-tool ${st.tool === 'box' ? 'on' : ''}" data-tool="box" title="ارسم مربع حوالين المنتج — اللي بره يتشال">${IC.box}<span>خلي ده بس</span></button>
              <button type="button" class="ph-tool ${st.tool === 'wand' ? 'on' : ''}" data-tool="wand" title="دوسة تشيل الخلفية المتشابهة">${IC.wand}<span>عصا</span></button>
              <button type="button" class="ph-tool ${st.tool === 'erase' ? 'on' : ''}" data-tool="erase" title="امسح إيدك أو أي حاجة زيادة">${IC.erase}<span>امسح</span></button>
              <button type="button" class="ph-tool ${st.tool === 'back' ? 'on' : ''}" data-tool="back" title="رجّع اللي مسحته بالغلط">${IC.back}<span>رجّع</span></button>
              <button type="button" class="ph-tool" id="phUndo" title="تراجع عن آخر خطوة">${IC.undo}<span>تراجع</span></button>
            </div>

            <div class="ph-row" id="phSizeRow" ${(st.tool === 'erase' || st.tool === 'back') ? '' : 'hidden'}>
              <span>حجم الفرشة</span>
              <input type="range" id="phSize" min="6" max="${Math.round(W / 2.5)}" value="${st.size}">
            </div>
            <div class="ph-row" id="phTolRow" ${st.tool === 'wand' ? '' : 'hidden'}>
              <span>حساسية العصا</span>
              <input type="range" id="phTol" min="6" max="90" value="${st.wandTol}">
              <label class="ph-sw sm"><input type="checkbox" id="phAll" ${st.wandAll ? 'checked' : ''}> شيل اللون ده من الصورة كلها</label>
            </div>

            <details class="ph-grp" open>
              <summary>تحسين الصورة</summary>
              <div class="ph-row"><span>تعديل الميل <b id="phAngV" dir="ltr">${degTxt(st.angle)}</b></span>
                <input type="range" id="phAngle" min="-150" max="150" value="${Math.round(st.angle * 10)}"></div>
              <div class="ph-row"><span>إضاءة</span><input type="range" id="phBright" min="-50" max="50" value="${st.bright}"></div>
              <div class="ph-row"><span>تباين</span><input type="range" id="phCon" min="-50" max="50" value="${st.contrast}"></div>
              <div class="ph-row"><span>وضوح</span><input type="range" id="phSharp" min="0" max="100" value="${st.sharp}"></div>
              <label class="ph-sw"><input type="checkbox" id="phWb" ${st.wb ? 'checked' : ''}> صحّح لون الإضاءة (الصفار)</label>
              <button type="button" class="btn btn-ghost btn-sm" id="phAuto">ظبّطها لوحدك</button>
            </details>

            <details class="ph-grp" open>
              <summary>الخلفية والشكل</summary>
              <div class="ph-bgs" id="phBgs">
                ${BGS.map(b => `<button type="button" class="ph-bg ${b.c === st.bg ? 'on' : ''}"
                   data-c="${b.c}" title="${b.name}" style="background:${b.c}"></button>`).join('')}
                <label class="ph-bg ph-pick" title="أي لون تاني"><input type="color" id="phColor" value="#ffffff"><span>🎨</span></label>
              </div>
              <div class="ph-row"><span>الظل</span><input type="range" id="phShadow" min="0" max="200" value="${Math.round(st.shadow * 100)}"></div>
              <div class="ph-row"><span>نعومة الحواف</span><input type="range" id="phFeather" min="0" max="40" value="${Math.round(st.feather * 10)}"></div>
              <label class="ph-sw"><input type="checkbox" id="phCrop" ${st.crop ? 'checked' : ''}> قصّ حوالين المنتج</label>
              <label class="ph-sw"><input type="checkbox" id="phClean" ${st.clean ? 'checked' : ''}> نضّف البقع الصغيرة</label>
            </details>

            <div class="ph-row2">
              <button type="button" class="btn btn-ghost btn-sm" id="phRot">لفّها ٩٠°</button>
              <button type="button" class="btn btn-ghost btn-sm" id="phReset">ابدأ من الأول</button>
            </div>

            <div class="ph-tips">
              <strong>الطريقة بالترتيب:</strong>
              <ol>
                <li><b>خلي ده بس</b> — ارسم مربع حوالين المنتج، كل اللي بره يتشال.</li>
                <li><b>العصا</b> — دوس على أي خلفية فاضلة (بلاط، حيطة).</li>
                <li><b>امسح</b> — امسح إيدك. كبّر بعجلة الماوس عشان تظبط الحواف.</li>
                <li><b>ظبّطها لوحدك</b> — تشيل الصفار وتزوّد الوضوح.</li>
              </ol>
            </div>
            </div>

            <div class="form-actions ph-act">
              <button type="button" class="btn btn-ghost" id="phCancel">إلغاء</button>
              <button type="button" class="btn btn-amber" id="phOk">استعمل الصورة</button>
            </div>
          </div>
        </div>`,
      onMount: (mb, closeMe) => {
        const q = (id) => mb.querySelector('#' + id);
        const edit = q('phEdit'), cur = q('phCur'), prev = q('phPrev');
        const ectx = edit.getContext('2d');
        const cctx = cur.getContext('2d');
        const pctx = prev.getContext('2d');
        const hint = q('phHint');
        let VW = 0, VH = 0, fitK = 1;

        function fit() {
          const box = mb.querySelector('.ph-view').getBoundingClientRect();
          VW = Math.max(220, Math.min(620, Math.round((box.width || 620) - 24)));
          VH = Math.round(VW * 0.8);
          [edit, cur].forEach(c => {
            c.width = VW; c.height = VH;
            c.style.width = VW + 'px'; c.style.height = VH + 'px';
          });
          const a = st.angle * Math.PI / 180;
          const ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
          fitK = Math.min(VW / (W * ca + H * sa), VH / (W * sa + H * ca)) * 0.96;
        }

        const scale = () => fitK * st.zoom;
        const cxy = () => ({ x: VW / 2 + st.panX, y: VH / 2 + st.panY });
        const clampPan = () => {
          const lim = Math.max(W, H) * scale() * 0.5;
          st.panX = Math.max(-lim, Math.min(lim, st.panX));
          st.panY = Math.max(-lim, Math.min(lim, st.panY));
        };

        /* من إحداثيات الشاشة لإحداثيات الصورة الأصلية — بنعكس اللف
           والتكبير، عشان القناع يفضل متخزّن بإحداثيات الأصل. */
        function toImg(clientX, clientY) {
          const r = cur.getBoundingClientRect();
          const c = cxy(), s = scale(), a = -st.angle * Math.PI / 180;
          const vx = clientX - r.left, vy = clientY - r.top;
          const dx = vx - c.x, dy = vy - c.y;
          const rx = dx * Math.cos(a) - dy * Math.sin(a);
          const ry = dx * Math.sin(a) + dy * Math.cos(a);
          return { x: Math.round(rx / s + W / 2), y: Math.round(ry / s + H / 2), vx, vy };
        }
        const inImg = (p) => p.x >= 0 && p.y >= 0 && p.x < W && p.y < H;

        function place(x2) {
          const c = cxy(), s = scale(), a = st.angle * Math.PI / 180;
          x2.translate(c.x, c.y); x2.rotate(a); x2.scale(s, s);
        }

        let prevTimer = null;
        function paint() {
          const base = adjNow();
          const tmp = canvasOf(VW, VH);
          const tx = tmp.getContext('2d');
          tx.imageSmoothingQuality = 'high';
          tx.save(); place(tx); tx.drawImage(base, -W / 2, -H / 2); tx.restore();
          tx.globalCompositeOperation = 'destination-in';
          tx.save(); place(tx); tx.drawImage(mask, -W / 2, -H / 2); tx.restore();

          ectx.clearRect(0, 0, VW, VH);
          ectx.fillStyle = st.bg; ectx.fillRect(0, 0, VW, VH);
          ectx.drawImage(tmp, 0, 0);

          hint.textContent = autoDone
            ? 'شلنا الخلفية اللي عرفناها — كمّل بالأدوات لو فاضل حاجة'
            : 'ابدأ بـ «خلي ده بس»: ارسم مربع حوالين المنتج';

          clearTimeout(prevTimer);
          prevTimer = setTimeout(drawPrev, 280);
        }

        // المعاينة = الناتج الحقيقي بالظبط، بس من نسخة الشغل عشان السرعة
        function drawPrev() {
          if (!document.body.contains(prev)) return;
          const r = compose(src, mask, Object.assign({}, st, { adjusted: adjNow() }));
          pctx.clearRect(0, 0, prev.width, prev.height);
          pctx.imageSmoothingQuality = 'high';
          pctx.drawImage(r.canvas, 0, 0, prev.width, prev.height);
          const pc = Math.round(r.kept / (W * H) * 100);
          q('phPrevN').textContent = r.kept ? 'المنتج واخد ' + pc + '٪ من الصورة' : 'الصورة فاضية!';
        }

        let band = null, gridTill = 0;
        function cursor(vx, vy) {
          cctx.clearRect(0, 0, VW, VH);
          if (Date.now() < gridTill) {                 // شبكة تساعده يظبط الميل
            cctx.strokeStyle = 'rgba(240,78,5,.45)'; cctx.lineWidth = 1;
            for (let i = 1; i <= 2; i++) {
              cctx.beginPath(); cctx.moveTo(VW * i / 3, 0); cctx.lineTo(VW * i / 3, VH); cctx.stroke();
              cctx.beginPath(); cctx.moveTo(0, VH * i / 3); cctx.lineTo(VW, VH * i / 3); cctx.stroke();
            }
          }
          if (band) {
            cctx.setLineDash([6, 4]);
            cctx.strokeStyle = '#F04E05'; cctx.lineWidth = 2;
            cctx.strokeRect(band.x0, band.y0, band.x1 - band.x0, band.y1 - band.y0);
            cctx.setLineDash([]);
            return;
          }
          if (vx == null || st.hand || st.tool === 'wand' || st.tool === 'box') return;
          const r = st.size * scale() / 2;
          cctx.beginPath(); cctx.arc(vx, vy, r, 0, Math.PI * 2);
          cctx.strokeStyle = st.tool === 'back' ? '#1D6B3D' : '#B3261E';
          cctx.lineWidth = 2; cctx.stroke();
          cctx.strokeStyle = 'rgba(255,255,255,.9)'; cctx.lineWidth = 1; cctx.stroke();
        }

        /* دهنة فرشة. الدوسة الواحدة من غير تحريك لازم تشيل دايرة —
           الخط اللي طوله صفر مبيرسمش حاجة في المتصفح، فلو سبناه كده
           كان لازم يفضل يحرّك الماوس عشان الممحاة تشتغل. */
        function stroke(a, b) {
          mctx.globalCompositeOperation = st.tool === 'back' ? 'source-over' : 'destination-out';
          mctx.fillStyle = '#fff'; mctx.strokeStyle = '#fff';
          mctx.lineWidth = st.size; mctx.lineCap = 'round'; mctx.lineJoin = 'round';
          if (a.x === b.x && a.y === b.y) {
            mctx.beginPath(); mctx.arc(a.x, a.y, Math.max(0.5, st.size / 2), 0, Math.PI * 2); mctx.fill();
          } else {
            mctx.beginPath(); mctx.moveTo(a.x, a.y); mctx.lineTo(b.x, b.y); mctx.stroke();
          }
          mctx.globalCompositeOperation = 'source-over';
        }

        let drawing = false, last = null, panning = false, panFrom = null;

        cur.addEventListener('pointerdown', (e) => {
          const p = toImg(e.clientX, e.clientY);
          try { cur.setPointerCapture(e.pointerId); } catch (x) { }
          if (st.hand || e.button === 1 || e.shiftKey) {
            panning = true; panFrom = { x: e.clientX - st.panX, y: e.clientY - st.panY };
            return;
          }
          if (st.tool === 'box') { band = { x0: p.vx, y0: p.vy, x1: p.vx, y1: p.vy, a: p }; drawing = true; return; }
          if (!inImg(p)) return;
          snap();
          if (st.tool === 'wand') {
            const reg = wandRegion(src, p.x, p.y, st.wandTol, st.wandAll);
            mctx.globalCompositeOperation = 'destination-out';
            mctx.drawImage(regionToCanvas(reg, W, H), 0, 0);
            mctx.globalCompositeOperation = 'source-over';
            paint(); return;
          }
          drawing = true; last = p;
          stroke(p, p); paint();
        });

        cur.addEventListener('pointermove', (e) => {
          if (panning) {
            st.panX = e.clientX - panFrom.x; st.panY = e.clientY - panFrom.y;
            clampPan(); paint(); return;
          }
          const p = toImg(e.clientX, e.clientY);
          if (st.tool === 'box' && drawing && band) {
            band.x1 = p.vx; band.y1 = p.vy; band.b = p; cursor(); return;
          }
          cursor(p.vx, p.vy);
          if (!drawing) return;
          stroke(last, p); last = p; paint();
        });

        const finishStroke = () => {
          if (st.tool === 'box' && band && band.b) {
            const a = band.a, b = band.b;
            const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
            const w2 = Math.abs(b.x - a.x), h2 = Math.abs(b.y - a.y);
            if (w2 > 8 && h2 > 8) {
              snap();
              const keep = canvasOf(W, H);
              const kx = keep.getContext('2d');
              kx.fillStyle = '#fff'; kx.fillRect(x, y, w2, h2);
              mctx.globalCompositeOperation = 'destination-in';
              mctx.drawImage(keep, 0, 0);
              mctx.globalCompositeOperation = 'source-over';
              paint();
            }
          }
          band = null; drawing = false; last = null; panning = false;
          cursor();
        };
        ['pointerup', 'pointercancel'].forEach(ev => cur.addEventListener(ev, finishStroke));
        cur.addEventListener('pointerleave', () => { if (!drawing && !panning) cursor(); });

        // عجلة الماوس = تكبير حوالين النقطة اللي تحت الماوس
        cur.addEventListener('wheel', (e) => {
          e.preventDefault();
          const p = toImg(e.clientX, e.clientY);
          const z = Math.max(1, Math.min(5, st.zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
          if (z === st.zoom) return;
          st.zoom = z;
          const s = scale(), a = st.angle * Math.PI / 180;
          const ix = p.x - W / 2, iy = p.y - H / 2;
          st.panX = p.vx - VW / 2 - (ix * Math.cos(a) - iy * Math.sin(a)) * s;
          st.panY = p.vy - VH / 2 - (ix * Math.sin(a) + iy * Math.cos(a)) * s;
          if (st.zoom === 1) { st.panX = 0; st.panY = 0; }
          clampPan();
          q('phZoom').value = Math.round(st.zoom * 100);
          paint();
        }, { passive: false });

        // --- الأدوات ---
        mb.querySelectorAll('.ph-tool[data-tool]').forEach(b => b.addEventListener('click', () => {
          st.tool = b.dataset.tool;
          st.hand = false; q('phHand').classList.remove('on');
          mb.querySelectorAll('.ph-tool[data-tool]').forEach(x => x.classList.toggle('on', x === b));
          q('phSizeRow').hidden = (st.tool !== 'erase' && st.tool !== 'back');
          q('phTolRow').hidden = st.tool !== 'wand';
          cur.style.cursor = 'crosshair';
        }));
        q('phUndo').addEventListener('click', () => {
          const s = undo.pop();
          if (!s) { Utils.toast('مفيش حاجة نرجع فيها', 'info'); return; }
          mctx.globalCompositeOperation = 'source-over';
          mctx.putImageData(s, 0, 0); paint();
        });

        const on = (id, ev, fn) => q(id).addEventListener(ev, fn);
        on('phSize', 'input', e => { st.size = +e.target.value; });
        on('phTol', 'input', e => { st.wandTol = +e.target.value; });
        on('phAll', 'change', e => { st.wandAll = e.target.checked; });

        const setZoom = (z) => {
          st.zoom = Math.max(1, Math.min(5, z));
          if (st.zoom === 1) { st.panX = 0; st.panY = 0; }
          clampPan();
          q('phZoom').value = Math.round(st.zoom * 100);
          paint();
        };
        on('phZoom', 'input', e => setZoom(+e.target.value / 100));
        on('phZin', 'click', () => setZoom(st.zoom * 1.3));
        on('phZout', 'click', () => setZoom(st.zoom / 1.3));
        on('phFit', 'click', () => setZoom(1));
        on('phHand', 'click', () => {
          st.hand = !st.hand;
          q('phHand').classList.toggle('on', st.hand);
          cur.style.cursor = st.hand ? 'grab' : 'crosshair';
          cursor();
        });

        on('phAngle', 'input', e => {
          st.angle = (+e.target.value) / 10;
          q('phAngV').textContent = degTxt(st.angle);
          gridTill = Date.now() + 1400;
          fit(); paint(); cursor();
          setTimeout(cursor, 1450);
        });
        [['phBright', 'bright'], ['phCon', 'contrast'], ['phSharp', 'sharp']].forEach(([id, key]) => {
          on(id, 'input', e => { st[key] = +e.target.value; paint(); });
        });
        on('phWb', 'change', e => { st.wb = e.target.checked; paint(); });
        on('phAuto', 'click', () => {
          st.wb = true; st.bright = 6; st.contrast = 12; st.sharp = 35;
          q('phWb').checked = true;
          q('phBright').value = 6; q('phCon').value = 12; q('phSharp').value = 35;
          paint();
        });

        q('phBgs').addEventListener('click', (e) => {
          const b = e.target.closest('.ph-bg[data-c]'); if (!b) return;
          st.bg = b.dataset.c;
          mb.querySelectorAll('.ph-bg[data-c]').forEach(x => x.classList.toggle('on', x === b));
          paint();
        });
        on('phColor', 'input', e => {
          st.bg = e.target.value;
          mb.querySelectorAll('.ph-bg[data-c]').forEach(x => x.classList.remove('on'));
          paint();
        });
        on('phCrop', 'change', e => { st.crop = e.target.checked; paint(); });
        on('phClean', 'change', e => { st.clean = e.target.checked; paint(); });
        on('phShadow', 'input', e => { st.shadow = +e.target.value / 100; paint(); });
        on('phFeather', 'input', e => { st.feather = +e.target.value / 10; paint(); });

        on('phRot', 'click', () => {
          const rot = (cv) => {
            const c = canvasOf(cv.height, cv.width);
            const x = c.getContext('2d');
            x.translate(c.width / 2, c.height / 2); x.rotate(Math.PI / 2);
            x.drawImage(cv, -cv.width / 2, -cv.height / 2);
            return c;
          };
          handoff = true;                     // الوعد لسه مفتوح — الاستوديو الجديد هو اللي يردّ
          closeMe();
          studio(rot(src), rot(full), resolve, Object.assign({}, opts, {
            mask: rot(mask), bg: st.bg, keep: st
          }));
        });
        on('phReset', 'click', () => {
          snap();
          mctx.globalCompositeOperation = 'source-over';
          mctx.fillStyle = '#fff'; mctx.fillRect(0, 0, W, H);
          autoDone = false; paint();
        });

        on('phCancel', 'click', closeMe);
        on('phOk', 'click', () => {
          const btn = q('phOk');
          btn.disabled = true; btn.textContent = 'بيجهّز...';
          setTimeout(() => {
            const r = compose(full, mask, Object.assign({}, st, { adjusted: null }));
            if (!r.kept) {
              Utils.toast('الصورة اتمسحت كلها — دوس «ابدأ من الأول»', 'error');
              btn.disabled = false; btn.textContent = 'استعمل الصورة';
              return;
            }
            settle(toB64(r.canvas, 0.88));
            closeMe();
          }, 20);
        });

        const onResize = () => {
          if (!document.body.contains(edit)) { window.removeEventListener('resize', onResize); return; }
          fit(); paint();
        };
        window.addEventListener('resize', onResize);

        fit(); paint(); drawPrev();
      }
    });

    const watch = new MutationObserver(() => {
      if (!document.body.contains(overlay)) {
        watch.disconnect();
        if (!handoff) settle(null);
      }
    });
    watch.observe(document.body, { childList: true });
  }

  return {
    open, compose, adjust, sharpen, wandRegion, edgeRegion, edgeColor, edgeUniform,
    autoStart, regionToCanvas, despeckle, whiteBalanceGains, BGS, OUT, WORK
  };
})();
