// Shared script for the TiS service pages: footer year and phone menu.
(function () {
  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();
  var menuBtn = document.querySelector('.menu-btn'), nav = document.getElementById('site-nav');
  if (!menuBtn || !nav) return;
  menuBtn.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', open);
    menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) { nav.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); menuBtn.setAttribute('aria-label', 'Open menu'); }
  });
  
  // Phones: slide the EL-SYS bar away while scrolling down, bring it back when scrolling up (CSS limits this to narrow screens).
  var lastY = window.scrollY;
  window.addEventListener('scroll', function () {
    var y = window.scrollY;
    if (Math.abs(y - lastY) < 8) return;
    document.body.classList.toggle('head-up', y > lastY && y > 120 && !document.getElementById('site-nav').classList.contains('open'));
    lastY = y;
  }, { passive: true });
})();
