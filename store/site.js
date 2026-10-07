
(function(){
  var KEY='mostafaCart';
  var cart={};
  try{ cart=JSON.parse(localStorage.getItem(KEY)||'{}')||{}; }catch(e){ cart={}; }

  var money=function(n){ return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); };
  var $=function(id){ return document.getElementById(id); };
  function save(){ try{ localStorage.setItem(KEY,JSON.stringify(cart)); }catch(e){} }
  function count(){ var n=0; for(var k in cart) n+=cart[k].qty; return n; }
  function total(){ var t=0; for(var k in cart) t+=cart[k].qty*cart[k].price; return Math.round(t*100)/100; }

  function paint(){
    $('cartCount').textContent=count();
    var box=$('cartList');
    var keys=Object.keys(cart);
    if(!keys.length){ box.innerHTML='<p class="empty-cart">السلة فاضية — ضيف اللي محتاجه من المنتجات.</p>'; }
    else{
      box.innerHTML=keys.map(function(k){
        var it=cart[k];
        return '<div class="line" data-k="'+k.replace(/"/g,'&quot;')+'">'+
          '<div class="line-n">'+it.name+'<small>'+money(it.price)+' ج.م</small></div>'+
          '<div class="qty"><button type="button" data-d="-1">−</button><span>'+it.qty+'</span>'+
          '<button type="button" data-d="1">+</button></div></div>';
      }).join('');
    }
    var t=money(total())+' ج.م';
    $('cartTotal').textContent=t; $('orderTotal').textContent=t;
    document.querySelectorAll('.add').forEach(function(b){
      b.classList.toggle('in', !!cart[b.dataset.name]);
      b.textContent = cart[b.dataset.name] ? ('في الطلب ('+cart[b.dataset.name].qty+')') : 'أضف للطلب';
    });
  }

  function add(name,price,qty){
    var n=Math.max(1,Number(qty)||1);
    if(!cart[name]) cart[name]={name:name,price:Number(price)||0,qty:0};
    cart[name].qty+=n; save(); paint();
  }

  document.addEventListener('click',function(e){
    var a=e.target.closest('.add');
    if(a){ add(a.dataset.name, a.dataset.price); open('drawer'); return; }
    if(e.target.closest('[data-close]')){ closeAll(); return; }
    var q=e.target.closest('.qty button');
    if(q){
      var k=q.closest('.line').dataset.k;
      if(cart[k]){ cart[k].qty+=Number(q.dataset.d); if(cart[k].qty<=0) delete cart[k]; save(); paint(); }
      return;
    }
    var c=e.target.closest('.cat');
    if(c){ document.querySelectorAll('.cat').forEach(function(x){ x.classList.toggle('on', x===c); });
           sel=c.dataset.sec||''; sub=''; drawSubs(); apply(); return; }
    var sc=e.target.closest('.seccard');
    if(sc){
      var id=sc.dataset.sec;
      if(!sel){ sel=id; document.querySelectorAll('.cat').forEach(function(x){ x.classList.toggle('on', x.dataset.sec===id); }); }
      else { sub = (sub===id) ? '' : id; }
      drawSubs(); apply();
      var g=$('grid'); if(g) g.scrollIntoView({behavior:'smooth',block:'start'});
      return;
    }
    var po=e.target.closest('.card-open');
    if(po){ openProduct(po.closest('.card')); return; }
  });

  /* ===== الأقسام والبحث =====
     القسم الرئيسي بيوري اللي جواه كله (الأقسام اللي تحته ومنتجاتها)،
     والبحث بيدوّر في كل حاجة من غير ما يهتم بالأقسام. */
  var sel='', sub='', q='';
  var TREE={};
  try{ TREE=JSON.parse(($('secGrid')||{dataset:{}}).dataset.tree||'{}'); }catch(e){ TREE={}; }

  /* كروت الأقسام: بتوري اللي جوه القسم المفتوح. لو واقف على "كل
     الأقسام" بتوري الأقسام الرئيسية، ولو فتح "كهرباء" بتوري اللي
     جواها (اي لوك، اليوس...). */
  function drawSubs(){
    var box=$('secGrid'); if(!box) return;
    var kids=TREE[sub||sel||'']||[];
    if(!kids.length){ box.hidden=true; box.innerHTML=''; return; }
    box.hidden=false;
    box.innerHTML=kids.map(function(k){
      var on = (sub||sel)===String(k.id);
      return '<button type="button" class="seccard'+(on?' on':'')+'" data-sec="'+k.id+'">'+
        '<span class="sc-img'+(k.img?'':' is-empty')+'">'+(k.img
          ? '<img src="img/'+k.img+'" alt="'+k.name+'" loading="lazy">'
          : '<span class="sc-ph">'+k.name.slice(0,2)+'</span>')+'</span>'+
        '<span class="sc-t"><b>'+k.name+'</b><i>'+k.n+' صنف</i></span></button>';
    }).join('');
  }

  function norm(t){
    return String(t||'').toLowerCase()
      .replace(/[\u064B-\u0652\u0640]/g,'')
      .replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')
      .replace(/[ؤئ]/g,'ء')
      .replace(/[^0-9a-z\u0621-\u064A]+/g,' ').trim();
  }

  function apply(){
    var words = q ? norm(q).split(' ').filter(Boolean) : [];
    var want = sub || sel;
    var shown=0;
    document.querySelectorAll('.cell').forEach(function(cell){
      var ok=true;
      if(words.length){
        var hay=norm(cell.dataset.find||'');
        ok = words.every(function(w){ return hay.indexOf(w)>=0; });
      } else if(want){
        ok = (cell.dataset.path||'').indexOf('|'+want+'|')>=0;
      }
      cell.hidden=!ok;
      if(ok) shown++;
    });
    var nh=$('noHit'); if(nh) nh.hidden = shown>0;
    var info=$('qInfo');
    if(info){
      if(words.length){ info.hidden=false; info.textContent='نتايج البحث عن «'+q.trim()+'»: '+shown+' صنف'; }
      else info.hidden=true;
    }
    // وانت بتدوّر، الأقسام مالهاش لازمة
    var tc=$('topCats'), sc2=$('secGrid');
    if(tc) tc.style.opacity = words.length ? '.45' : '';
    if(sc2 && words.length) { sc2.hidden = true; }
    else if(sc2) drawSubs();
  }

  var qi=$('q');
  if(qi){
    var t=null;
    qi.addEventListener('input', function(){
      q=qi.value;
      $('qClear').hidden = !q;
      /* البحث بيدوّر في كل المحل مش في القسم المفتوح — فأول ما يبدأ
         يكتب بنسيب القسم، عشان لما يمسح البحث يرجع يشوف كل حاجة
         مش يلاقي نفسه واقف في قسم هو ناسيه. */
      if(q.trim()){
        sel=''; sub='';
        document.querySelectorAll('.cat').forEach(function(x){ x.classList.toggle('on', !x.dataset.sec); });
      }
      clearTimeout(t); t=setTimeout(apply,120);
    });
    $('qClear').addEventListener('click', function(){ qi.value=''; q=''; $('qClear').hidden=true; apply(); qi.focus(); });
  }

  // ===== نافذة تفاصيل المنتج =====
  var pmName='', pmPrice=0, pmQty=1, pmIdx=0, pmTimer=null;
  /* الصور بتتقلب لوحدها كل ٣ ثواني عشان الزبون يشوف المنتج من كل
     ناحية من غير ما يعمل حاجة. أول ما يمسك هو، بنوقف ونسيبه. */
  function showImg(i){
    var ths=$('pmBody').querySelectorAll('.pd-th');
    if(ths.length<2) return;
    pmIdx=(i%ths.length+ths.length)%ths.length;
    var main=$('pmBody').querySelector('.pd-main img');
    if(main) main.src=ths[pmIdx].dataset.src;
    for(var k=0;k<ths.length;k++) ths[k].classList.toggle('on',k===pmIdx);
    var c=$('pmBody').querySelector('.pd-count b');
    if(c) c.textContent=pmIdx+1;
  }
  function autoPlay(on){
    if(pmTimer){ clearInterval(pmTimer); pmTimer=null; }
    if(on && $('pmBody').querySelectorAll('.pd-th').length>1)
      pmTimer=setInterval(function(){ showImg(pmIdx+1); },3000);
  }
  function setQ(n){
    pmQty=Math.max(1,Math.min(999,n));
    $('pmQ').textContent=pmQty;
    $('pmAdd').textContent = pmQty>1 ? ('أضف '+pmQty+' للطلب') : 'أضف للطلب';
  }
  /* ===== باقي المنتجات والتفاصيل =====
     الصفحة بتفتح بأول دفعة بس، والباقي بييجي بعد ما تبان. كده الموقع
     بيفتح بنفس السرعة سواء فيه ٥٠ منتج أو ٨٠٠. */
  var DETAILS=null, detailsWait=null;
  function loadDetails(){
    if(DETAILS) return Promise.resolve(DETAILS);
    if(detailsWait) return detailsWait;
    detailsWait = fetch('details.json?v='+(window.DATA_V||'1'))
      .then(function(r){ return r.json(); })
      .then(function(j){ DETAILS=j; return j; })
      .catch(function(){ DETAILS={}; return DETAILS; });
    return detailsWait;
  }
  function cardHtml(r){
    // r = [اسم, سعر, وحدة, ماركة, وصف, صورة, مسار, بحث, قسم, له تفاصيل]
    var nm=r[0], pr=r[1], un=r[2], br=r[3], ds=r[4], im=r[5], sec=r[8], more=r[9];
    var tag = br || sec || '';
    return '<article class="card" data-name="'+at(nm)+'" data-price="'+pr+'" data-brand="'+at(br)+'">'+
      '<button type="button" class="card-open" aria-label="تفاصيل '+at(nm)+'">'+
      '<div class="card-img'+(im?'':' is-empty')+'">'+(im
        ? '<img src="img/'+at(im)+'" alt="'+at(nm)+'" loading="lazy">'
        : '<div class="noimg">'+(document.querySelector('.noimg') ? document.querySelector('.noimg').innerHTML : '')+'</div>')+'</div>'+
      '<div class="card-body">'+
        (tag ? '<span class="card-sec'+(br?' is-brand':'')+'">'+at(tag)+'</span>' : '')+
        '<h3>'+at(nm)+'</h3>'+
        (ds ? '<p class="card-desc">'+at(ds)+'</p>' : '')+
        (more ? '<span class="more">اعرف أكتر ←</span>' : '')+
      '</div></button>'+
      '<div class="card-foot"><span class="price">'+money(pr)+' <small>ج.م'+(un?' / '+at(un):'')+'</small></span>'+
      '<button type="button" class="add" data-name="'+at(nm)+'" data-price="'+pr+'">أضف للطلب</button></div>'+
      '</article>';
  }
  function at(t){ return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function money(n){ return Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function loadRest(){
    var g=$('grid'); if(!g) return;
    fetch('catalog.json?v='+(window.DATA_V||'1')).then(function(r){ return r.json(); }).then(function(j){
      var rows=j.rows||[], out=[];
      for(var k=0;k<rows.length;k++){
        var r=rows[k];
        out.push('<div class="cell" data-i="'+(j.from+k)+'" data-path="'+at(r[6])+'" data-find="'+at(r[7])+'">'
          + cardHtml(r) + '</div>');
      }
      if(out.length) g.insertAdjacentHTML('beforeend', out.join(''));
      var nt=$('moreNote'); if(nt) nt.remove();
      paint(); apply();
    }).catch(function(){
      var nt=$('moreNote'); if(nt) nt.textContent='مقدرناش نجيب باقي المنتجات — حدّث الصفحة.';
    });
  }

  function openProduct(card){
    if(!card) return;
    var cell=card.closest('.cell');
    var idx=cell?cell.dataset.i:null;
    pmName=card.dataset.name; pmPrice=Number(card.dataset.price)||0;
    setQ(1); pmIdx=0;
    if(cart[pmName]) $('pmAdd').textContent='في الطلب ('+cart[pmName].qty+') — زوّد كمان';
    // رأس ثابت يبان على طول، والباقي بييجي من ملف التفاصيل
    $('pmBody').innerHTML = '<h3>'+at(pmName)+'</h3>'+
      '<div class="pd-price">'+money(pmPrice)+' <small>ج.م</small></div>'+
      (card.dataset.brand ? '' : '')+
      '<p class="pd-wait">بنجيب التفاصيل...</p>';
    open('pmodal');
    var want=pmName;
    loadDetails().then(function(d){
      if(want!==pmName) return;                 // فتح منتج تاني في الوقت ده
      var html = (idx!=null && d[idx]) ? d[idx] : '';
      if(html){ $('pmBody').innerHTML=html; $('pmBody').scrollTop=0; autoPlay(true); }
      else { var w=$('pmBody').querySelector('.pd-wait'); if(w) w.remove(); }
    });
  }
  $('pmMinus').addEventListener('click', function(){ setQ(pmQty-1); });
  $('pmPlus').addEventListener('click', function(){ setQ(pmQty+1); });
  $('pmAdd').addEventListener('click', function(){
    if(!pmName) return;
    add(pmName,pmPrice,pmQty);
    closeAll(); open('drawer');
  });
  /* الصور: دوسة على صورة صغيرة أو على السهم بتقلّبها — وبتوقف
     التقليب التلقائي عشان الزبون يبقى هو اللي ماسك. */
  $('pmBody').addEventListener('click', function(e){
    var nav=e.target.closest('.pd-nav');
    if(nav){ autoPlay(false); showImg(pmIdx+Number(nav.dataset.d)); return; }
    var t=e.target.closest('.pd-th'); if(!t) return;
    autoPlay(false);
    var ths=[].slice.call($('pmBody').querySelectorAll('.pd-th'));
    showImg(ths.indexOf(t));
  });

  function open(id){ $(id).hidden=false; document.body.style.overflow='hidden'; }
  function closeAll(){
    autoPlay(false);
    ['drawer','orderBox','done','pmodal'].forEach(function(i){ var el=$(i); if(el) el.hidden=true; });
    document.body.style.overflow='';
  }
  $('cartBtn').addEventListener('click',function(){ open('drawer'); });
  $('goOrder').addEventListener('click',function(){
    if(!count()){ return; }
    $('drawer').hidden=true; open('orderBox');
  });

  /* إرسال الطلب: بيتبعت في الخلفية والزبون بيفضل في نفس الصفحة.
     بنبعت نص عادي عشان المتصفح ما يسألش السيرفر إذن الأول (preflight)
     — اللي بيفشل مع سكربت جوجل. */
  $('orderForm').addEventListener('submit',function(e){
    e.preventDefault();
    var f=e.target, msg=$('orderMsg'), btn=$('sendBtn');
    var name=f.name.value.trim(), phone=f.phone.value.trim(), addr=f.address.value.trim();
    msg.hidden=true;
    if(!name||!phone||!addr){ msg.textContent='اكتب الاسم والتليفون والعنوان'; msg.hidden=false; return; }
    if(phone.replace(/\D/g,'').length<10){ msg.textContent='رقم التليفون مش مظبوط'; msg.hidden=false; return; }
    if(!count()){ msg.textContent='السلة فاضية'; msg.hidden=false; return; }

    var ref=String(Date.now()).slice(-6);
    var items=Object.keys(cart).map(function(k){ return {name:cart[k].name,qty:cart[k].qty,price:cart[k].price}; });
    var order={ref:ref,name:name,phone:phone,address:addr,notes:f.notes.value.trim(),
                items:items,total:total(),at:new Date().toISOString(),shop:(window.SITE||{}).shop||''};

    btn.disabled=true; btn.textContent='بيتبعت...';
    function finish(){
      cart={}; save(); paint();
      btn.disabled=false; btn.textContent='إتمام الشراء'; f.reset();
      closeAll(); $('doneRef').textContent=ref; open('done');
    }
    var relay=(window.SITE||{}).relay;
    if(!relay){ finish(); return; }
    /* no-cors: إحنا مش محتاجين نقرا الرد، وده بيمنع المتصفح إنه
       يعتبر الطلب "فشل" وهو وصل فعلاً — وإلا كنا هنبعت الطلب تاني
       بعدين ويوصله مرتين. */
    fetch(relay,{method:'POST',mode:'no-cors',body:JSON.stringify(order),
                 headers:{'Content-Type':'text/plain;charset=utf-8'}})
      .then(function(){ finish(); })
      .catch(function(){
        // النت اتقطع وهو بيبعت — بنحفظ الطلب ونبعته أول ما يرجع
        try{ var q=JSON.parse(localStorage.getItem('mostafaPending')||'[]'); q.push(order);
             localStorage.setItem('mostafaPending',JSON.stringify(q)); }catch(e){}
        finish();
      });
  });

  // طلبات اتقطع بيها النت قبل كده
  (function(){
    var relay=(window.SITE||{}).relay; if(!relay) return;
    var q=[]; try{ q=JSON.parse(localStorage.getItem('mostafaPending')||'[]'); }catch(e){}
    if(!q.length) return;
    localStorage.removeItem('mostafaPending');
    q.forEach(function(o){
      fetch(relay,{method:'POST',mode:'no-cors',body:JSON.stringify(o),
                   headers:{'Content-Type':'text/plain;charset=utf-8'}}).catch(function(){});
    });
  })();

  paint();
  drawSubs();     // كروت الأقسام الرئيسية تبان من أول ما الصفحة تفتح
  // باقي المنتجات بعد ما الصفحة تبان — عشان متأخرش ظهورها
  if ($('moreNote')) {
    if (window.requestIdleCallback) requestIdleCallback(loadRest, { timeout: 1200 });
    else setTimeout(loadRest, 250);
  }
})();
