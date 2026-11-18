/**
 * AgroVoice & PWA Engine · AgroConecta Quillabamba
 * - Voz Femenina Natural Dalia Neural (Reproducción de Audio MP3 Studio Quality)
 * - PWA Offline-First y Registro de Service Worker
 */

const AgroVoice = (function() {
  let currentAudio = null;
  let activeBtn = null;

  function play(src, btnElement) {
    if (currentAudio && !currentAudio.paused && currentAudio.src.includes(src)) {
      stop();
      return;
    }

    stop();

    currentAudio = new Audio(src);
    activeBtn = btnElement || null;

    if (activeBtn) {
      activeBtn.classList.add("speaking");
      const txt = activeBtn.querySelector(".btn-voice-text");
      if (txt) txt.textContent = "Pausar Audio";
    }

    currentAudio.play().catch(e => {
      console.warn("[AgroVoice] Autoplay o reproducción bloqueada:", e);
      stop();
    });

    currentAudio.onended = function() {
      stop();
    };

    currentAudio.onerror = function(err) {
      console.warn("[AgroVoice] Fallo al cargar archivo MP3 offline, activando motor TTS Android (speechSynthesis)...");
      stop();
      if ('speechSynthesis' in window) {
        let msg = "Bienvenido a AgroConecta Quillabamba. La plataforma digital para productores del campo.";
        if (src.includes("precios")) {
          msg = "Precios referenciales del día en Quillabamba y La Convención: Café Pergamino Especial 17 soles 50 el kilo, Cacao Chuncho Fino 24 soles el kilo, Plátano Seda 28 soles el racimo, Palta Hass 7 soles 50 el kilo.";
        }
        speakText(msg, btnElement);
      }
    };
  }

  function speakText(text, btnElement) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'es-PE';
    utter.rate = 0.95;
    activeBtn = btnElement || null;
    if (activeBtn) {
      activeBtn.classList.add("speaking");
      const txt = activeBtn.querySelector(".btn-voice-text");
      if (txt) txt.textContent = "Pausar";
    }
    utter.onend = function() { stop(); };
    utter.onerror = function() { stop(); };
    window.speechSynthesis.speak(utter);
  }

  function stop() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    document.querySelectorAll(".btn-voice-speaker").forEach(btn => {
      btn.classList.remove("speaking");
      const txt = btn.querySelector(".btn-voice-text");
      if (txt) {
        if (btn.id === "btnVoicePrices") {
          txt.textContent = "Escuchar Precios";
        } else {
          txt.textContent = "Escuchar";
        }
      }
    });
  }

  function toggle(src, btnElement) {
    if (currentAudio && !currentAudio.paused) {
      stop();
    } else {
      play(src, btnElement);
    }
  }

  return {
    play,
    stop,
    toggle,
    isActive: () => currentAudio && !currentAudio.paused
  };
})();

// ========================================================
// REGISTRO DE SERVICE WORKER (PWA) Y PROMPT DE INSTALACIÓN
// ========================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js")
      .then((reg) => {
        console.log("[PWA] Service Worker registrado con éxito:", reg.scope);
      })
      .catch((err) => {
        console.log("[PWA] Registro de Service Worker omitido:", err);
      });
  });
}

let deferredPwaPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPwaPrompt = e;
  
  const banner = document.getElementById("pwaInstallBanner");
  if (banner) {
    banner.style.display = "flex";
  }
});

function triggerPwaInstall() {
  if (deferredPwaPrompt) {
    deferredPwaPrompt.prompt();
    deferredPwaPrompt.userChoice.then((choice) => {
      console.log("[PWA] Elección del usuario:", choice.outcome);
      deferredPwaPrompt = null;
      const banner = document.getElementById("pwaInstallBanner");
      if (banner) banner.style.display = "none";
    });
  } else {
    alert("Para instalar en tu celular: Abre el menú de tu navegador (los 3 puntos o Compartir) y elige 'Agregar a la pantalla principal' o 'Instalar aplicación'.");
  }
}
