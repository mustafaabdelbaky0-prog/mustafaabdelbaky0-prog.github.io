Modules.company = (() => {

  async function render(container) {
    const c = AppState.company || {};
    const cashBal = await Services.getCashBalance();

    container.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <div class="section-head"><h3>بيانات المؤسسة</h3></div>
          <form id="companyForm">
            <div class="field">
              <label>اسم المؤسسة</label>
              <input type="text" id="cName" value="${Utils.escapeHtml(c.name || 'مؤسسة المصطفى للأدوات الكهربائية والحدايد')}" required>
            </div>
            <div class="field-row">
              <div class="field">
                <label>رقم التليفون</label>
                <input type="text" id="cPhone" value="${Utils.escapeHtml(c.phone || '')}">
              </div>
            </div>
            <div class="field">
              <label>العنوان</label>
              <input type="text" id="cAddress" value="${Utils.escapeHtml(c.address || '')}">
            </div>
            <div class="field">
              <label>ملاحظة تظهر أسفل الفاتورة (اختياري)</label>
              <input type="text" id="cNote" value="${Utils.escapeHtml(c.note || '')}" placeholder="شكرًا لتعاملكم معنا">
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-amber">حفظ البيانات</button>
            </div>
          </form>
        </div>

        <div class="card">
          <div class="section-head"><h3>رصيد الخزنة الافتتاحي</h3></div>
          ${cashBal !== 0 ? `
            <p class="muted" style="font-size:13.5px;line-height:1.8;">
              رصيد الخزنة الحالي: <strong>${Utils.formatMoney(cashBal)}</strong><br>
              تم ضبط رصيد افتتاحي قبل كده. أي تعديل تاني يبقى من شاشة "الخزنة" (إيداع/سحب).
            </p>
          ` : `
            <p class="muted" style="font-size:13px;margin-bottom:12px;">
              اكتب المبلغ اللي هتبدأ بيه الخزنة النهاردة (الكاش اللي معاك في المحل). هيتسجل مرة واحدة بس.
            </p>
            <form id="openingForm">
              <div class="field">
                <label>الرصيد الافتتاحي (ج.م)</label>
                <input type="number" id="openingAmount" min="0" step="0.01" placeholder="0.00">
              </div>
              <div class="form-actions">
                <button type="submit" class="btn btn-primary">تسجيل الرصيد الافتتاحي</button>
              </div>
            </form>
          `}
        </div>

        <div class="card">
          <div class="section-head"><h3>صاحب المحل والبائع</h3></div>
          <p class="muted" style="font-size:13px;line-height:1.9;margin-bottom:10px;">
            البرنامج بيفتح على <strong>وضع البائع</strong> في كل مرة،
            وانت بتدخل بكلمة السر من الزرار اللي فوق لما تحتاج.
            من هنا بتغيّر كلمة السر بس — مينفعش تشيلها خالص عشان
            الشاشات الحساسة ماتفضلش مفتوحة لأي حد.
          </p>
          <div class="role-table">
            <div class="role-col">
              <div class="role-head owner">👤 صاحب المحل</div>
              <div class="role-body">الأرباح والخسائر · الخزنة · المشتريات والتكلفة ·
                المصروفات · حسابات الموردين · الأصول · الإعدادات · إلغاء الفواتير</div>
            </div>
            <div class="role-col">
              <div class="role-head seller">🔒 البائع</div>
              <div class="role-body">نقطة البيع · مرتجعات العملاء · حسابات العملاء ·
                الأصناف بسعر البيع بس · أرصدة المخزون</div>
            </div>
          </div>
          <div class="hint" style="margin:10px 0 12px;line-height:1.9;">
            البائع <strong>مش هيشوف</strong> سعر التكلفة ولا الربح ولا رصيد الخزنة.
            ولو سبت الجهاز ربع ساعة وانت داخل، البرنامج بيرجع لوضع البائع لوحده.
          </div>
          <div id="pinStatus"></div>
          <form id="pinSetForm" style="margin-top:12px;">
            <div class="field-row">
              <div class="field">
                <label id="pinLabel">كلمة السر الجديدة</label>
                <input type="password" id="newPin" inputmode="numeric" placeholder="4 أرقام أو أكتر" autocomplete="one-time-code" name="np1">
              </div>
              <div class="field">
                <label>تأكيد</label>
                <input type="password" id="newPin2" inputmode="numeric" placeholder="اكتبها تاني" autocomplete="one-time-code" name="np2">
              </div>
            </div>
            <div class="tag-row">
              <button type="submit" class="btn btn-amber">حفظ كلمة السر</button>
            </div>
          </form>
        </div>

        <div class="card">
          <div class="section-head">
            <h3>المزامنة مع الموبايل</h3>
            <button class="btn btn-ghost btn-sm" id="syncNow">زامن دلوقتي</button>
          </div>
          <p class="muted" style="font-size:13px;line-height:1.9;margin-bottom:10px;">
            عشان تشتغل من الموبايل وإنت بره وتلاقي الشغل هنا لما ترجع،
            لازم الكمبيوتر والموبايل يبقوا مربوطين بنفس حساب جوجل.
          </p>
          <div id="syncStatus"><div class="empty-state" style="padding:18px;">بيشوف الحالة...</div></div>
        </div>

        <div class="card">
          <div class="section-head">
            <h3>ملف الإكسيل على جوجل درايف</h3>
            <button class="btn btn-ghost btn-sm" id="reportNow">حدّثه دلوقتي</button>
          </div>
          <p class="muted" style="font-size:13px;line-height:1.9;margin-bottom:10px;">
            البرنامج بيعمل ملف إكسيل باسم <strong>مؤسسة المصطفى</strong> فيه كل حاجة —
            المبيعات والمشتريات والمخزون والخزنة وحسابات العملاء والموردين.
            بيتحدّث لوحده كل ما تشتغل، وبيترفع على الدرايف أول ما ييجي نت.
          </p>
          <div id="reportStatus"><div class="empty-state" style="padding:18px;">بيشوف الحالة...</div></div>
        </div>

        <div class="card">
          <div class="section-head">
            <h3>النسخ الاحتياطي</h3>
            <button class="btn btn-ghost btn-sm" id="backupNow">انسخ دلوقتي</button>
          </div>
          <div id="backupStatus"><div class="empty-state" style="padding:18px;">بيشوف حالة النسخ...</div></div>
          <button class="btn btn-primary btn-block" id="exportBtn" style="margin-top:14px;">⬇️ نزّل نسخة على الجهاز ده</button>
          <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line);">
            <p class="muted" style="font-size:13px;margin-bottom:10px;">استرجاع نسخة محفوظة قبل كده:</p>
            <input type="file" id="importFile" accept="application/json,.json" style="font-size:13px;">
            <div class="hint" style="color:var(--danger);margin-top:8px;">
              تحذير: الاسترجاع هيمسح البيانات الحالية ويحط مكانها اللي في الملف.
            </div>
          </div>
        </div>
      </div>
    `;

    // ---------- كلمة السر ----------
    async function refreshPinStatus() {
      const on = Auth.isEnabled();
      container.querySelector('#pinStatus').innerHTML = on
        ? `<div class="notice notice-ok">🔒 الصلاحيات شغالة — البرنامج بيفتح على وضع البائع</div>`
        : `<div class="notice notice-warn">🔓 مفيش كلمة سر — أي حد يفتح البرنامج يشوف أرباحك ورصيد خزنتك</div>`;
      const lbl = container.querySelector('#pinLabel');
      if (lbl) lbl.textContent = on ? 'كلمة سر جديدة (هتستبدل القديمة)' : 'كلمة سر صاحب المحل';
    }
    refreshPinStatus();

    container.querySelector('#pinSetForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const p1 = container.querySelector('#newPin').value.trim();
      const p2 = container.querySelector('#newPin2').value.trim();
      if (p1.length < 4) { Utils.toast('كلمة السر لازم 4 أرقام على الأقل', 'error'); return; }
      if (p1 !== p2) { Utils.toast('الكلمتين مش زي بعض', 'error'); return; }
      // لو فيه كلمة قديمة، لازم يعرفها الأول
      if (await Lock.isEnabled() && !(await Lock.require('تغيير كلمة السر'))) return;
      await Lock.setPin(p1);
      container.querySelector('#newPin').value = '';
      container.querySelector('#newPin2').value = '';
      Utils.toast('اتحفظت كلمة السر', 'success');
      refreshPinStatus();
    });

    // نسخة الموقع (الموبايل) مالهاش سيرفر محلي — فالكروت اللي بتسأله
    // بتتبدل بحالة المزامنة مع الدرايف.
    const onWeb = typeof window !== 'undefined' && !!window.DB_BACKEND;

    // ---------- المزامنة مع الأجهزة التانية ----------
    async function loadSyncStatus() {
      const box = container.querySelector('#syncStatus');
      if (!box) return;
      const s = DriveSync.getStatus();

      if (!Drive.isSignedIn()) {
        box.innerHTML = `
          <div class="notice notice-warn" style="line-height:1.95;">
            🔓 <strong>لسه مش مربوط.</strong><br>
            الشغل اللي هنا مش بيوصل للموبايل، واللي على الموبايل مش بيوصل هنا.
          </div>
          <button class="btn btn-amber btn-block" id="driveConnect" style="margin-top:12px;">
            اربط بحساب جوجل
          </button>
          <div class="hint" style="margin-top:10px;line-height:1.9;">
            استعمل <strong>نفس الحساب</strong> اللي هتدخل بيه من الموبايل.
            البرنامج بيشوف الملفات اللي بيعملها هو بس في درايفك.
          </div>`;
        const btn = box.querySelector('#driveConnect');
        btn.addEventListener('click', async () => {
          btn.disabled = true; btn.textContent = 'بيفتح جوجل...';
          try {
            await Drive.signIn(false);
            await DriveSync.runOnce(false);
            DriveSync.start();
            Utils.toast('اتربط بجوجل درايف', 'success');
          } catch (e) {
            Utils.toast(e.message || 'الربط مانجحش', 'error');
          }
          btn.disabled = false; btn.textContent = 'اربط بحساب جوجل';
          loadSyncStatus();
        });
        return;
      }

      box.innerHTML = `
        <div class="notice ${s.error ? 'notice-warn' : 'notice-ok'}" style="line-height:1.95;">
          ${s.error ? '⚠️ ' + Utils.escapeHtml(s.error) : '✅ مربوط بجوجل درايف'}
          ${s.lastSync ? `<br><span style="font-size:12px;">آخر مزامنة: ${Utils.escapeHtml(Utils.formatDateTime(s.lastSync))}</span>` : ''}
        </div>
        <div class="hint" style="line-height:1.95;margin-top:8px;">
          الجهاز ده رقمه <strong>${Device.current()}</strong> (${Utils.escapeHtml(Device.currentName())}).
          ${s.devices ? `<br>أجهزة تانية مربوطة: <strong>${s.devices}</strong>` : '<br>لسه مفيش أجهزة تانية مربوطة.'}
        </div>
        <button class="btn btn-ghost btn-block" id="driveOff" style="margin-top:12px;">افصل الربط</button>`;
      box.querySelector('#driveOff').addEventListener('click', async () => {
        if (!(await Utils.confirmDialog('هتفصل الربط بجوجل درايف؟ الشغل هيفضل على الجهاز ده بس.'))) return;
        Drive.forget(); DriveSync.stop();
        Utils.toast('اتفصل الربط', 'info');
        loadSyncStatus();
      });
    }
    if (!onWeb) {
      loadSyncStatus();
      const sn = container.querySelector('#syncNow');
      if (sn) sn.addEventListener('click', async () => {
        sn.disabled = true;
        const added = await DriveSync.runOnce(true);
        sn.disabled = false;
        const m = DriveSync.explain(added);
        Utils.toast(m.text, m.kind);
        loadSyncStatus();
      });
    } else {
      const card = container.querySelector('#syncStatus');
      if (card && card.closest('.card')) card.closest('.card').style.display = 'none';
    }

    // ---------- ملف الإكسيل على السحابة ----------
    async function loadReportStatus() {
      const box = container.querySelector('#reportStatus');
      if (!box) return;

      if (onWeb) {
        const head = container.querySelector('#reportNow');
        if (head) head.textContent = 'زامن دلوقتي';
        const s = (typeof DriveSync !== 'undefined') ? DriveSync.getStatus() : null;
        if (!s || !s.signedIn) {
          box.innerHTML = `<div class="notice notice-warn">🔓 مش متصل بجوجل درايف</div>`;
          return;
        }
        box.innerHTML = `
          <div class="notice ${s.error ? 'notice-warn' : 'notice-ok'}" style="line-height:1.95;">
            ${s.error ? '⚠️ ' + Utils.escapeHtml(s.error)
                      : '✅ متصل بجوجل درايف'}
            ${s.lastSync ? `<br><span style="font-size:12px;">آخر مزامنة: ${Utils.escapeHtml(Utils.formatDateTime(s.lastSync))}</span>` : ''}
            ${s.pending ? '<br><span style="font-size:12px;">فيه شغل لسه مترفعش — هيترفع أول ما ييجي نت</span>' : ''}
          </div>
          <div class="hint" style="line-height:1.95;margin-top:8px;">
            الشغل اللي بتعمله هنا بيتحفظ على الموبايل على طول، وبيروح للدرايف
            أول ما يبقى فيه نت. وكمبيوتر المحل بيسحبه لوحده.
            ${s.devices ? `<br>أجهزة تانية مربوطة: <strong>${s.devices}</strong>` : ''}
          </div>`;
        return;
      }

      try {
        const info = await fetch('api/report', { cache: 'no-store' }).then(r => r.json());
        let html = '';

        if (info.connected) {
          html += info.cloud.map(c => `
            <div class="notice notice-ok" style="margin-bottom:8px;">
              ✅ مربوط بـ <strong>${Utils.escapeHtml(c.kind)}</strong>
              ${c.last ? `<br><span style="font-size:12px;">آخر رفع: ${Utils.escapeHtml(c.last)}</span>` : ''}
              <br><span class="muted" style="font-size:11.5px;">${Utils.escapeHtml(c.path)}</span>
            </div>`).join('');
          html += `<div class="hint" style="line-height:1.9;">
            افتح تطبيق <strong>جوجل درايف</strong> من موبايلك وهتلاقي فولدر
            «مؤسسة المصطفى» جواه الملف. لو النت فاصل، الملف بيستنى وبيترفع لوحده أول ما ييجي نت.
          </div>`;
        } else {
          html += `
            <div class="notice notice-warn" style="line-height:2;">
              ⚠️ <strong>لسه مش مربوط بجوجل درايف.</strong><br>
              الملف بيتعمل على الكمبيوتر بس، ومش بيترفع لحد دلوقتي.
            </div>
            <div class="hint" style="line-height:2.1;margin-top:10px;">
              عشان يترفع لوحده، سطّب <strong>Google Drive للكمبيوتر</strong> مرة واحدة:
              <br>١) ادخل <strong>google.com/drive/download</strong> ونزّل البرنامج.
              <br>٢) سطّبه وسجّل دخول بحساب جوجل بتاعك.
              <br>٣) هيظهر فولدر جوجل درايف على الكمبيوتر — وخلاص.
              <br>بعد كده البرنامج هيحط الملف جواه لوحده، وجوجل هي اللي هترفعه.
            </div>`;
        }

        html += `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line);">
          <p class="muted" style="font-size:12.5px;line-height:1.9;">
            نسخة على الكمبيوتر:<br>
            <span style="font-size:11.5px;">${Utils.escapeHtml(info.localPath || '—')}</span>
            ${info.localLast ? `<br>آخر تحديث: <strong>${Utils.escapeHtml(info.localLast)}</strong>` : ''}
          </p></div>`;

        if (info.error) {
          html += `<div class="notice notice-warn" style="margin-top:10px;">مشكلة وقت عمل الملف: ${Utils.escapeHtml(info.error)}</div>`;
        }
        box.innerHTML = html;
      } catch (e) {
        box.innerHTML = `<div class="notice notice-warn">مقدرناش نجيب حالة ملف الإكسيل</div>`;
      }
    }
    loadReportStatus();

    container.querySelector('#reportNow').addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = onWeb ? 'بيزامن...' : 'بيحدّث...';
      try {
        if (onWeb) {
          const added = await DriveSync.runOnce(false);
          const s = DriveSync.getStatus();
          if (s.error) Utils.toast(s.error, 'error');
          else if (added === 0) Utils.toast('كل حاجة متزامنة', 'info');
        } else {
          await fetch('api/report', { method: 'POST' });
          Utils.toast('اتحدّث ملف الإكسيل', 'success');
        }
      } catch (err) {
        Utils.toast(onWeb ? 'مقدرناش نزامن' : 'مقدرناش نحدّث الملف', 'error');
      }
      btn.disabled = false;
      btn.textContent = old;
      loadReportStatus();
    });

    // حالة النسخ الاحتياطي — بتوضح لو فيه نسخة برّه الجهاز ولا لأ
    async function loadBackupStatus() {
      const box = container.querySelector('#backupStatus');
      if (!box) return;

      if (onWeb) {
        // النسخ الاحتياطي شغلانة كمبيوتر المحل — مش بتتعمل من الموبايل
        const card = box.closest('.card');
        if (card) card.style.display = 'none';
        return;
      }

      try {
        const info = await fetch('api/backup', { cache: 'no-store' }).then(r => r.json());
        const rows = (info.targets || []).map(t => `
          <div class="bk-row ${t.safe ? 'bk-safe' : ''}">
            <div>
              <div class="bk-kind">${t.safe ? '💾' : '📁'} ${Utils.escapeHtml(t.kind)}</div>
              <div class="bk-path">${Utils.escapeHtml(t.path)}</div>
            </div>
            <div class="bk-time">${t.last ? Utils.escapeHtml(t.last) : '<span class="muted">لسه</span>'}</div>
          </div>`).join('');

        box.innerHTML = `
          ${info.hasExternal
            ? `<div class="notice notice-ok">بياناتك متنسخة على فلاشة برّه الجهاز ✅</div>`
            : `<div class="notice notice-warn">
                 <strong>مفيش نسخة برّه الجهاز.</strong><br>
                 كل النسخ دلوقتي على نفس الهارد — لو الهارد باظ هتضيع معاه.
                 <strong>حط فلاشة في الكمبيوتر</strong> والبرنامج هينسخ عليها لوحده كل شوية.
               </div>`}
          <div class="bk-list">${rows}</div>`;
      } catch (e) {
        box.innerHTML = `<div class="notice notice-warn">مقدرناش نجيب حالة النسخ الاحتياطي</div>`;
      }
    }
    loadBackupStatus();

    container.querySelector('#backupNow').addEventListener('click', async (e) => {
      const b = e.target; b.disabled = true; b.textContent = 'بينسخ...';
      try {
        await fetch('api/backup', { method: 'POST' });
        Utils.toast('تم النسخ', 'success');
      } catch (err) { Utils.toast('النسخ مانجحش', 'error'); }
      b.disabled = false; b.textContent = 'انسخ دلوقتي';
      loadBackupStatus();
    });

    container.querySelector('#exportBtn').addEventListener('click', async () => {
      const backup = await Services.exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `نسخة-احتياطية-${Utils.todayISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      Utils.toast('تم حفظ النسخة الاحتياطية', 'success');
    });

    container.querySelector('#importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const ok = await Utils.confirmDialog('هيتم مسح البيانات الحالية واستبدالها باللي في الملف. متأكد؟');
      if (!ok) { e.target.value = ''; return; }
      try {
        const backup = JSON.parse(await file.text());
        await Services.importBackup(backup);
        await AppState.reloadItems();
        await AppState.reloadParties();
        await AppState.reloadCompany();
        await refreshShell();
        Utils.toast('تم استرجاع النسخة الاحتياطية', 'success');
        render(container);
      } catch (err) {
        Utils.toast('الملف غير صالح: ' + err.message, 'error');
      }
      e.target.value = '';
    });

    container.querySelector('#companyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = container.querySelector('#cName').value.trim();
      if (!name) { Utils.toast('اسم المؤسسة مطلوب', 'error'); return; }
      await DB.put('company', {
        id: 1,
        name,
        phone: container.querySelector('#cPhone').value.trim(),
        address: container.querySelector('#cAddress').value.trim(),
        note: container.querySelector('#cNote').value.trim()
      });
      await AppState.reloadCompany();
      Utils.toast('تم حفظ بيانات المؤسسة', 'success');
    });

    const openingForm = container.querySelector('#openingForm');
    if (openingForm) {
      openingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = Number(container.querySelector('#openingAmount').value || 0);
        if (amount < 0) { Utils.toast('قيمة غير صحيحة', 'error'); return; }
        await Services.setOpeningCashBalance(amount);
        await refreshShell();
        Utils.toast('تم تسجيل الرصيد الافتتاحي', 'success');
        render(container);
      });
    }
  }

  return { render };
})();
