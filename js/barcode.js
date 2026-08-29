/* رسم باركود CODE-128 للطباعة على ملصقات

   ليه كتبته بنفسي: المكتبة اللي معانا بتقرا الباركود وبترسم QR بس،
   مبترسمش باركود خطوط. وجهاز الليزر بتاع المحل بيقرا الخطوط مش الـ QR.

   CODE-128B بيغطي الأرقام والحروف الإنجليزية، وده اللي بنستعمله في
   الباركودات الداخلية اللي البرنامج بيولّدها. */

const Barcode = (() => {

  // أنماط الخطوط لكل رمز في CODE-128 (كل رقم = عرض شريط بالتناوب: أسود، أبيض...)
  const PATTERNS = [
    '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
    '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
    '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
    '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
    '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
    '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
    '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
    '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
    '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
    '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
    '114131','311141','411131','211412','211214','211232','2331112'
  ];
  const START_B = 104;
  const STOP = 106;

  /* بيحوّل النص لأرقام الرموز، وبيحسب رقم التحقق اللي القارئ بيتأكد بيه */
  function encode(text) {
    const codes = [START_B];
    for (const ch of String(text)) {
      const v = ch.charCodeAt(0);
      if (v < 32 || v > 126) throw new Error('الباركود لازم يكون أرقام أو حروف إنجليزية');
      codes.push(v - 32);
    }
    let sum = START_B;
    for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
    codes.push(sum % 103);
    codes.push(STOP);
    return codes;
  }

  /* بيرسم الباركود كـ SVG — بيطبع أوضح من الصورة وبيتكبّر من غير ما يتبكسل */
  function svg(text, { height = 46, moduleWidth = 1.6, showText = true } = {}) {
    const codes = encode(text);
    let x = 0;
    const bars = [];
    for (const c of codes) {
      const pat = PATTERNS[c];
      let dark = true;
      for (const ch of pat) {
        const w = Number(ch) * moduleWidth;
        if (dark) bars.push(`<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}"/>`);
        x += w;
        dark = !dark;
      }
    }
    const total = x;
    const textH = showText ? 13 : 0;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total.toFixed(2)} ${height + textH}"
      width="${total.toFixed(2)}" height="${height + textH}" shape-rendering="crispEdges">
      <rect width="100%" height="100%" fill="#fff"/>
      <g fill="#000">${bars.join('')}</g>
      ${showText ? `<text x="${(total / 2).toFixed(2)}" y="${height + 11}" font-size="11"
        font-family="Consolas,monospace" text-anchor="middle" fill="#000"
        letter-spacing="1">${String(text)}</text>` : ''}
    </svg>`;
  }

  /* مقاس الملصق — بيتحفظ في الإعدادات عشان لو غيّر الرول يظبطه بنفسه.
     الافتراضي ٤ × ٢.٥ سم وده أشهر مقاس في المحلات. */
  const DEFAULT_SIZE = { w: 40, h: 25 };

  async function labelSize() {
    const rec = await DB.get('settings', 'labelSize');
    const s = (rec && rec.value) || {};
    return {
      w: Number(s.w) > 0 ? Number(s.w) : DEFAULT_SIZE.w,
      h: Number(s.h) > 0 ? Number(s.h) : DEFAULT_SIZE.h
    };
  }
  function saveLabelSize(w, h) {
    return DB.put('settings', { key: 'labelSize', value: { w: Number(w), h: Number(h) } });
  }

  /* الملصقات جاهزة للطباعة على رول الطابعة الحرارية.
     كل ملصق صفحة لوحده — الطابعة بتقف عند نهاية كل واحد. */
  function labelSheet(items, size) {
    const s = size || DEFAULT_SIZE;
    // الباركود بياخد حوالي نص طول الملصق، والباقي للاسم والسعر
    const barH = Math.max(22, Math.round(s.h * 0.42 * 3.78));   // مم → بكسل
    const mw = s.w <= 32 ? 1.0 : (s.w <= 45 ? 1.25 : 1.6);

    const cells = [];
    for (const it of items) {
      const count = Math.max(1, Number(it.count) || 1);
      let code = '';
      try { code = svg(it.barcode, { height: barH, moduleWidth: mw, showText: true }); }
      catch (e) { code = `<div class="lbl-err">الباركود فيه حروف عربية — غيّره لأرقام</div>`; }
      for (let i = 0; i < count; i++) {
        cells.push(`
          <div class="lbl">
            <div class="lbl-name">${Utils.escapeHtml(it.name || '')}</div>
            <div class="lbl-code">${code}</div>
            ${it.price ? `<div class="lbl-price">${Number(it.price).toFixed(2)} ج.م</div>` : ''}
          </div>`);
      }
    }
    return `<div class="lbl-sheet">${cells.join('')}</div>`;
  }

  /* قاعدة مقاس الصفحة لازم تتحقن وقت الطباعة بس — مينفعش تتكتب ثابتة
     في ملف الـ CSS، لأن الفواتير بتتطبع على ورق عادي والملصقات على
     رول صغير، والمتصفح بياخد آخر قاعدة @page مكتوبة. */
  let styleTag = null;
  function applyPageSize(s) {
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'labelPageSize';
      document.head.appendChild(styleTag);
    }
    const padV = Math.max(0.4, +(s.h * 0.05).toFixed(1));
    const padH = Math.max(0.4, +(s.w * 0.04).toFixed(1));
    styleTag.textContent = `
      @media print {
        @page { size: ${s.w}mm ${s.h}mm; margin: 0; }
        .lbl-sheet{ display:block; gap:0; }
        .lbl{
          width:${s.w}mm; height:${s.h}mm;
          border:none; border-radius:0; margin:0;
          padding:${padV}mm ${padH}mm;
          display:flex; flex-direction:column;
          align-items:center; justify-content:center;
          page-break-after:always; break-after:page; overflow:hidden;
        }
        .lbl:last-child{ page-break-after:auto; break-after:auto; }
        .lbl-code svg{ max-width:100%; max-height:${(s.h * 0.5).toFixed(1)}mm; }
      }`;
  }
  function clearPageSize() { if (styleTag) styleTag.textContent = ''; }

  async function printLabels(items) {
    const area = document.getElementById('printArea');
    if (!area) return;
    const s = await labelSize();
    applyPageSize(s);
    area.innerHTML = labelSheet(items, s);
    setTimeout(() => {
      window.print();
      // بنشيل القاعدة بعد الطباعة عشان الفواتير ترجع تطبع على ورقها
      setTimeout(clearPageSize, 800);
    }, 200);
  }

  return { svg, encode, labelSheet, printLabels, labelSize, saveLabelSize, DEFAULT_SIZE };
})();
