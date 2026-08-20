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

  /* ورقة ملصقات جاهزة للطباعة */
  function labelSheet(items) {
    const cells = [];
    for (const it of items) {
      const count = Math.max(1, Number(it.count) || 1);
      for (let i = 0; i < count; i++) {
        let code = '';
        try { code = svg(it.barcode, { height: 40, moduleWidth: 1.4 }); }
        catch (e) { code = `<div class="lbl-err">الباركود فيه حروف عربية — غيّره لأرقام</div>`; }
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

  function printLabels(items) {
    const area = document.getElementById('printArea');
    if (!area) return;
    area.innerHTML = labelSheet(items);
    setTimeout(() => window.print(), 200);
  }

  return { svg, encode, labelSheet, printLabels };
})();
