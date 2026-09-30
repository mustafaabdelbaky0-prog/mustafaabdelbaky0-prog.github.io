
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
    if(c){
      document.querySelectorAll('.cat').forEach(function(x){ x.classList.toggle('on', x===c); });
      var want=c.dataset.cat;
      document.querySelectorAll('.cell').forEach(function(cell){
        cell.hidden = !!want && cell.dataset.cat!==want;
      });
    }
  });

  function open(id){ $(id).hidden=false; document.body.style.overflow='hidden'; }
  function closeAll(){
    ['drawer','orderBox','done'].forEach(function(i){ $(i).hidden=true; });
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
