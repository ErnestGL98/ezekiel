/* ============================================================
   CONTACT FORM — checks the three boxes and sends the message
   ============================================================

   GitHub Pages cannot receive anything, so the message goes to a
   form-delivery service that emails it on. Its address is the
   data-endpoint attribute on the <form> in contact.html; this file never
   needs to change when that is set or swapped.

   Sent with fetch rather than a normal form post, so the visitor stays on
   this page and sees "sent" here instead of being taken to the service's
   own thank-you page. With JavaScript off, the plain form post still
   works (see the action attribute), so no message is ever lost to a
   script failing.
   ============================================================ */

(function () {
  'use strict';

  var form = document.querySelector('.contact-form');
  if (!form) return;

  var status = form.querySelector('.contact-form__status');
  var send = form.querySelector('.contact-form__send');
  var trap = form.querySelector('input[name="_gotcha"]');

  var fields = [
    { el: form.querySelector('#c-email'),
      say: function (el) {
        if (!el.value.trim()) return 'Please add your email so Ezekiel can reply.';
        // The browser's own check, which knows the real rules for an
        // address far better than a hand-written pattern would.
        if (el.validity.typeMismatch) return 'That doesn’t look like an email address.';
        return '';
      } },
    { el: form.querySelector('#c-subject'),
      say: function (el) { return el.value.trim() ? '' : 'Please add a subject.'; } },
    { el: form.querySelector('#c-message'),
      say: function (el) { return el.value.trim() ? '' : 'Please write a message.'; } }
  ];

  function showError(f, text) {
    var err = document.getElementById(f.el.id + '-error');
    err.textContent = text;
    if (text) {
      f.el.setAttribute('aria-invalid', 'true');
      f.el.setAttribute('aria-describedby', err.id);
    } else {
      f.el.removeAttribute('aria-invalid');
      f.el.removeAttribute('aria-describedby');
    }
  }

  function check() {
    var firstBad = null;
    fields.forEach(function (f) {
      var text = f.say(f.el);
      showError(f, text);
      if (text && !firstBad) firstBad = f.el;
    });
    return firstBad;
  }

  // Once a box has been flagged, clear the warning as soon as it is fixed,
  // rather than leaving it up until the next press of Send.
  fields.forEach(function (f) {
    f.el.addEventListener('input', function () {
      if (f.el.getAttribute('aria-invalid')) showError(f, f.say(f.el));
    });
  });

  function say(text, kind) {
    status.textContent = text;
    status.className = 'contact-form__status' + (kind ? ' is-' + kind : '');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var bad = check();
    if (bad) { bad.focus(); say(''); return; }

    // A bot filled the trap. Look exactly like success, send nothing —
    // telling it why would only teach it.
    if (trap && trap.value) {
      form.reset();
      say('Thank you — your message is on its way.', 'ok');
      return;
    }

    // Read at the moment of sending, not once on load, so the address can
    // be set or changed on the element without anything else caring.
    var endpoint = (form.getAttribute('data-endpoint') || '').trim();
    if (!endpoint) {
      say('This form isn’t connected yet, so nothing was sent.', 'error');
      return;
    }

    send.disabled = true;
    send.textContent = 'Sending…';
    say('');

    fetch(endpoint, {
      method: 'POST',
      body: new FormData(form),
      headers: { Accept: 'application/json' }   // JSON back, not a redirect
    }).then(function (r) {
      if (!r.ok) throw new Error('status ' + r.status);
      form.reset();
      say('Thank you — your message is on its way.', 'ok');
    }).catch(function () {
      // Keep what they wrote: a failed send must never cost them the
      // message they just typed.
      say('Sorry, that didn’t send. Please try again in a moment.', 'error');
    }).then(function () {
      send.disabled = false;
      send.textContent = 'Send';
    });
  });
})();
