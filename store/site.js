
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

  function add(name,price){
    if(!cart[name]) cart[name]={name:name,price:Number(price)||0,qty:0};
    cart[name].qty++; save(); paint();
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
    var sc=e.target.closest('.subcat');
    if(sc){ sub = (sub===sc.dataset.sec) ? '' : sc.dataset.sec;
            document.querySelectorAll('.subcat').forEach(function(x){ x.classList.toggle('on', x.dataset.sec===sub); });
            apply(); return; }
    var po=e.target.closest('.card-open');
    if(po){ openProduct(po.closest('.card')); return; }
  });

  /* ===== الأقسام والبحث =====
     القسم الرئيسي بيوري اللي جواه كله (الأقسام اللي تحته ومنتجاتها)،
     والبحث بيدوّر في كل حاجة من غير ما يهتم بالأقسام. */
  var sel='', sub='', q='';
  var SUBS={};
  try{ SUBS=JSON.parse(($('subCats')||{}).dataset ? ($('subCats').dataset.tree||'{}') : '{}'); }catch(e){ SUBS={}; }

  function drawSubs(){
    var box=$('subCats'); if(!box) return;
    var kids=SUBS[sel]||[];
    if(!sel || !kids.length){ box.hidden=true; box.innerHTML=''; return; }
    box.hidden=false;
    box.innerHTML=kids.map(function(k){
      return '<button type="button" class="subcat" data-sec="'+k.id+'">'+k.name+' ('+k.n+')</button>';
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
    var tc=$('topCats'), sc2=$('subCats');
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
  var pmName='', pmPrice=0;
  function openProduct(card){
    if(!card) return;
    var det=card.querySelector('.pdet');
    $('pmBody').innerHTML = det ? det.innerHTML : '';
    pmName=card.dataset.name; pmPrice=Number(card.dataset.price)||0;
    var btn=$('pmAdd');
    btn.textContent = cart[pmName] ? ('في الطلب ('+cart[pmName].qty+') — زوّد واحد') : 'أضف للطلب';
    open('pmodal');
  }
  $('pmAdd').addEventListener('click', function(){
    if(!pmName) return;
    add(pmName,pmPrice);
    closeAll(); open('drawer');
  });

  function open(id){ $(id).hidden=false; document.body.style.overflow='hidden'; }
  function closeAll(){
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
})();
