// ==========================================================================
// CONFIG
// ==========================================================================
// Paste the OAuth Client ID from Google Cloud Console here.
// See SETUP.md for step-by-step instructions on creating one.
const GOOGLE_CLIENT_ID = "884631834825-8rf9ej6h5ivo4gqm83llko84u2dp4osn.apps.googleusercontent.com";

// API key for the Google Picker (Google Cloud Console > Credentials > API Key,
// with the Google Picker API enabled). Different from the OAuth Client ID above.
const GOOGLE_API_KEY = "AIzaSyD_UrWapDTFcl1Vgp1IvfR7GW22JIkT1BI";

// Cloud project number (the numeric prefix of GOOGLE_CLIENT_ID). Required by
// Picker for drive.file grants to actually attach to the picked file.
const GOOGLE_APP_ID = "884631834825";

// drive.file: only grants access to files the user explicitly picks via
// Google Picker below, nothing else in their Drive.
const SCOPE = "https://www.googleapis.com/auth/drive.file";

// ==========================================================================
// STATE
// ==========================================================================
let accessToken = null;
let tokenClient = null;
let docText = "";
let wakeLock = null;

// Average speaking-read pace, used only for the estimate shown before play.
const WORDS_PER_MINUTE = 140;

const STORAGE_KEY = "teleprompter-settings";

// ==========================================================================
// DOM
// ==========================================================================
const modePasteBtn = document.getElementById("mode-paste-btn");
const modeGdocBtn = document.getElementById("mode-gdoc-btn");
const pasteSection = document.getElementById("paste-section");
const gdocSection = document.getElementById("gdoc-section");
const pasteTextarea = document.getElementById("paste-textarea");
const useTextBtn = document.getElementById("use-text-btn");

const signedInAs = document.getElementById("signed-in-as");
const docRow = document.getElementById("doc-row");
const pickBtn = document.getElementById("pick-btn");
const statusMsg = document.getElementById("status-msg");
const controlsRow = document.getElementById("controls-row");
const speedSlider = document.getElementById("speed");
const mirrorToggle = document.getElementById("mirror-toggle");
const flipToggle = document.getElementById("flip-toggle");
const countdownToggle = document.getElementById("countdown-toggle");
const startBtn = document.getElementById("start-btn");

const fontFamilySelect = document.getElementById("font-family");
const fontSizeSelect = document.getElementById("font-size");
const lineHeightSelect = document.getElementById("line-height");
const alignLeftBtn = document.getElementById("align-left-btn");
const alignCenterBtn = document.getElementById("align-center-btn");
const fullscreenBtn = document.getElementById("fullscreen-btn");
const restartBtn = document.getElementById("restart-btn");
const textPreview = document.getElementById("text-preview");
const playPauseIcon = document.getElementById("playpause-icon");

const docStats = document.getElementById("doc-stats");
const prompterHud = document.getElementById("prompter-hud");

const signupToggleBtn = document.getElementById("signup-toggle-btn");
const signupInlineForm = document.getElementById("signup-inline-form");
const signupEmailInput = document.getElementById("signup-email");
const signupThanks = document.getElementById("signup-thanks");

const editToggleBtn = document.getElementById("edit-toggle-btn");
const editRow = document.getElementById("edit-row");
const editTextarea = document.getElementById("edit-textarea");
const saveEditBtn = document.getElementById("save-edit-btn");
const cancelEditBtn = document.getElementById("cancel-edit-btn");

const setupScreen = document.getElementById("setup-screen");
const countdownScreen = document.getElementById("countdown-screen");
const countdownNumber = document.getElementById("countdown-number");
const prompterScreen = document.getElementById("prompter-screen");
const prompterText = document.getElementById("prompter-text");
const exitBtn = document.getElementById("exit-btn");
const playPauseBtn = document.getElementById("playpause-btn");
const speedLive = document.getElementById("speed-live");

// ==========================================================================
// AUTH
// ==========================================================================
function setStatus(msg, isError = true) {
  statusMsg.textContent = msg || "";
  statusMsg.style.color = isError ? "#ff8080" : "#7fd67f";
}

// ==========================================================================
// LOCAL STORAGE (doc link + preferences, saved on this device)
// ==========================================================================
function loadSavedSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.pastedText) pasteTextarea.value = saved.pastedText;
    if (saved.speed) {
      speedSlider.value = saved.speed;
      speedLive.value = saved.speed;
    }
    if (typeof saved.mirror === "boolean") mirrorToggle.checked = saved.mirror;
    if (typeof saved.flip === "boolean") flipToggle.checked = saved.flip;
    if (typeof saved.countdown === "boolean") countdownToggle.checked = saved.countdown;
    if (saved.fontFamily) fontFamilySelect.value = saved.fontFamily;
    if (saved.fontSize) fontSizeSelect.value = saved.fontSize;
    if (saved.lineHeight) lineHeightSelect.value = saved.lineHeight;
    if (saved.align === "left" || saved.align === "center") {
      currentAlign = saved.align;
      alignLeftBtn.classList.toggle("active", saved.align === "left");
      alignCenterBtn.classList.toggle("active", saved.align === "center");
    }
    applyTextFormatting();
  } catch (e) {
    // corrupted or unavailable storage, ignore and start fresh
  }
}

function saveSettings(partial) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const current = raw ? JSON.parse(raw) : {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...partial }));
  } catch (e) {
    // storage full or unavailable, fail silently
  }
}

window.addEventListener("load", () => {
  loadSavedSettings();

  // Fullscreen isn't supported for arbitrary elements in iOS/iPadOS Safari,
  // only hide the button where it wouldn't actually do anything.
  if (!fullscreenSupported()) {
    fullscreenBtn.style.display = "none";
  }

  if (GOOGLE_CLIENT_ID.startsWith("PASTE_") || GOOGLE_API_KEY.startsWith("PASTE_")) {
    setStatus("Google Client ID / API key not configured yet. See SETUP.md.");
    modeGdocBtn.disabled = true;
    return;
  }

  if (window.gapi) {
    gapi.load("picker", () => { pickerLoaded = true; });
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPE,
    callback: (resp) => {
      if (resp.error) {
        setStatus("Sign-in failed: " + resp.error);
        return;
      }
      accessToken = resp.access_token;
      signedInAs.textContent = "Signed in ✓";
      docRow.classList.remove("hidden");
      setStatus("");
    },
  });
});

// ==========================================================================
// LOAD DOC
// ==========================================================================
let pickerLoaded = false;

function formatMinutes(mins) {
  if (mins < 1) return `${Math.max(1, Math.round(mins * 60))} sec`;
  const whole = Math.floor(mins);
  const secs = Math.round((mins - whole) * 60);
  return secs > 0 ? `${whole} min ${secs} sec` : `${whole} min`;
}

function updateDocStats() {
  const wordCount = docText.split(/\s+/).filter(Boolean).length;
  const readMinutes = wordCount / WORDS_PER_MINUTE;
  docStats.textContent = `${wordCount} words · ~${formatMinutes(readMinutes)} at a natural speaking pace`;
  docStats.classList.remove("hidden");
  applyTextFormatting();
}

async function loadDocById(docId) {
  setStatus("Loading doc...", false);
  pickBtn.disabled = true;

  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!res.ok) {
      if (res.status === 401) {
        setStatus("Session expired. Sign in again.");
      } else if (res.status === 404) {
        setStatus("Doc not found, or this account doesn't have access to it.");
      } else {
        setStatus(`Failed to load doc (${res.status}).`);
      }
      return;
    }

    docText = (await res.text()).replace(/\r\n/g, "\n").trim();

    if (!docText) {
      setStatus("Doc loaded but it looks empty.");
      return;
    }

    updateDocStats();
    setStatus("Doc loaded.", false);
    controlsRow.classList.remove("hidden");
    editToggleBtn.classList.remove("hidden");
  } catch (err) {
    setStatus("Network error loading doc: " + err.message);
  } finally {
    pickBtn.disabled = false;
  }
}

function openPicker() {
  if (!pickerLoaded) {
    setStatus("Picker is still loading, try again in a second.");
    return;
  }
  const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
    .setMimeTypes("application/vnd.google-apps.document");

  const picker = new google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(accessToken)
    .setDeveloperKey(GOOGLE_API_KEY)
    .setAppId(GOOGLE_APP_ID)
    .setOrigin(window.location.protocol + "//" + window.location.host)
    .setCallback((data) => {
      if (data.action === google.picker.Action.PICKED) {
        const doc = data.docs[0];
        loadDocById(doc.id);
      }
    })
    .build();
  picker.setVisible(true);
}

pickBtn.addEventListener("click", () => {
  if (!accessToken) {
    setStatus("Sign in first.");
    return;
  }
  openPicker();
});

// ==========================================================================
// SOURCE MODE (paste text vs. Google Doc)
// ==========================================================================
function setSourceMode(mode) {
  const isPaste = mode === "paste";
  modePasteBtn.classList.toggle("active", isPaste);
  modeGdocBtn.classList.toggle("active", !isPaste);
  pasteSection.classList.toggle("hidden", !isPaste);
  gdocSection.classList.toggle("hidden", isPaste);
  setStatus("");
}

modePasteBtn.addEventListener("click", () => setSourceMode("paste"));
modeGdocBtn.addEventListener("click", () => {
  setSourceMode("gdoc");
  if (!accessToken && tokenClient) {
    tokenClient.requestAccessToken();
  }
});

useTextBtn.addEventListener("click", () => {
  const text = pasteTextarea.value.replace(/\r\n/g, "\n").trim();
  if (!text) {
    setStatus("Paste some text first.");
    return;
  }
  docText = text;
  updateDocStats();
  setStatus("Text ready.", false);
  controlsRow.classList.remove("hidden");
  editToggleBtn.classList.remove("hidden");
  saveSettings({ pastedText: text });
});

// ==========================================================================
// LIGHT SCRIPT EDITING (session-only, doesn't write back to the Doc)
// ==========================================================================
editToggleBtn.addEventListener("click", () => {
  editTextarea.value = docText;
  editRow.classList.remove("hidden");
  editTextarea.focus();
});

saveEditBtn.addEventListener("click", () => {
  docText = editTextarea.value.replace(/\r\n/g, "\n").trim();
  updateDocStats();
  editRow.classList.add("hidden");
  setStatus("Changes saved for this session.", false);
});

cancelEditBtn.addEventListener("click", () => {
  editRow.classList.add("hidden");
});

// ==========================================================================
// SPEED (px/sec). Slider 1-20 mapped to a comfortable reading-speed range.
// ==========================================================================
function speedToPxPerSec(v) {
  return 15 + Number(v) * 12; // ~27px/s to ~255px/s
}

speedSlider.addEventListener("input", () => {
  speedLive.value = speedSlider.value;
  saveSettings({ speed: speedSlider.value });
});

speedLive.addEventListener("input", () => {
  speedSlider.value = speedLive.value;
  currentSpeedPxPerSec = speedToPxPerSec(speedLive.value);
  saveSettings({ speed: speedLive.value });
});

mirrorToggle.addEventListener("change", () => {
  saveSettings({ mirror: mirrorToggle.checked });
  applyTextFormatting();
});

flipToggle.addEventListener("change", () => {
  saveSettings({ flip: flipToggle.checked });
  applyTextFormatting();
});

countdownToggle.addEventListener("change", () => {
  saveSettings({ countdown: countdownToggle.checked });
});

// ==========================================================================
// TEXT FORMATTING (font, size, line height, alignment)
// ==========================================================================
let currentAlign = "center";

function applyTextFormatting() {
  const fontSizePx = Number(fontSizeSelect.value);
  const lineHeightMult = Number(lineHeightSelect.value);
  const lineHeightPx = fontSizePx * lineHeightMult;

  const root = document.documentElement.style;
  root.setProperty("--tp-font-family", fontFamilySelect.value);
  root.setProperty("--tp-font-size", `${fontSizePx}px`);
  root.setProperty("--tp-line-height", String(lineHeightMult));
  root.setProperty("--tp-align", currentAlign);
  // The red line sits 2 lines above center, and the readable "focus zone"
  // fades out over roughly 3 lines each direction. Both are computed from
  // the actual chosen line height so they stay correct at any font size.
  root.setProperty("--tp-line-offset", `${lineHeightPx * 2}px`);
  root.setProperty("--tp-fade-radius", `${lineHeightPx * 3}px`);

  // Sample text on the setup screen mirrors the chosen font/size/spacing/
  // alignment so people can see the effect without needing to read raw
  // numbers. The real size (28-80px) is scaled down proportionally to fit
  // the small preview box while still visibly growing/shrinking with the
  // slider (roughly 14-30px in the preview).
  if (textPreview) {
    const previewPx = 14 + ((fontSizePx - 28) / (80 - 28)) * 16;
    textPreview.style.fontFamily = fontFamilySelect.value;
    textPreview.style.fontSize = `${previewPx}px`;
    textPreview.style.lineHeight = String(lineHeightMult);
    textPreview.style.textAlign = currentAlign;
    textPreview.textContent = docText
      ? docText.slice(0, 200)
      : "The quick brown fox jumps over the lazy dog. Your script will scroll and look like this.";

    const scaleX = mirrorToggle.checked ? -1 : 1;
    const scaleY = flipToggle.checked ? -1 : 1;
    textPreview.style.transform = `scale(${scaleX}, ${scaleY})`;
  }
}

function setAlign(align) {
  currentAlign = align;
  alignLeftBtn.classList.toggle("active", align === "left");
  alignCenterBtn.classList.toggle("active", align === "center");
  applyTextFormatting();
  saveSettings({ align });
}

fontFamilySelect.addEventListener("change", () => {
  applyTextFormatting();
  saveSettings({ fontFamily: fontFamilySelect.value });
});

fontSizeSelect.addEventListener("change", () => {
  applyTextFormatting();
  saveSettings({ fontSize: fontSizeSelect.value });
});

lineHeightSelect.addEventListener("change", () => {
  applyTextFormatting();
  saveSettings({ lineHeight: lineHeightSelect.value });
});

alignLeftBtn.addEventListener("click", () => setAlign("left"));
alignCenterBtn.addEventListener("click", () => setAlign("center"));

// Apply defaults immediately so the CSS variables exist before anything reads them.
applyTextFormatting();

// ==========================================================================
// TELEPROMPTER PLAYBACK
// ==========================================================================
let currentSpeedPxPerSec = speedToPxPerSec(speedSlider.value);
let scrollY = 0;
let playing = false;
let lastFrameTime = null;
let rafId = null;

function startCountdownThenPlay() {
  // Match the countdown's orientation to whatever the prompter screen will
  // use, so the flip/mirror settings apply from the very start, not just
  // once the script starts scrolling.
  countdownScreen.classList.toggle("mirrored", mirrorToggle.checked);
  countdownScreen.classList.toggle("flipped", flipToggle.checked);

  if (countdownToggle.checked) {
    setupScreen.classList.add("hidden");
    countdownScreen.classList.remove("hidden");
    const steps = ["•••", "••", "GO!"];
    let i = 0;
    countdownNumber.textContent = steps[i];
    countdownNumber.classList.remove("go");
    const interval = setInterval(() => {
      i += 1;
      if (i >= steps.length) {
        clearInterval(interval);
        countdownScreen.classList.add("hidden");
        enterPrompter();
      } else {
        countdownNumber.textContent = steps[i];
        countdownNumber.classList.toggle("go", steps[i] === "GO!");
      }
    }, 700);
  } else {
    setupScreen.classList.add("hidden");
    enterPrompter();
  }
}

// ==========================================================================
// FULLSCREEN
// ==========================================================================
function fullscreenSupported() {
  return !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
}

function toggleFullscreen() {
  const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
  if (!isFullscreen) {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch (e) {
    // wake lock not available (unsupported browser, low battery mode, etc.), fine to skip
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

function enterPrompter() {
  prompterText.textContent = docText;
  prompterScreen.classList.remove("hidden");
  prompterScreen.classList.toggle("mirrored", mirrorToggle.checked);
  prompterScreen.classList.toggle("flipped", flipToggle.checked);

  scrollY = 0;
  prompterText.style.transform = `translateY(0px)`;
  currentSpeedPxPerSec = speedToPxPerSec(speedSlider.value);
  speedLive.value = speedSlider.value;

  playing = true;
  if (playPauseIcon) playPauseIcon.textContent = "⏸";
  prompterScreen.classList.add("is-playing");
  lastFrameTime = null;
  rafId = requestAnimationFrame(tick);

  document.addEventListener("keydown", onKeydown);
  requestWakeLock();

  // The whole screen doubles as a giant pause button, tap anywhere to
  // pause/resume without hunting for the small button in the HUD.
  prompterScreen.addEventListener("click", onPrompterTap);

  // Push a history entry so the device/browser back button (or an iPad's
  // edge-swipe gesture) returns to the setup screen instead of leaving the
  // app entirely or navigating to whatever page was open before this one.
  window.history.pushState({ tpPrompter: true }, "");
}

function tick(t) {
  if (!playing) {
    lastFrameTime = null;
    rafId = requestAnimationFrame(tick);
    return;
  }
  if (lastFrameTime !== null) {
    const dt = (t - lastFrameTime) / 1000;
    scrollY += currentSpeedPxPerSec * dt;
    prompterText.style.transform = `translateY(-${scrollY}px)`;
  }
  lastFrameTime = t;
  rafId = requestAnimationFrame(tick);
}

function togglePlayPause() {
  playing = !playing;
  if (playPauseIcon) playPauseIcon.textContent = playing ? "⏸" : "▶";
  prompterScreen.classList.toggle("is-playing", playing);
}

function onPrompterTap(e) {
  if (e.target.closest("#prompter-hud")) return; // let HUD controls (buttons, slider) work normally
  togglePlayPause();
}

function restartScroll() {
  scrollY = 0;
  prompterText.style.transform = `translateY(0px)`;
}

// Does the actual work of leaving the prompter screen. Called either from
// the popstate handler below (when the back button/gesture fires) or
// directly by exitPrompter() as a fallback if there's no history state to
// pop (e.g. the tab was reloaded while already in the prompter).
function hidePrompterScreen() {
  playing = false;
  if (rafId) cancelAnimationFrame(rafId);
  prompterScreen.classList.add("hidden");
  setupScreen.classList.remove("hidden");
  document.removeEventListener("keydown", onKeydown);
  prompterScreen.removeEventListener("click", onPrompterTap);
  prompterScreen.classList.remove("mirrored", "flipped", "is-playing");
  countdownScreen.classList.remove("mirrored", "flipped");
  releaseWakeLock();
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    toggleFullscreen();
  }
}

// Triggered by the Esc key / exit button. If we pushed a history entry on
// the way in, go back through it (which fires popstate below and actually
// hides the screen) so the back-button history stays clean and consistent
// no matter which way the user exits.
function exitPrompter() {
  if (window.history.state && window.history.state.tpPrompter) {
    window.history.back();
  } else {
    hidePrompterScreen();
  }
}

// Hijack the browser/device back button (and iPad's edge-swipe-back
// gesture) while the prompter is showing, so it returns to the setup
// screen instead of navigating away from the app or to browser history.
window.addEventListener("popstate", () => {
  if (!prompterScreen.classList.contains("hidden")) {
    hidePrompterScreen();
  }
});

function onKeydown(e) {
  if (e.code === "Space") {
    e.preventDefault();
    togglePlayPause();
  } else if (e.code === "Escape") {
    exitPrompter();
  } else if (e.code === "ArrowUp") {
    e.preventDefault();
    speedSlider.value = Math.min(20, Number(speedSlider.value) + 1);
    speedLive.value = speedSlider.value;
    currentSpeedPxPerSec = speedToPxPerSec(speedSlider.value);
  } else if (e.code === "ArrowDown") {
    e.preventDefault();
    speedSlider.value = Math.max(1, Number(speedSlider.value) - 1);
    speedLive.value = speedSlider.value;
    currentSpeedPxPerSec = speedToPxPerSec(speedSlider.value);
  } else if (e.code === "ArrowRight") {
    // Nudge forward, useful for catching up if you're reading ahead of the scroll.
    e.preventDefault();
    scrollY = Math.max(0, scrollY + 80);
    prompterText.style.transform = `translateY(-${scrollY}px)`;
  } else if (e.code === "ArrowLeft") {
    // Nudge back, useful for a quick re-read or to reprise a missed line.
    e.preventDefault();
    scrollY = Math.max(0, scrollY - 80);
    prompterText.style.transform = `translateY(-${scrollY}px)`;
  }
}

startBtn.addEventListener("click", startCountdownThenPlay);
exitBtn.addEventListener("click", exitPrompter);
playPauseBtn.addEventListener("click", togglePlayPause);
fullscreenBtn.addEventListener("click", toggleFullscreen);
restartBtn.addEventListener("click", restartScroll);

// ==========================================================================
// INLINE SIGNUP (email capture, no page navigation)
// ==========================================================================
if (signupToggleBtn && signupInlineForm) {
  signupToggleBtn.addEventListener("click", () => {
    signupInlineForm.classList.toggle("hidden");
    if (!signupInlineForm.classList.contains("hidden")) {
      signupEmailInput.focus();
    }
  });

  signupInlineForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = signupInlineForm.querySelector("button[type='submit']");
    submitBtn.disabled = true;
    try {
      const res = await fetch("https://formspree.io/f/mwpvbdbr", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new FormData(signupInlineForm),
      });
      if (res.ok) {
        signupInlineForm.classList.add("hidden");
        signupToggleBtn.classList.add("hidden");
        signupThanks.classList.remove("hidden");
      } else {
        submitBtn.disabled = false;
        setStatus("Signup failed, try again in a moment.");
      }
    } catch (err) {
      submitBtn.disabled = false;
      setStatus("Signup failed: " + err.message);
    }
  });
}

// iOS releases the wake lock whenever the tab is backgrounded (e.g. app
// switcher, screen lock). Re-request it once we're back and still playing.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !prompterScreen.classList.contains("hidden") && playing) {
    requestWakeLock();
  }
});
