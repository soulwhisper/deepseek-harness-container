/**
 * Minimal mobile layout switch for the DSH Web client.
 *
 * Scope: layout, safe area, viewport keyboard model and a two-state button.
 * No portal, no QR pairing, no tunnel, no custom keyboard.
 */
window.__ModuleLoader__.load({
  id: '@soulwhisper/dsh-mobile-layout',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;

    const STORAGE_KEY = 'dsh-mobile-layout';
    const MOBILE_QUERY = '(max-width: 1023px)';
    const VIEWPORT_CONTENT = 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content';
    const CSS = `
#dsh-mobile-layout-toggle {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 8px);
  right: 8px;
  z-index: 1400;
  min-width: 64px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 15%));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2, #fff);
  color: var(--dsw-alias-label-primary, #111);
  font: 12px/1 var(--dsw-font-family, system-ui, sans-serif);
  opacity: .78;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
#dsh-mobile-layout-toggle:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4f6ef7);
  outline-offset: 2px;
}
html[data-dsh-mobile-layout="mobile"] body {
  overflow-x: hidden;
  overscroll-behavior-x: none;
}
html[data-dsh-mobile-layout="mobile"] [data-dsh-mobile-layout-frame] {
  box-sizing: border-box !important;
  grid-template-columns: minmax(0, 1fr) 0 0 !important;
  padding-top: env(safe-area-inset-top, 0px) !important;
  padding-bottom: env(safe-area-inset-bottom, 0px) !important;
}
html[data-dsh-mobile-layout="mobile"] [data-dsh-mobile-layout-frame] > :first-child {
  position: absolute !important;
  inset: 0 auto 0 0 !important;
  width: min(86vw, 320px) !important;
  box-sizing: border-box !important;
  z-index: 1300 !important;
  padding-top: env(safe-area-inset-top, 0px) !important;
  overflow-x: hidden;
  background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1, #fff));
  border-right: .5px solid var(--dsw-alias-border-l3, transparent);
  transform: translateX(-110%);
  transition: transform .2s ease;
}
html[data-dsh-mobile-layout="mobile"] [data-dsh-mobile-layout-frame]:not([data-sidebar-collapsed]) > :first-child {
  transform: translateX(0);
}
html[data-dsh-mobile-layout="mobile"] [data-dsh-mobile-layout-frame]:not([data-sidebar-collapsed])::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1200;
  background: rgb(0 0 0 / 35%);
}
html[data-dsh-mobile-layout="mobile"] [data-dsh-mobile-layout-frame] > :nth-child(2) {
  min-width: 0;
}
html[data-dsh-mobile-layout="mobile"] [class*="_composerSeat"] {
  padding-bottom: max(8px, env(safe-area-inset-bottom, 0px));
}
html[data-dsh-mobile-layout="mobile"] input,
html[data-dsh-mobile-layout="mobile"] textarea,
html[data-dsh-mobile-layout="mobile"] [contenteditable="true"] {
  font-size: 16px !important;
}
`;

    function normalizeMode(value) {
      return value === 'mobile' || value === 'desktop' ? value : 'auto';
    }

    function resolveMode({ url, stored, narrow }) {
      const mode = normalizeMode(url ?? stored);
      if (mode !== 'auto') return mode;
      return narrow ? 'mobile' : 'desktop';
    }

    function nextMode(mode) {
      return mode === 'mobile' ? 'desktop' : 'mobile';
    }

    function viewportContent(mode) {
      return mode === 'mobile' ? VIEWPORT_CONTENT : null;
    }

    function apply(ctx) {
      if (typeof document === 'undefined' || typeof window === 'undefined') return;

      ctx.effect(() => {
        const root = document.documentElement;
        const media = window.matchMedia
          ? window.matchMedia(MOBILE_QUERY)
          : { matches: false, addEventListener() {}, removeEventListener() {} };
        const viewportMeta = document.querySelector('meta[name="viewport"]');
        const originalViewport = viewportMeta === null ? null : viewportMeta.content;
        const urlMode = new URL(window.location.href).searchParams.get('layout');
        let stored = null;
        try {
          stored = window.localStorage.getItem(STORAGE_KEY);
        } catch {
          /* private mode / storage disabled */
        }
        let explicit = normalizeMode(urlMode ?? stored);
        if (urlMode !== null) {
          try {
            window.localStorage.setItem(STORAGE_KEY, explicit);
          } catch {
            /* ignore */
          }
        }
        let current = resolveMode({ url: urlMode, stored, narrow: media.matches });
        let frame = null;
        let liftedSeat = null;
        let appliedLift = 0;
        let keyboardFrame = 0;

        for (const stale of document.querySelectorAll('style[data-dsh-mobile-layout-style]')) stale.remove();
        document.querySelector('#dsh-mobile-layout-toggle')?.remove();

        const style = document.createElement('style');
        style.dataset.dshMobileLayoutStyle = '';
        style.textContent = CSS;
        document.head.appendChild(style);

        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'dsh-mobile-layout-toggle';
        button.dataset.dshMobileLayoutToggle = '';
        button.addEventListener('click', toggle);
        document.body.appendChild(button);

        function findFrame() {
          return document.querySelector('[data-shell-overlay]')?.parentElement ?? null;
        }

        function markFrame() {
          const next = findFrame();
          if (next === frame) return;
          if (frame !== null) frame.removeAttribute('data-dsh-mobile-layout-frame');
          frame = next;
          if (frame !== null) frame.setAttribute('data-dsh-mobile-layout-frame', '');
        }

        function clearSeat() {
          if (liftedSeat !== null) liftedSeat.style.transform = '';
          liftedSeat = null;
          appliedLift = 0;
        }

        function updateKeyboard() {
          if (keyboardFrame !== 0) return;
          const run = () => {
            keyboardFrame = 0;
            const viewport = window.visualViewport;
            const height = viewport?.height ?? window.innerHeight;
            root.style.setProperty('--dsh-mobile-visible-height', `${height}px`);
            const seat = current === 'mobile'
              ? document.querySelector('[data-dsh-mobile-layout-frame] [class*="_composerSeat"]')
              : null;
            if (seat === null) {
              clearSeat();
              return;
            }
            if (seat !== liftedSeat) {
              clearSeat();
              liftedSeat = seat;
            }
            const bottom = seat.getBoundingClientRect().bottom + appliedLift;
            const overlap = bottom - height;
            appliedLift = overlap > 0 ? overlap : 0;
            seat.style.transform = appliedLift > 0 ? `translateY(${-appliedLift}px)` : '';
          };
          if (typeof requestAnimationFrame === 'function') {
            keyboardFrame = requestAnimationFrame(run);
          } else {
            run();
          }
        }

        function paintButton() {
          const mobile = current === 'mobile';
          button.textContent = mobile ? 'Desktop' : 'Mobile';
          button.title = mobile ? 'Switch to desktop layout' : 'Switch to mobile layout';
          button.setAttribute('aria-label', button.title);
        }

        function applyMode() {
          current = resolveMode({ url: null, stored: explicit, narrow: media.matches });
          root.dataset.dshMobileLayout = current;
          root.dataset.dshMobileLayoutMode = explicit;
          if (viewportMeta !== null) {
            if (current === 'mobile') viewportMeta.content = VIEWPORT_CONTENT;
            else if (originalViewport !== null) viewportMeta.content = originalViewport;
          }
          paintButton();
          markFrame();
          updateKeyboard();
        }

        function toggle() {
          explicit = nextMode(current);
          try {
            window.localStorage.setItem(STORAGE_KEY, explicit);
          } catch {
            /* ignore */
          }
          applyMode();
        }

        function onMediaChange() {
          if (explicit === 'auto') applyMode();
        }

        function onViewportChange() {
          updateKeyboard();
        }

        function onDocumentClick(event) {
          if (current !== 'mobile' || frame === null) return;
          if (frame.hasAttribute('data-sidebar-collapsed')) return;
          if (event.target === frame) ctx.layout?.toggleSidebar?.();
        }

        const viewportObserver = viewportMeta === null
          ? null
          : new MutationObserver(() => {
              if (current === 'mobile' && viewportMeta.content !== VIEWPORT_CONTENT) {
                viewportMeta.content = VIEWPORT_CONTENT;
              }
            });
        viewportObserver?.observe(viewportMeta, { attributes: true, attributeFilter: ['content'] });

        const frameObserver = new MutationObserver(markFrame);
        frameObserver.observe(document.body, { childList: true, subtree: true });

        media.addEventListener('change', onMediaChange);
        window.addEventListener('resize', onViewportChange);
        window.visualViewport?.addEventListener('resize', onViewportChange);
        window.visualViewport?.addEventListener('scroll', onViewportChange);
        document.addEventListener('focusin', onViewportChange, true);
        document.addEventListener('focusout', onViewportChange, true);
        document.addEventListener('click', onDocumentClick, true);

        applyMode();

        return () => {
          media.removeEventListener('change', onMediaChange);
          window.removeEventListener('resize', onViewportChange);
          window.visualViewport?.removeEventListener('resize', onViewportChange);
          window.visualViewport?.removeEventListener('scroll', onViewportChange);
          document.removeEventListener('focusin', onViewportChange, true);
          document.removeEventListener('focusout', onViewportChange, true);
          document.removeEventListener('click', onDocumentClick, true);
          viewportObserver?.disconnect();
          frameObserver.disconnect();
          if (keyboardFrame !== 0) cancelAnimationFrame(keyboardFrame);
          clearSeat();
          if (frame !== null) frame.removeAttribute('data-dsh-mobile-layout-frame');
          delete root.dataset.dshMobileLayout;
          delete root.dataset.dshMobileLayoutMode;
          root.style.removeProperty('--dsh-mobile-visible-height');
          if (viewportMeta !== null && originalViewport !== null) viewportMeta.content = originalViewport;
          button.removeEventListener('click', toggle);
          button.remove();
          style.remove();
        };
      }, 'dsh-mobile-layout: shell');
    }

    exports.apply = apply;
    exports.inject = ['layout'];
    exports.resolveMode = resolveMode;
    exports.nextMode = nextMode;
    exports.viewportContent = viewportContent;
    return exports;
  },
});
