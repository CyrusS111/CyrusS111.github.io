document.getElementById('yr').textContent = new Date().getFullYear();

// Phone menu: toggle the section links; close after choosing one.
var menuBtn = document.querySelector('.menu-btn'), nav = document.getElementById('site-nav');
menuBtn.addEventListener('click', function () {
  var open = nav.classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', open);
  menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
});
nav.addEventListener('click', function (e) {
  if (e.target.closest('a')) { nav.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); menuBtn.setAttribute('aria-label', 'Open menu'); }
});

// Hide the floating WhatsApp button while the contact form is on screen (the form has its own WhatsApp button).
var floatBtn = document.querySelector('.wa-float'), quoteForm = document.getElementById('quote');
function updateFloat() {
  var r = quoteForm.getBoundingClientRect();
  floatBtn.classList.toggle('away', r.top < window.innerHeight - 80 && r.bottom > 80);
}
window.addEventListener('scroll', updateFloat, { passive: true });
window.addEventListener('resize', updateFloat);
updateFloat();
document.getElementById('quote').addEventListener('submit', function (e) {
  e.preventDefault();
  var f = e.target, note = document.getElementById('form-note');
  var name = f.name.value.trim(), msg = f.message.value.trim();
  if (!name || !msg) { note.textContent = 'Please add your name and a short description of the job.'; note.style.color = '#B42318'; return; }
  var lines = [
    'Hello EL-SYS, I am interested in: ' + f.service.value,
    'Name: ' + name + (f.org.value.trim() ? ' (' + f.org.value.trim() + ')' : ''),
    f.location.value.trim() ? 'Location: ' + f.location.value.trim() : '',
    'Details: ' + msg
  ].filter(Boolean);
  window.open('https://wa.me/256701475685?text=' + encodeURIComponent(lines.join('\n')), '_blank', 'noopener');
});
