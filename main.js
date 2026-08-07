//* ==================== UTILS ==================== */
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const $ = (s, root) => (root || document).querySelector(s);
const $$ = (s, root) => Array.from((root || document).querySelectorAll(s));

/* ==================== DOM READY SETUP ==================== */
document.addEventListener("DOMContentLoaded", () => {
  initYear();
  initPrivacy();
  initMastheadFloats();
  initHeroAnimation();
  initOverlay();
  initCoachingBoxes();
  initNavigation();
  initLogo();
  initEmailLinks();
  initContactForm();
});

/* ==================== EMAIL OBFUSCATION ==================== */
//
// The address is never written literally, in the markup or in this file, so a
// harvester grepping the source for /\S+@\S+\.\S+/ finds nothing to match. It's
// assembled at runtime and written into the href when the page loads.
//
// Worth being honest about the ceiling: this stops the bulk, regex-over-HTML
// kind of scraping, which is most of it. It does not stop anything driving a
// real browser engine, because by then the address is in the DOM like any other
// text. The contact form is the actual defence; this just lowers the noise.
const MAIL_USER = 'gagan';
const MAIL_HOST = ['designstamp', 'com'].join('.');
const mailAddress = () => MAIL_USER + String.fromCharCode(64) + MAIL_HOST;

function initEmailLinks() {
  $$('[data-email]').forEach(el => {
    const addr = mailAddress();
    const subject = el.getAttribute('data-email-subject');
    el.setAttribute('href', 'mailto:' + addr + (subject ? '?subject=' + encodeURIComponent(subject) : ''));
    // Elements flagged data-email-text show the address as their label. They
    // start with a placeholder so there's something readable if JS never runs.
    if (el.hasAttribute('data-email-text')) el.textContent = addr;
  });
}

/* ==================== PERSISTENT CONTACT FORM ==================== */

// Where submissions go. This is a static site, so it needs a third-party form
// endpoint or your own serverless route. Paste one of these in:
//
//   Formspree    https://formspree.io/f/xxxxxxxx
//   Web3Forms    https://api.web3forms.com/submit   (add your access_key below)
//   Your own     https://diesh.ca/api/contact       (diesh.ca already has Resend
//                                                    wired up in lib/email.ts;
//                                                    needs a CORS header)
//
// Left empty, the form falls back to opening the visitor's mail client with
// everything prefilled. That is worse than a real POST, because a chunk of
// people have no mail client configured and the message is simply lost.
const CONTACT_ENDPOINT = 'https://formspree.io/f/xovjwoww';

// Formspree's built-in reCAPTCHA redirects to an interstitial challenge page,
// which a fetch() can't follow, so AJAX submissions are rejected outright. The
// way round it is your own key: Formspree then just verifies whatever token we
// put in the `g-recaptcha-response` field. That field name is fixed on their
// side, so don't rename it.
// SITE key only. This file is public, so anything here is public.
// The SECRET key belongs in Formspree's dashboard and must never appear in
// client-side code: with it, anyone can verify tokens as you and bypass the
// challenge entirely. If a secret key ever lands here, rotate it rather than
// just deleting it.
const RECAPTCHA_SITE_KEY = '6LfQ2HgtAAAAADrPqBX04bgnDElDZpcWfDifVvYm';

// 'v2' renders the "I'm not a robot" checkbox. 'v3' is invisible and scores in
// the background. These are DIFFERENT key types and are not interchangeable: a
// v2 key used in v3 mode throws "Invalid site key" and vice versa. The key
// above is a v3 key.
const RECAPTCHA_VERSION = 'v3';

let recaptchaReady = null;
let recaptchaWidgetId = null;

// Loaded lazily, on first open of the panel, so Google's script costs nothing
// for the large majority of visitors who never contact you.
function loadRecaptcha() {
  if (recaptchaReady) return recaptchaReady;
  recaptchaReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = RECAPTCHA_VERSION === 'v3'
      ? `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`
      : 'https://www.google.com/recaptcha/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = () => {
      if (!window.grecaptcha) return reject(new Error('reCAPTCHA did not initialise'));
      window.grecaptcha.ready(() => {
        if (RECAPTCHA_VERSION === 'v2') {
          const host = $('#contactRecaptcha');
          if (host && recaptchaWidgetId === null) {
            recaptchaWidgetId = window.grecaptcha.render(host, {
              sitekey: RECAPTCHA_SITE_KEY,
              theme: 'light',
              // A token dies after two minutes. Left alone, Google prints
              // "Verification expired. Check the checkbox again." inside its
              // own iframe, which we can't style and which makes the widget
              // taller, shoving the Send button down. Resetting the moment it
              // expires clears the widget before that message renders, and we
              // say the same thing in our own error line instead.
              // No expired-callback on purpose. Google already prints its own
              // "Verification expired. Check the checkbox again." inside the
              // iframe, and reset() from in here is unreliable enough that
              // ours ended up sitting next to it saying the same thing twice.
              // One message from Google beats two, even unstyled.
              'error-callback': () => {
                document.dispatchEvent(new CustomEvent('contact:captcha-error'));
              }
            });
          }
        }
        resolve();
      });
    };
    s.onerror = () => reject(new Error('reCAPTCHA failed to load'));
    document.head.appendChild(s);
  });
  return recaptchaReady;
}

async function recaptchaToken() {
  await loadRecaptcha();
  if (RECAPTCHA_VERSION === 'v3') {
    return await window.grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: 'contact' });
  }
  return window.grecaptcha.getResponse(recaptchaWidgetId) || '';
}

// Tokens are single use. Without this, a second send after a failure is
// rejected as a replay.
function resetRecaptcha() {
  if (RECAPTCHA_VERSION === 'v2' && window.grecaptcha && recaptchaWidgetId !== null) {
    window.grecaptcha.reset(recaptchaWidgetId);
  }
}

function initContactForm() {
  const launcher = $('#contactLauncher');
  const panel = $('#contactPanel');
  const form = $('#contactForm');
  if (!launcher || !panel || !form) return;

  // v3 has no widget to render, so collapse its slot and show the notice that
  // Google's terms require in exchange for hiding the floating badge.
  if (RECAPTCHA_VERSION === 'v3') {
    const host = $('#contactRecaptcha');
    if (host) host.hidden = true;
    const legal = $('#contactLegal');
    if (legal) legal.hidden = false;
  }

  const closeBtn = $('#contactClose');
  const submitBtn = $('#contactSubmit');
  const errorEl = $('#contactError');
  const errorFallback = $('#contactErrorFallback');
  const successEl = $('#contactSuccess');
  const resetBtn = $('#contactReset');
  let lastFocus = null;

  function openPanel() {
    lastFocus = document.activeElement;
    panel.hidden = false;
    document.body.classList.add('contact-open');
    launcher.setAttribute('aria-expanded', 'true');
    // Warm the challenge now so it's rendered by the time they reach the button.
    loadRecaptcha().catch(err => console.error('[contact] reCAPTCHA:', err));
    const first = $('input, textarea', form);
    if (first) first.focus();
  }

  function closePanel() {
    panel.hidden = true;
    document.body.classList.remove('contact-open');
    launcher.setAttribute('aria-expanded', 'false');
    // Send focus back where it came from, so keyboard users aren't dumped at
    // the top of the document.
    (lastFocus && lastFocus.focus ? lastFocus : launcher).focus();
  }

  launcher.addEventListener('click', openPanel);
  if (closeBtn) closeBtn.addEventListener('click', closePanel);

  // Anything marked data-open-contact opens the panel instead of following its
  // href. Keeping a real mailto in the href means the link still works if this
  // script fails to load.
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-open-contact]');
    if (!trigger) return;
    e.preventDefault();
    if (panel.hidden) openPanel();
  });

  window.openContactPanel = openPanel;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) closePanel();
  });

  document.addEventListener('contact:captcha-error', () => {
    showError('The spam check couldn’t reach Google. Try again, or email me directly.');
    if (errorFallback) errorFallback.hidden = false;
  });

  // Click-outside-to-close. This runs on the same click that just opened the
  // panel, so anything that opens it has to be excluded here or the panel shuts
  // again immediately: the opener sets hidden = false, then this handler sees a
  // visible panel and a target outside it, and closes it.
  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    if (panel.contains(e.target) || launcher.contains(e.target)) return;
    if (e.target.closest('[data-open-contact]')) return;
    closePanel();
  });

  function showError(msg, field) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    }
  }

  function clearErrors() {
    errorEl.hidden = true;
    if (errorFallback) errorFallback.hidden = true;
    $$('[aria-invalid]', form).forEach(f => f.removeAttribute('aria-invalid'));
  }

  // If the POST fails, hand the visitor a one-click mailto with everything they
  // already typed, so a genuine enquiry isn't lost to a broken integration.
  if (errorFallback) {
    errorFallback.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-mailto-fallback]');
      if (!trigger) return;
      e.preventDefault();
      const fd = new FormData(form);
      mailtoFallback({
        name: (fd.get('name') || '').toString().trim(),
        email: (fd.get('email') || '').toString().trim(),
        company: (fd.get('company') || '').toString().trim(),
        message: (fd.get('message') || '').toString().trim()
      });
    });
  }

  function mailtoFallback(data) {
    const body = [
      `Name: ${data.name}`,
      `Email: ${data.email}`,
      data.company ? `Company: ${data.company}` : null,
      '',
      data.message
    ].filter(Boolean).join('\n');
    window.location.href = 'mailto:' + mailAddress()
      + '?subject=' + encodeURIComponent('Enquiry from designstamp.com')
      + '&body=' + encodeURIComponent(body);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const fd = new FormData(form);
    const trap = (fd.get('_gotcha') || '').toString();
    if (trap) return; // honeypot tripped in-browser, drop it silently

    const data = {
      name: (fd.get('name') || '').toString().trim(),
      email: (fd.get('email') || '').toString().trim(),
      company: (fd.get('company') || '').toString().trim(),
      message: (fd.get('message') || '').toString().trim()
    };
    // Formspree reads _subject for the email subject line and uses the `email`
    // field as reply-to automatically, so hitting reply goes to the sender.
    data._subject = `designstamp.com — ${data.name}${data.company ? ' (' + data.company + ')' : ''}`;

    if (!data.name) return showError('A name would help.', form.elements.name);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
      return showError('That email address looks off.', form.elements.email);
    }
    if (!data.message) return showError('Tell me a little about what you need.', form.elements.message);

    if (!CONTACT_ENDPOINT) {
      mailtoFallback(data);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    let captcha = '';
    try {
      captcha = await recaptchaToken();
    } catch (err) {
      console.error('[contact] reCAPTCHA:', err);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send';
      showError('The spam check didn’t load. Try again, or email me directly.');
      if (errorFallback) errorFallback.hidden = false;
      return;
    }

    if (!captcha) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send';
      return showError(RECAPTCHA_VERSION === 'v2'
        ? 'Tick the box to confirm you’re human.'
        : 'The spam check didn’t complete. Try again in a moment.');
    }

    // Sent as FormData, not JSON, on purpose. A JSON body sets
    // Content-Type: application/json, which is not a CORS-simple content type,
    // so the browser fires an OPTIONS preflight first. multipart/form-data is
    // simple, needs no preflight, and is what Formspree's own example uses.
    const payload = new FormData();
    payload.append('name', data.name);
    payload.append('email', data.email);
    if (data.company) payload.append('company', data.company);
    payload.append('message', data.message);
    payload.append('_subject', data._subject);
    // Formspree runs _gotcha as a server-side honeypot too. Passing it through
    // (empty for humans) means their filter catches anything that skips our JS.
    payload.append('_gotcha', trap);
    payload.append('g-recaptcha-response', captcha); // Formspree expects this exact name

    try {
      const res = await fetch(CONTACT_ENDPOINT, {
        method: 'POST',
        headers: { 'Accept': 'application/json' }, // no Content-Type: let the browser set the boundary
        body: payload
      });

      let detail = '';
      if (!res.ok) {
        // Formspree returns {errors:[{field,message}]} and the message is
        // usually specific and actionable, so surface it instead of hiding it.
        try {
          const body = await res.json();
          if (Array.isArray(body.errors) && body.errors.length) {
            detail = body.errors.map(e => e.message).join('. ');
          } else if (body.error) {
            detail = body.error;
          }
        } catch (_) { /* non-JSON error body */ }
        console.error('[contact] Formspree rejected the submission', res.status, detail || '(no detail)');
        throw new Error(detail || `HTTP ${res.status}`);
      }

      form.hidden = true;
      successEl.hidden = false;
    } catch (err) {
      console.error('[contact] submit failed:', err);
      showError(err.message
        ? `That didn’t send: ${err.message}`
        : 'That didn’t send. Check your connection and try again.');
      // Never lose a real enquiry to a broken integration.
      if (errorFallback) errorFallback.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send';
      resetRecaptcha(); // the token just used is spent either way
    }
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      form.reset();
      form.hidden = false;
      successEl.hidden = true;
      clearErrors();
      const first = $('input, textarea', form);
      if (first) first.focus();
    });
  }
}

/* ==================== MASTHEAD FLOATING ELEMENTS ==================== */
function initMastheadFloats() {
  const masthead = $('#masthead');
  if (!masthead) return;
  
  // Create three additional floating circle elements
  for (let i = 1; i <= 3; i++) {
    const float = document.createElement('div');
    float.className = `masthead-float-${i}`;
    masthead.appendChild(float);
  }
}

/* ==================== YEAR + PRIVACY SETUP ==================== */
function initYear() {
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
}

function initPrivacy() {
  const emailSpan = $('#contact-email');
  if (emailSpan) {
    // Same treatment as the rest: never written literally in a served file.
    const addr = 'studio' + String.fromCharCode(64) + MAIL_HOST;
    const link = document.createElement('a');
    link.href = 'mailto:' + addr;
    link.textContent = addr;
    emailSpan.appendChild(link);
  }

  const dateSpan = $('#policy-updated');
  if (dateSpan) {
    const past = new Date();
    past.setMonth(past.getMonth() - 2);
    dateSpan.textContent = past.toLocaleDateString('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  // Wire privacy details expand/collapse
  const details = $('.footer-legal details');
  if (!details) return;

  // Listen for details open state change
  details.addEventListener('toggle', () => {
    if (details.open) {
      // Scroll the details element into view after it opens
      requestAnimationFrame(() => {
        const rect = details.getBoundingClientRect();
        const scrollTop = window.scrollY + rect.top - 100;
        if (heroCollapsed) lockNavDuringScroll();
        window.scrollTo({
          top: scrollTop,
          behavior: 'smooth'
        });
      });
    }
  });

  // Wire close link inside privacy panel
  const closeLink = $('.privacy-back a', details);
  const closeX = $('.privacy-close-x', details);

  function closePrivacy(e) {
    e.preventDefault();
    details.open = false;
    // Scroll back to footer after closing
    setTimeout(() => {
      const footer = $('footer');
      if (footer) {
        if (heroCollapsed) lockNavDuringScroll();
        window.scrollTo({
          top: footer.offsetTop - 100,
          behavior: 'smooth'
        });
      }
    }, 100);
  }

  if (closeLink) {
    closeLink.addEventListener('click', closePrivacy);
  }

  if (closeX) {
    closeX.addEventListener('click', closePrivacy);
  }
}




/* ==================== HERO SENTENCE ANIMATION ==================== */
let isScrolling = false; // Global flag to prevent nav shifting during smooth scroll

// Scroll distance over which the hero collapses into the global nav. Past this
// point the nav is in its final state and must not move again. Lives at file
// scope so programmatic scrolls can tell whether a jump lands past the hero.
const HERO_SCROLL_TOTAL = 520;

// True once the hero has fully collapsed into the nav. Set from onScroll and
// from fadeSentence. Any programmatic jump taken while this is true must leave
// the nav exactly where it is.
let heroCollapsed = false;

// Freezes the global nav for the duration of a programmatic scroll.
//
// The previous version released on a fixed 1000ms timeout, which is a guess.
// Native smooth scrolling over a long distance routinely takes longer than
// that, so the lock lifted mid-flight and the spring's overshoot drove the
// hero animation again. This releases on idle instead: once 150ms passes with
// no scroll event, the scroll has actually settled, however long it took.
let navUnlockTimer = null;
function lockNavDuringScroll() {
  if (window.fadeSentence) window.fadeSentence(); // snap to the end state
  isScrolling = true;                             // onScroll now no-ops

  clearTimeout(navUnlockTimer);
  const onIdle = () => {
    clearTimeout(navUnlockTimer);
    navUnlockTimer = setTimeout(() => {
      window.removeEventListener('scroll', onIdle);
      isScrolling = false;
      window.dispatchEvent(new Event('scroll')); // resync to the real position
    }, 150);
  };
  window.addEventListener('scroll', onIdle, { passive: true });
  onIdle();
}

function initHeroAnimation() {
  const masthead = $('#masthead');
  const row = $('#sentenceRow');
  const inner = $('#sentenceInner');
  const rests = $$('.nav-rest', row);
  const words = $$('.nav-word', row);

  if (!masthead || !row) return;

  const css = getComputedStyle(document.documentElement);
  const BOX_SIZE = parseFloat(css.getPropertyValue('--boxSize'));
  const BOX_INSET = parseFloat(css.getPropertyValue('--boxInset'));
  const HERO_H_PX = () => window.innerHeight * (parseFloat(css.getPropertyValue('--heroHvh')) / 100);
  const ROW_GAP_START = parseFloat(css.getPropertyValue('--rowGapStart'));
  const ROW_GAP_END = parseFloat(css.getPropertyValue('--rowGapEnd'));

  const SCROLL_TOTAL = HERO_SCROLL_TOTAL;
  const FADE_END_POINT = 0.4;

  // The rests must be fully transparent BEFORE their boxes start collapsing.
  // .sentence-inner paints its text via background-clip:text, and that paint
  // happens at the parent, masked by the glyphs of the entire subtree. A child
  // overflow:hidden does not clip it. So collapsing a rest's width while its
  // text is still visible slides the next word straight over the old one
  // instead of wiping it. Fade first, then collapse.
  const OPACITY_END = 0.16;

  let scrollProgress = 0;
  let opacityPhase = 0;
  let collapsePhase = 0;
  let restWidths = [];
  let baseInnerWidth = 0;      // sentence width with the rests fully open
  let collapsedInnerWidth = 0; // sentence width with only the three nav words left
  let isNavigating = false; // Navigation lock flag

  // On mobile, the sentence's resting position used to be a flat 30% of the
  // viewport height - a guess that happened to clear the "25 YEARS" tag on
  // some phones but overlapped it on shorter ones (and on load/overscroll,
  // where the tag is always fully visible). Anchoring to the tag's own
  // measured position instead guarantees clearance on any device, and stays
  // correct even if the tag's size or placement changes later. #anniv-tag is
  // position:fixed, so its rect is stable regardless of scroll position -
  // safe to measure once and cache, rather than on every scroll frame.
  //
  // First attempt just used tagBottom + a flat margin, which quietly broke
  // the first time the copy got shorter: .sentenceRow is vertically CENTERED
  // on row.style.top via translateY(-50%) scale(--fit), so its actual top
  // edge sits at (top - naturalHeight/2 * fit), not at `top` itself. Shorter
  // text needs less shrinking to fit the available width, so --fit grows
  // closer to 1, the rendered box gets taller, and its top edge creeps
  // upward past a flat margin that never accounted for scale at all. This
  // has to fold naturalHeight and the fit the sentence will actually render
  // at into the anchor itself, or it'll just break again on the next copy
  // change. Must run after measureSentence() - it needs baseInnerWidth.
  const annivTag = document.getElementById('anniv-tag');
  let mobileStartTop = null;
  function measureMobileStartTop() {
    if (!annivTag) { mobileStartTop = null; return; }

    const tagClearance = annivTag.getBoundingClientRect().bottom + 24;

    // Mirrors fitSentence()'s mobile, at-rest branch (scrollProgress 0):
    // avail = window.innerWidth - 24, compared against the fully-open
    // sentence width.
    const availAtRest = window.innerWidth - 24;
    const fitAtRest = baseInnerWidth > 0 ? Math.min(1, availAtRest / baseInnerWidth) : 1;

    // offsetHeight reflects the row's own layout size and is unaffected by
    // the transform:scale() applied to it, exactly the "natural,
    // pre-transform height" this needs.
    const naturalHeight = row.offsetHeight || 0;
    const renderedHalfHeight = (naturalHeight / 2) * fitAtRest;

    mobileStartTop = tagClearance + renderedHalfHeight;
  }

  // Scroll-driven, so it has to land exactly on the frame. There is
  // deliberately no CSS transition on any of these properties.
  function applyFade(opacityP, collapseP) {
    rests.forEach((r, i) => {
      r.style.setProperty('--rest-fade', opacityP);
      r.style.maxWidth = (restWidths[i] || 0) * (1 - collapseP) + 'px';
      // 0.2 + 0.25 (see marginLeft below) combined to a visibly oversized
      // gap between the plain text and the linked words - roughly a whole
      // word's width at hero font sizes. Cut both down to a normal word
      // space instead.
      r.style.marginRight = 0.08 * (1 - collapseP) + 'em';
    });
    words.forEach(w => {
      w.style.marginLeft = 0.08 * (1 - collapseP) + 'em';
    });
  }

  // Measures both ends of the animation once so onScroll never reads layout.
  // Reading inner.scrollWidth mid-collapse made the fit scale climb while the
  // sentence shrank, which is what caused the zoom and the jitter.
  function measureSentence() {
    rests.forEach(r => { r.style.maxWidth = 'none'; });
    restWidths = rests.map(r => r.scrollWidth);

    applyFade(0, 0);
    baseInnerWidth = inner.scrollWidth;

    applyFade(1, 1);
    collapsedInnerWidth = inner.scrollWidth;

    applyFade(opacityPhase, collapsePhase);
  }

  function sentenceWidthAt(p) {
    return Math.max(1, lerp(baseInnerWidth, collapsedInnerWidth, p));
  }

  function fitSentence() {
    if (isNavigating) return; // Don't recalculate during navigation
    
    const isMobile = window.innerWidth < 900;
    const leftGap = lerp(ROW_GAP_START, ROW_GAP_END, scrollProgress);
    
    if (isMobile) {
      const mobileLeft = 12;
      const finalLeft = BOX_INSET + BOX_SIZE + 18;
      const transitionProgress = Math.min(scrollProgress * 2.5, 1);
      
      row.style.left = `${lerp(mobileLeft, finalLeft, transitionProgress)}px`;
      
      const mobileWidth = window.innerWidth - 24;
      const desktopWidth = window.innerWidth - finalLeft - 12;
      const avail = lerp(mobileWidth, desktopWidth, transitionProgress);
      const scale = Math.min(1, avail / sentenceWidthAt(collapsePhase));
      row.style.setProperty('--fit', scale);
    } else {
      const left = BOX_INSET + BOX_SIZE + leftGap + 6;
      row.style.left = `${left}px`;
      const rightBuffer = 40;
      const avail = Math.max(140, window.innerWidth - left - rightBuffer);
      const scale = Math.min(1, avail / sentenceWidthAt(collapsePhase));
      row.style.setProperty('--fit', scale);
    }
  }

  function onScroll() {
    if (isScrolling) return; // Skip all recalculations during smooth scroll
    
    scrollProgress = clamp(window.scrollY / SCROLL_TOTAL, 0, 1);

    // Phase 1, 0 to OPACITY_END: the sentence fades out in place.
    // Phase 2, OPACITY_END to FADE_END_POINT: the now-invisible gaps close and
    // the three words travel to their nav positions.
    opacityPhase = clamp(scrollProgress / OPACITY_END, 0, 1);
    collapsePhase = easeOutCubic(
      clamp((scrollProgress - OPACITY_END) / (FADE_END_POINT - OPACITY_END), 0, 1)
    );
    heroCollapsed = scrollProgress >= 1;

    applyFade(opacityPhase, collapsePhase);

    let boxProgress = 0;
    if (scrollProgress > FADE_END_POINT) {
      boxProgress = (scrollProgress - FADE_END_POINT) / (1 - FADE_END_POINT);
    }
    const e = easeOutCubic(boxProgress);
    const heroH = HERO_H_PX();

    masthead.style.transform = `translate(${lerp(0, BOX_INSET, e)}px,${lerp(0, BOX_INSET, e)}px) scale(${lerp(1, BOX_SIZE / window.innerWidth, e)},${lerp(1, BOX_SIZE / heroH, e)})`;

    const isMobile = window.innerWidth < 900;

    // Across the whole boxProgress range the masthead is mid-shrink: some
    // in-between rectangle, neither full-width nor logo-sized yet. On
    // mobile that read as a red box with visible edges on both sides for
    // most of the scroll, not just a brief flash - a "displeasing shape,"
    // not a sizing bug on the white scrim next to it (#navShield), which is
    // what this looked like at first. .logoBox is a separate, always-solid
    // element that already sits in the same corner throughout, so fading
    // the masthead out over this same range hands off to it cleanly instead
    // of ever showing the in-between rectangle.
    if (isMobile) {
      masthead.style.opacity = String(lerp(1, 0, boxProgress));
    } else {
      masthead.style.opacity = '';
    }
    // Mobile's hero is much shorter than desktop's (see --heroHvh), so the
    // sentence needs to start much higher up too, or it lands in the dead
    // space near the bottom of a short hero. Anchored to the "25 YEARS" tag's
    // measured position (see measureMobileStartTop) rather than a fixed
    // fraction of the viewport, so it can't overlap the tag on any device.
    const startTop = isMobile
      ? (mobileStartTop ?? window.innerHeight * 0.30)
      : window.innerHeight * 0.425;
    const endTop = isMobile ? BOX_INSET + BOX_SIZE + 15 : BOX_INSET + BOX_SIZE * 1.35;
    row.style.top = `${lerp(startTop, endTop, e)}px`;

    fitSentence();
  }

  // Order matters: measureMobileStartTop() reads baseInnerWidth and
  // row.offsetHeight, both of which measureSentence() is what populates/
  // settles, so it has to run second.
  measureSentence();
  measureMobileStartTop();
  onScroll();

  // The measurement above runs on DOMContentLoaded, which fires before the
  // Google webfonts finish loading. With font-display:swap the sentence is
  // still in the fallback font at that point, so the cached widths are wrong
  // and the collapse clamps to a width that no longer matches the rendered
  // text. Re-measure once the real fonts are in.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { measureSentence(); measureMobileStartTop(); onScroll(); });
  }

  window.addEventListener('resize', () => { measureSentence(); measureMobileStartTop(); onScroll(); }, { passive: true });

  // Coalesce scroll events into one write per frame. Previously every scroll
  // event did a layout read plus a dozen style writes, which is what made the
  // motion feel stepped rather than smooth.
  let rafPending = false;
  window.addEventListener('scroll', () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; onScroll(); });
  }, { passive: true });
  
  // Expose function to manually fade sentence
  window.fadeSentence = () => {
    opacityPhase = 1;
    collapsePhase = 1;
    heroCollapsed = true;
    applyFade(1, 1);

    // Force hero animation to complete state
    const isMobile = window.innerWidth < 900;
    const endTop = isMobile ? BOX_INSET + BOX_SIZE + 15 : BOX_INSET + BOX_SIZE * 1.35;
    
    masthead.style.transform = `translate(${BOX_INSET}px,${BOX_INSET}px) scale(${BOX_SIZE / window.innerWidth},${BOX_SIZE / HERO_H_PX()})`;
    if (isMobile) masthead.style.opacity = '0';
    row.style.top = `${endTop}px`;
    
    // Force scroll progress to 1 and position nav words
    scrollProgress = 1;
    
    // Position nav words to right of logo
    const leftGap = ROW_GAP_END;
    if (isMobile) {
      const finalLeft = BOX_INSET + BOX_SIZE + 18;
      row.style.left = `${finalLeft}px`;
      const desktopWidth = window.innerWidth - finalLeft - 12;
      const scale = Math.min(1, desktopWidth / sentenceWidthAt(1));
      row.style.setProperty('--fit', scale);
    } else {
      const left = BOX_INSET + BOX_SIZE + leftGap + 6;
      row.style.left = `${left}px`;
      const rightBuffer = 40;
      const avail = Math.max(140, window.innerWidth - left - rightBuffer);
      const scale = Math.min(1, avail / sentenceWidthAt(1));
      row.style.setProperty('--fit', scale);
    }
  };
}


/* ==================== OVERLAY + CASE LOGIC ==================== */
function initOverlay() {
  const overlay = $('#overlay');
  const pClient = $('#panel-client');
  const pQuestion = $('#panel-question');
  const pContent = $('#panel-content');
  const closeBtn = $('#closeBtn');

  if (!overlay) return;

  let lastFocus = null;

  function markLoaded(img) {
    img.classList.add('img-loaded');
  }

  function wireImages(root) {
    $$('img', root).forEach(img => {
      if (img.complete) markLoaded(img);
      else {
        img.addEventListener('load', () => markLoaded(img), { once: true });
        img.addEventListener('error', () => markLoaded(img), { once: true });
      }
    });
  }

  function openCase(id) {
    const tpl = $(`#case-templates template#${id}`);
    if (!tpl) return;

    lastFocus = document.activeElement;
    pClient.textContent = tpl.dataset.client || '';
    pQuestion.textContent = tpl.dataset.question || '';
    pContent.innerHTML = '';
    pContent.appendChild(tpl.content.cloneNode(true));

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('overlay-open');

    wireImages(pContent);
    closeBtn.focus();
  }

  function closeCase() {
    overlay.classList.remove('open');
    pClient.textContent = '';
    pQuestion.textContent = '';
    pContent.innerHTML = '';
    document.body.style.overflow = '';
    document.body.classList.remove('overlay-open');

    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // Wire all work-row buttons
  $$('.work-row button').forEach(btn => {
    btn.addEventListener('click', () => openCase(btn.dataset.target));
  });

  if (closeBtn) closeBtn.addEventListener('click', closeCase);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeCase();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeCase();
  });
}

/* ==================== COACHING BOXES (ACCORDION) ==================== */
//
// Rewritten because the original had four problems:
//
//   1. .extra animated from max-height:0 to max-height:none. `none` is not an
//      animatable value, so the 0.6s transition never ran and the panel just
//      snapped open. Heights are measured and set in px here instead.
//   2. The whole box was the click target, so trying to select a line of text
//      inside an open panel collapsed it.
//   3. Closing scrolled the page back to the section, which yanked you away
//      from whatever you were reading.
//   4. No keyboard access, no ARIA, and links inside a collapsed panel were
//      still in the tab order while being invisible.
function initCoachingBoxes() {
  const boxes = $$('.coaching-box');

  boxes.forEach((box, i) => {
    const extra = $('.extra', box);
    if (extra && !extra.id) extra.id = `coaching-extra-${i + 1}`;

    box.setAttribute('role', 'button');
    box.setAttribute('tabindex', '0');
    box.setAttribute('aria-expanded', 'false');
    if (extra) {
      box.setAttribute('aria-controls', extra.id);
      extra.inert = true; // keeps collapsed links out of the tab order
    }

    box.addEventListener('click', (e) => {
      // Clicks on a link do what the link says. Clicks inside the open panel
      // are someone reading or selecting, not asking to close it.
      if (e.target.closest('a, button')) return;
      if (e.target.closest('.extra')) return;
      toggleBox(box);
    });

    box.addEventListener('keydown', (e) => {
      if (e.target !== box) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        toggleBox(box);
      }
    });
  });

  // Stagger animation indices
  $$('.work-row').forEach((row, i) => {
    row.style.setProperty('--i', i);
  });
}

function openBox(box) {
  const extra = $('.extra', box);
  box.classList.add('active');
  box.setAttribute('aria-expanded', 'true');
  if (!extra) return;

  extra.inert = false;
  // Class first, then measure: .active changes the panel's padding, so
  // measuring before it lands gives a height that's short by ~24px.
  extra.style.maxHeight = extra.scrollHeight + 'px';

  const done = (e) => {
    if (e.propertyName !== 'max-height') return;
    // Release the cap once open so the panel can reflow freely on resize or
    // late font loads instead of staying clipped at its measured height.
    extra.style.maxHeight = 'none';
    extra.removeEventListener('transitionend', done);
  };
  extra.addEventListener('transitionend', done);
}

function closeBox(box) {
  const extra = $('.extra', box);
  if (extra) {
    // Come back from 'none' to a concrete height first, otherwise there's
    // nothing for the transition to animate from and it snaps shut.
    extra.style.maxHeight = extra.scrollHeight + 'px';
    void extra.offsetHeight; // force reflow so the two writes are distinct
    extra.style.maxHeight = '0px';
    extra.inert = true;
  }
  box.classList.remove('active');
  box.setAttribute('aria-expanded', 'false');
}

function toggleBox(box) {
  const wasActive = box.classList.contains('active');
  $$('.coaching-box').forEach(b => { if (b !== box) closeBox(b); });
  if (wasActive) closeBox(box); else openBox(box);
}

// Used by the "as a leader" / "as a team" links in the section subhead.
function revealBox(id) {
  const box = document.getElementById(id);
  if (!box) return;
  if (!box.classList.contains('active')) toggleBox(box);

  if (heroCollapsed) lockNavDuringScroll();
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });

  box.classList.remove('just-targeted');
  void box.offsetWidth;
  box.classList.add('just-targeted');
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('.offer-link');
  if (!link) return;
  const href = link.getAttribute('href') || '';
  // Only fragment links point at a box. .offer-link is also used on a mailto
  // that opens the contact panel, and that one is handled elsewhere.
  if (href.charAt(0) !== '#') return;
  const id = href.slice(1);
  if (!id) return;
  e.preventDefault();
  revealBox(id);
});

/* ==================== BADGE INJECTION ==================== */
(function initBadges() {
  const badgeMap = {
    'Central 1': ['Banking', 'banking'],
    'Johns Hopkins University': ['Global Health', 'health'],
    'REBC Forms App': ['Public Sector', 'public'],
    'United Way': ['Nonprofit', 'nonprofit'],
    'BlueShore Financial': ['Banking', 'banking'],
    'LTSA': ['Public Sector', 'public'],
    'RECBC Knowledge Base': ['Public Sector', 'public'],
    'Rouxbe': ['Education', 'education'],
    'PEPFAR': ['Global Health', 'health'],
    'OECD': ['Public Sector', 'public'],
    'CanWaCH': ['Global Health', 'health']
  };

  function addBadge(root) {
    const h = $('h1, h2, h3', root);
    if (!h || h.previousElementSibling?.classList.contains('case-badge')) return;

    for (const [key, [label, cls]] of Object.entries(badgeMap)) {
      if (h.textContent.toLowerCase().includes(key.toLowerCase())) {
        const span = document.createElement('span');
        span.className = `work-badge case-badge ${cls}`;
        span.textContent = label;
        h.parentNode.insertBefore(span, h);
        h.parentNode.insertBefore(document.createElement('br'), h);
        break;
      }
    }
  }

  $$('.panel, .panel-body, .overlay-content').forEach(addBadge);

  new MutationObserver(muts => {
    muts.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          if (node.matches?.('.panel, .panel-body')) addBadge(node);
          $$('.panel, .panel-body', node).forEach(addBadge);
        }
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
})();

/* ==================== NAVIGATION SETUP ==================== */

function initNavigation() {
  const navShield = $('#navShield');
  const navWords = $$('.nav-word[data-link^="#"]');
  const globalNavWords = $$('.nav-word[data-link^="#"]:not(.footer-link)');

  if (!navShield) createNavShield();

  const sectionMap = {
    '#coaching': $('section#coaching h1, section#coaching h2'),
    '#work': $('section#work h1, section#work h2'),
    '#about': $('section#about h1, section#about h2')
  };

  function updateNavActive() {
    const shield = $('#navShield');
    if (!shield) return;

    const shieldRect = shield.getBoundingClientRect();
    let activeLink = null;

    for (const [link, heading] of Object.entries(sectionMap)) {
      if (!heading) continue;
      const rect = heading.getBoundingClientRect();
      if (rect.top <= shieldRect.bottom + 10) { // Slight buffer
        activeLink = link;
      }
    }

    globalNavWords.forEach(w => {
      w.classList.toggle('active', w.dataset.link === activeLink);
    });
  }

  // Coalesce into one rAF-batched read+write per frame instead of running a
  // getBoundingClientRect() read on every raw scroll event, same fix as the
  // hero animation's own scroll handler.
  let navActiveRafPending = false;
  function scheduleUpdateNavActive() {
    if (navActiveRafPending) return;
    navActiveRafPending = true;
    requestAnimationFrame(() => {
      navActiveRafPending = false;
      updateNavActive();
    });
  }

  window.addEventListener('scroll', scheduleUpdateNavActive, { passive: true });
  window.addEventListener('resize', scheduleUpdateNavActive, { passive: true });

  navWords.forEach(nav => {
    nav.addEventListener('click', (e) => {
      e.preventDefault();
      
      const targetId = nav.dataset.link;
      const section = $(targetId);
      if (!section) return;

      const heading = $('h1, h2', section) || section;
      const shield = $('#navShield');
      const navHeight = shield?.offsetHeight || 100;
      const isMobile = window.innerWidth < 900;

      // 1. Force state update if navigating to prevent height shifts
      if (isMobile && window.fadeSentence) {
        window.fadeSentence();
      }

      // 2. Calculate direction and target
      const rect = heading.getBoundingClientRect();
      const currentScroll = window.scrollY;
      const absoluteHeadingTop = currentScroll + rect.top;
      const isMovingUp = absoluteHeadingTop < currentScroll;

      let extraLift = 0;

      if (isMobile) {
        // Mobile specific logic
        if (isMovingUp) {
          // Coming up from below (e.g. the footer) needs more room at the
          // top than a downward jump, or the heading lands off-screen.
          extraLift = { '#coaching': 80, '#work': 40, '#about': 30 }[targetId] ?? 20;
        } else {
          // Standard downward or neutral offsets
          extraLift = { '#coaching': 10, '#work': -10, '#about': -30 }[targetId] || 0;
        }
      } else {
        // Desktop specific logic
        if (isMovingUp) {
          // Less negative = more space at top, same reasoning as mobile above.
          extraLift = { '#coaching': -140, '#work': -160, '#about': -180 }[targetId] ?? -160;
        } else {
          extraLift = { '#coaching': -220, '#work': -240, '#about': -260 }[targetId] || -280;
        }
      }

      let target = Math.max(0, absoluteHeadingTop - (navHeight + extraLift));

      // 3. Execute Scroll
      if (isMobile) {
        // Same rules as the desktop spring: never land back inside the hero's
        // range, and hold the nav until the scroll has genuinely settled.
        // Native smooth scrolling has no completion callback and regularly runs
        // past a second on a long jump, which is why the old fixed timeout kept
        // releasing the lock early.
        if (heroCollapsed) {
          target = Math.max(target, HERO_SCROLL_TOTAL);
          lockNavDuringScroll();
        }
        window.scrollTo({
          top: target,
          behavior: 'smooth'
        });
      } else {
        scrollToWithBounce(target, 1300);
      }

      // 4. UI Update
      globalNavWords.forEach(w => w.classList.remove('active'));
      if (!nav.classList.contains('footer-link')) {
        nav.classList.add('active');
      }
    });
  });
}
function createNavShield() {
  const shield = document.createElement('div');
  shield.id = 'navShield';
  document.body.appendChild(shield);

  function toggleShield() {
    shield.style.opacity = window.scrollY > window.innerHeight * 0.35 ? 1 : 0;
  }

  // rAF-coalesced, same reasoning as the other scroll listeners here: this
  // read+write shouldn't run once per raw scroll event on top of everything
  // else already doing that on the same frame.
  let shieldRafPending = false;
  window.addEventListener('scroll', () => {
    if (shieldRafPending) return;
    shieldRafPending = true;
    requestAnimationFrame(() => {
      shieldRafPending = false;
      toggleShield();
    });
  }, { passive: true });
  window.addEventListener('load', toggleShield);
}

/* ==================== LUXURY SCROLL ==================== */
function scrollToWithBounce(targetY, duration = 1300) {
  // The spring below overshoots by roughly 17% of the distance travelled, and
  // every frame calls scrollTo, which fires a scroll event, which re-drives the
  // hero animation. Two things have to be true for the nav to hold still.
  //
  // First, the landing spot must sit past the hero. Section offsets use
  // negative extraLift values to show context above the heading, and on a short
  // viewport that can put the target back inside the hero's 520px range, where
  // the nav is legitimately supposed to re-expand. Clamp it.
  //
  // Second, the nav has to stay frozen for the WHOLE flight, including the
  // overshoot, and unfreeze only once the page has actually stopped moving.
  //
  // The logo click targets 0 on purpose and is left alone, because there the
  // hero is meant to come back.
  const goingToTop = targetY <= 0;
  if (heroCollapsed && !goingToTop) {
    targetY = Math.max(targetY, HERO_SCROLL_TOTAL);
    lockNavDuringScroll();
  }

  const startY = window.scrollY;
  const diff = targetY - startY;
  const startTime = performance.now();

  const easeOutSpring = t => {
    const damping = 5.6;
    const frequency = 2.0;
    return 1 - Math.pow(2, -damping * t) * Math.cos(t * frequency * Math.PI);
  };

  function step(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const eased = easeOutSpring(t);
    let nextY = startY + diff * eased;

    if (diff < 0 && nextY < targetY) {
      nextY = lerp(nextY, targetY, 0.25);
    }

    window.scrollTo(0, nextY);

    if (t < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

window.scrollToWithBounce = scrollToWithBounce;

/* ==================== LOGO SETUP ==================== */
function initLogo() {
  const logo = $('.logoBox');
  const logoLink = $('#logo-link');

  if (!logo) return;

  // Create and style logo backer
  let backer = $('.logo-backer', logo);
  if (!backer) {
    backer = document.createElement('div');
    backer.className = 'logo-backer';
    logo.prepend(backer);
  }

  const brandColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--brand')
    .trim() || '#fb5449';

  Object.assign(backer.style, {
    position: 'absolute',
    inset: '0',
    background: brandColor,
    zIndex: '0'
  });

  const svg = $('svg', logo);
  if (svg) svg.style.position = 'relative';

  // Lock logo to square
  function lockSquare() {
    const w = logo.offsetWidth;
    logo.style.height = w + 'px';
  }

  window.addEventListener('resize', lockSquare, { passive: true });
  window.addEventListener('load', lockSquare);
  lockSquare();

  // Logo click handler
  if (logoLink) {
    logoLink.addEventListener('click', (e) => {
      e.preventDefault();

      // Close overlay
      const overlay = $('#overlay');
      if (overlay) {
        overlay.classList.remove('open');
        document.body.classList.remove('overlay-open');
      }

      // Clear nav highlights
      $$('.nav-word').forEach(w => w.classList.remove('active'));

      // Scroll to top with bounce
      scrollToWithBounce(0, 900);

      // Reload when at top
      let tries = 0;
      const tick = () => {
        tries++;
        if (window.scrollY <= 1 || tries >= 180) {
          if (history.replaceState) {
            history.replaceState(null, '', location.pathname + location.search);
          }
          location.reload();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
}

/* --- CLEAN PRIVACY OPEN/CLOSE --- */
document.addEventListener("DOMContentLoaded", () => {
  const privacyToggle = document.querySelector(".footer-privacy-toggle");
  const privacyPanel = document.querySelector("#privacy-panel");
  const privacyClose = document.querySelector(".privacy-close-link");
  const footer = document.querySelector("footer");

  if (!privacyPanel) return;

  // OPEN
  if (privacyToggle) {
    privacyToggle.addEventListener("click", e => {
      e.preventDefault();
      privacyPanel.classList.add("open");

      requestAnimationFrame(() => {
        if (heroCollapsed) lockNavDuringScroll();
        privacyPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  // CLOSE
  if (privacyClose) {
    privacyClose.addEventListener("click", e => {
      e.preventDefault();
      privacyPanel.classList.remove("open");

      requestAnimationFrame(() => {
        if (heroCollapsed) lockNavDuringScroll();
        footer.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }
});




function updateAnnivTagState() {
  const tag = document.getElementById('anniv-tag');
  if (!tag) return;

  // Scrolled past hero section
  if (window.scrollY > (window.innerHeight * 0.35)) {
    tag.classList.add('on-white');
  } else {
    tag.classList.remove('on-white');
  }

  // On mobile, the hero sentence travels sideways then upward as you scroll,
  // passing close to the "25 YEARS" tag's corner along the way. The tag is
  // only meaningful at rest, so hide it as soon as scrolling starts instead
  // of trying to route the sentence's path around it precisely.
  if (window.innerWidth < 900) {
    document.body.classList.toggle('hero-scrolling', window.scrollY > 20);
  }
}

// rAF-coalesced, same reasoning as the other scroll listeners in this file:
// this was running a full read+write on every raw scroll event.
let annivTagRafPending = false;
window.addEventListener('scroll', () => {
  if (annivTagRafPending) return;
  annivTagRafPending = true;
  requestAnimationFrame(() => {
    annivTagRafPending = false;
    updateAnnivTagState();
  });
}, { passive: true });