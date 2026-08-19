/* الاتصال بجوجل درايف من المتصفح (نسخة الموقع اللي بتشتغل على الموبايل)

   بنستعمل إذن "drive.file" بس — يعني البرنامج بيشوف ويعدّل الملفات اللي
   هو عملها لوحده، ومبيقدرش يبص على أي حاجة تانية في درايفك. ده أضيق
   إذن ممكن، وكمان مش محتاج مراجعة من جوجل.

   الملفات بتتحط في فولدر اسمه "مؤسسة المصطفى - مزامنة" في الدرايف. */

const Drive = (() => {
  const CLIENT_ID = '925013158685-utv7c8500qjc2ksa2ri96uek9sn4nh8j.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const FOLDER_NAME = 'مؤسسة المصطفى - مزامنة';
  const TOKEN_KEY = 'mostafaDriveToken';

  let token = null;          // { value, expiresAt }
  let folderId = null;
  let tokenClient = null;
  let gsiReady = false;

  // ---------- تحميل مكتبة جوجل ----------
  function loadGsi() {
    if (gsiReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        gsiReady = true; return resolve();
      }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => { gsiReady = true; resolve(); };
      s.onerror = () => reject(new Error('مفيش نت — مقدرناش نوصل لجوجل'));
      document.head.appendChild(s);
    });
  }

  function loadSavedToken() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const t = JSON.parse(raw);
      // بنسيب دقيقتين هامش قبل ما ينتهي
      if (t && t.value && t.expiresAt && Date.now() < t.expiresAt - 120000) return t;
    } catch (e) { }
    return null;
  }

  function saveToken(t) {
    token = t;
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch (e) { }
  }

  function isSignedIn() { return !!(token || loadSavedToken()); }

  function forget() {
    token = null; folderId = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { }
  }

  /* بيطلب إذن الدخول. لازم يتنده من ضغطة زرار حقيقية
     عشان المتصفح ما يمنعش النافذة المنبثقة. */
  async function signIn(silent) {
    const saved = loadSavedToken();
    if (saved) { token = saved; return true; }
    await loadGsi();

    return new Promise((resolve, reject) => {
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPE,
          callback: (resp) => {
            if (resp && resp.access_token) {
              saveToken({
                value: resp.access_token,
                expiresAt: Date.now() + (Number(resp.expires_in || 3600) * 1000)
              });
              resolve(true);
            } else {
              reject(new Error('الدخول اتلغى'));
            }
          },
          error_callback: () => reject(new Error('الدخول اتلغى'))
        });
      }
      tokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' });
    });
  }

  /* تجديد الإذن من غير ما يظهر أي حاجة للمستخدم.
     الإذن اللي جوجل بتديه بيخلص بعد ساعة، ومن غير التجديد ده كان
     البرنامج هيطلب تسجيل دخول كل شوية. بنستعمله في الخلفية بس —
     لو فشل، البرنامج بيفضل شغال بالبيانات اللي على الجهاز. */
  async function renewQuietly() {
    if (loadSavedToken()) { token = loadSavedToken(); return true; }
    try {
      await loadGsi();
    } catch (e) { return false; }
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
      try {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPE,
          callback: (resp) => {
            if (resp && resp.access_token) {
              saveToken({
                value: resp.access_token,
                expiresAt: Date.now() + (Number(resp.expires_in || 3600) * 1000)
              });
              finish(true);
            } else finish(false);
          },
          error_callback: () => finish(false)
        });
        client.requestAccessToken({ prompt: '' });
      } catch (e) { finish(false); }
      setTimeout(() => finish(false), 8000);
    });
  }

  // فيه إذن متخزن قبل كده؟ (حتى لو خلص وقته)
  function wasConnected() {
    try { return !!localStorage.getItem(TOKEN_KEY); } catch (e) { return false; }
  }

  async function auth() {
    const t = token || loadSavedToken();
    if (!t) throw new Error('لسه مش داخل على جوجل');
    token = t;
    return t.value;
  }

  async function api(url, options) {
    const access = await auth();
    const opts = Object.assign({}, options || {});
    opts.headers = Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + access });
    const res = await fetch(url, opts);
    if (res.status === 401) { forget(); throw new Error('انتهى الاتصال بجوجل — سجّل دخول تاني'); }
    if (!res.ok) throw new Error('جوجل ردت بخطأ ' + res.status);
    return res;
  }

  // ---------- الفولدر ----------
  async function ensureFolder() {
    if (folderId) return folderId;
    const q = encodeURIComponent(
      "mimeType='application/vnd.google-apps.folder' and name='" + FOLDER_NAME + "' and trashed=false");
    const res = await api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name)');
    const found = (await res.json()).files;
    if (found && found.length) { folderId = found[0].id; return folderId; }

    const create = await api('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    folderId = (await create.json()).id;
    return folderId;
  }

  // ---------- الملفات ----------
  async function list() {
    const fid = await ensureFolder();
    const q = encodeURIComponent("'" + fid + "' in parents and trashed=false");
    const res = await api('https://www.googleapis.com/drive/v3/files?q=' + q +
                          '&fields=files(id,name,modifiedTime,size)&orderBy=name');
    return (await res.json()).files || [];
  }

  async function readFile(fileId) {
    const res = await api('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media');
    return res.json();
  }

  /* بيكتب ملف باسم معيّن — بيعدّل الموجود أو يعمل جديد */
  async function writeFile(name, obj) {
    const fid = await ensureFolder();
    const files = await list();
    const existing = files.find(f => f.name === name);
    const body = JSON.stringify(obj);

    const boundary = 'mostafa' + Date.now();
    const meta = existing
      ? { name }
      : { name, parents: [fid] };
    const multipart =
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(meta) + '\r\n' +
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      body + '\r\n' +
      '--' + boundary + '--';

    const url = existing
      ? 'https://www.googleapis.com/upload/drive/v3/files/' + existing.id + '?uploadType=multipart'
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

    await api(url, {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
      body: multipart
    });
    return true;
  }

  return { signIn, renewQuietly, wasConnected, isSignedIn, forget, list, readFile, writeFile, ensureFolder, FOLDER_NAME };
})();
