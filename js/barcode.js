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
  const START_C = 105;
  const CODE_B = 100;
  const CODE_C = 99;
  const STOP = 106;

  /* بيحوّل النص لأرقام الرموز، وبيحسب رقم التحقق اللي القارئ بيتأكد بيه.

     في CODE-128 نظامين بنستعملهم:
       B = حرف لكل رمز (بيشيل أرقام وحروف إنجليزية)
       C = رقمين لكل رمز (أرقام بس)

     باركود الشركة بيبقى ١٣ رقم، وبنظام B كان بيطلع عريض أوي فيملا
     الملصق من الحرف للحرف — والليزر مش بيقرا كده لأنه محتاج هامش
     أبيض على الجنبين. نظام C بيقصّره حوالي الثلث فيدخل مظبوط. */
  function encode(text) {
    const s = String(text);
    for (const ch of s) {
      const v = ch.charCodeAt(0);
      if (v < 32 || v > 126) throw new Error('الباركود لازم يكون أرقام أو حروف إنجليزية');
    }

    const isDigit = (c) => c >= '0' && c <= '9';
    const digitRun = (i) => { let n = 0; while (i + n < s.length && isDigit(s[i + n])) n++; return n; };

    const codes = [];
    let mode;
    const lead = digitRun(0);
    // بنبدأ بنظام C لو أول ٤ أرقام (أو لو الباركود كله أرقام وعددها زوجي)
    if (lead >= 4 || (lead === s.length && s.length >= 2 && s.length % 2 === 0)) {
      codes.push(START_C); mode = 'C';
    } else {
      codes.push(START_B); mode = 'B';
    }

    let i = 0;
    while (i < s.length) {
      if (mode === 'C') {
        if (digitRun(i) >= 2) { codes.push(Number(s.substr(i, 2))); i += 2; }
        else { codes.push(CODE_B); mode = 'B'; }
      } else {
        const run = digitRun(i);
        // نرجع لـ C بس لو المكسب يستاهل تكلفة رمز التحويل
        if (run >= 6 || (run >= 4 && i + run === s.length && run % 2 === 0)) {
          codes.push(CODE_C); mode = 'C';
        } else {
          codes.push(s.charCodeAt(i) - 32); i++;
        }
      }
    }

    let sum = codes[0];
    for (let k = 1; k < codes.length; k++) sum += codes[k] * k;
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

  /* اسم المحل اللي فوق الملصق. الاسم الرسمي طويل ومش هيدخل في ٤ سم،
     فبناخد أول كلمتين منه كافتراضي — وهو يقدر يكتب اللي هو عايزه. */
  function shortShopName(full) {
    const t = String(full || '').trim();
    if (!t) return '';
    const words = t.split(/\s+/);
    return words.length <= 2 ? t : words.slice(0, 2).join(' ');
  }
  async function labelShop() {
    const rec = await DB.get('settings', 'labelShopName');
    if (rec && typeof rec.value === 'string') return rec.value;
    const c = await DB.get('company', 1);
    return shortShopName(c && c.name);
  }
  function saveLabelShop(name) {
    return DB.put('settings', { key: 'labelShopName', value: String(name || '') });
  }

  /* سطر الأسعار.
     الصنف العادي: سعر واحد.
     الصنف اللي بيتباع بالوحدة وبالعبوة (سلك بالمتر وباللفة، مسامير
     بالكيلو وبالعلبة): السعرين جنب بعض عشان الزبون يشوف الاتنين. */
  function priceLine(it) {
    const unitPrice = Number(it.price || 0);
    const packPrice = Number(it.packPrice || 0);
    const unit = String(it.unit || '').trim();
    const packName = String(it.packName || '').trim();

    if (packPrice > 0 && packName) {
      return `<div class="lbl-prices two">
        <span class="lbl-p"><b>${unitPrice.toFixed(2)}</b> ال${Utils.escapeHtml(unit || 'وحدة')}</span>
        <span class="lbl-sep"></span>
        <span class="lbl-p"><b>${packPrice.toFixed(2)}</b> ال${Utils.escapeHtml(packName)}</span>
      </div>`;
    }
    if (unitPrice > 0) {
      return `<div class="lbl-prices"><span class="lbl-p one">
        <b>${unitPrice.toFixed(2)}</b> ج.م${unit ? ' / ال' + Utils.escapeHtml(unit) : ''}
      </span></div>`;
    }
    return '';
  }

  /* الملصقات جاهزة للطباعة على رول الطابعة الحرارية.
     كل ملصق صفحة لوحده — الطابعة بتقف عند نهاية كل واحد. */
  function labelSheet(items, size, shop) {
    const s = size || DEFAULT_SIZE;
    // الباركود بياخد حوالي ثلث طول الملصق، والباقي للاسم والأسعار
    const barH = Math.max(20, Math.round(s.h * 0.34 * 3.78));   // مم → بكسل
    /* عرض الشريطة الواحدة. الباركود القصير كان بيطلع ضيّق في نص
       الملصق وحواليه فاضي — بنعرّض الشرايط شوية عشان يملا العرض،
       وده كمان بيخلي الليزر يقراه أسهل. العرض مقفول بـ max-width
       فالباركود الطويل مش هيخرج برة. */
    const mw = s.w <= 32 ? 1.05 : (s.w <= 45 ? 1.45 : 1.75);
    const shopName = String(shop || '').trim();

    const cells = [];
    for (const it of items) {
      const count = Math.max(1, Number(it.count) || 1);
      let code = '';
      try { code = svg(it.barcode, { height: barH, moduleWidth: mw, showText: true }); }
      catch (e) { code = `<div class="lbl-err">الباركود فيه حروف عربية — غيّره لأرقام</div>`; }
      const prices = priceLine(it);
      // الاسم الطويل بياخد مقاس أصغر بدل ما يتقص بالنقط
      const nm = String(it.name || '').trim();
      const nameCls = nm.length > 15 ? 'lbl-name long' : 'lbl-name';
      for (let i = 0; i < count; i++) {
        cells.push(`
          <div class="lbl">
            ${shopName ? `<div class="lbl-shop">${Utils.escapeHtml(shopName)}</div>` : ''}
            <div class="${nameCls}">${Utils.escapeHtml(nm)}</div>
            <div class="lbl-code">${code}</div>
            ${prices}
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
        /* لازم نشيل شاشة البرنامج من الحسبة خالص (display:none مش
           visibility:hidden) — لأن الشاشة بتفضل واخدة مساحتها في
           الصفحة، وعلى ورق ٢.٥ سم دي بتطلع صفحة زيادة فاضية. */
        .app-shell{ display:none !important; }
        /* الأهم: البرنامج مظبّط html و body على height:100% عشان
           الشاشة، ودي بتخلي الورقة كلها بطول صفحة واحدة — فالملصقات
           كانت بتتكوّم فوق بعض في صفحة واحدة بدل ما كل واحد يطلع
           في ورقة. لازم نحرّر الطول وقت طباعة الملصقات. */
        html, body{ height:auto !important; min-height:0 !important;
                    overflow:visible !important;
                    margin:0 !important; padding:0 !important; }
        .print-only{ position:static !important; padding:0 !important;
                     width:auto !important; height:auto !important; }
        .lbl-sheet{ display:block; gap:0; }
        .lbl{
          width:${s.w}mm; height:${s.h}mm;
          border:none; border-radius:0; margin:0;
          padding:${padV}mm ${padH}mm;
          display:flex; flex-direction:column;
          align-items:center; justify-content:center;
          gap:${(s.h * 0.022).toFixed(2)}mm;
          page-break-after:always; break-after:page; overflow:hidden;
        }
        .lbl:last-child{ page-break-after:auto; break-after:auto; }
        /* ٨٦٪ مش ١٠٠٪: الليزر محتاج هامش أبيض على جنبي الباركود عشان
           يعرف فين بدايته وفين نهايته. من غيره باركود الشركة الطويل
           كان بيلزق في حرف الملصق ومبيتقريش. */
        .lbl-code{ width:100%; }
        .lbl-code svg{ max-width:86%; max-height:${(s.h * 0.40).toFixed(1)}mm; }
        /* المقاسات بتتحسب من طول الملصق عشان لو غيّر الرول تفضل مظبوطة.
           الترتيب في الأهمية: اسم الصنف (البياع بيقراه)، السعر (الزبون
           بيقراه)، وبعدين اسم المحل كترويسة واضحة فوق. */
        .lbl-shop{ font-size:${(s.h * 0.090).toFixed(2)}mm;
                   padding-bottom:${(s.h * 0.020).toFixed(2)}mm;
                   border-bottom:0.2mm solid #000; width:100%; }
        .lbl-name{ font-size:${(s.h * 0.115).toFixed(2)}mm; }
        .lbl-name.long{ font-size:${(s.h * 0.092).toFixed(2)}mm; }
        .lbl-prices{ font-size:${(s.h * 0.088).toFixed(2)}mm; }
        .lbl-prices .lbl-p b{ font-size:${(s.h * 0.125).toFixed(2)}mm; }
        /* السعرين مع بعض محتاجين عرض أكتر، فبيفضلوا بمقاسهم القديم
           المجرَّب عشان السطر ما يخرجش برة الملصق */
        .lbl-prices.two{ font-size:${(s.h * 0.078).toFixed(2)}mm; }
        .lbl-prices.two .lbl-p b{ font-size:${(s.h * 0.098).toFixed(2)}mm; }
      }`;
  }
  function clearPageSize() { if (styleTag) styleTag.textContent = ''; }

  async function printLabels(items) {
    const area = document.getElementById('printArea');
    if (!area) return;
    const s = await labelSize();
    const shop = await labelShop();
    applyPageSize(s);
    area.innerHTML = labelSheet(items, s, shop);
    setTimeout(() => window.print(), 200);
    /* مبنشيلش قاعدة المقاس بعد وقت معيّن.

       مع الطباعة الصامتة (kiosk-printing) الأمر بيرجع فورًا والطباعة
       بتتم في الخلفية — فلو شلنا القاعدة بعد شوية، كروم ممكن يكون
       لسه بيجهّز الورق ويلاقي المقاس اتشال، فيطبع كل الملصقات على
       صفحة واحدة. بنسيبها، والفواتير هي اللي بتشيلها قبل ما تطبع. */
  }

  return { svg, encode, labelSheet, printLabels, labelSize, saveLabelSize,
           labelShop, saveLabelShop, shortShopName, clearPageSize, DEFAULT_SIZE };
})();
