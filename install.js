'use strict';

(() => {
    const button = document.getElementById('install-app');
    const guide = document.getElementById('install-guide');
    const displayMode = window.matchMedia('(display-mode: standalone)');
    const eligible = window.isSecureContext && /^https?:$/.test(location.protocol) && 'serviceWorker' in navigator;
    if (!eligible) return;

    const apple = /iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const android = /Android/i.test(navigator.userAgent);
    let promptEvent = null;
    let installed = false;

    function syncButton() {
        button.hidden = installed || displayMode.matches || navigator.standalone === true;
    }

    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        promptEvent = event;
        syncButton();
    });
    window.addEventListener('appinstalled', () => {
        installed = true;
        promptEvent = null;
        if (guide.open) guide.close();
        syncButton();
    });
    displayMode.addEventListener?.('change', syncButton);
    syncButton();

    button.addEventListener('click', async () => {
        if (promptEvent) {
            const request = promptEvent;
            promptEvent = null;
            try {
                const choice = await request.prompt();
                if (choice?.outcome === 'accepted') {
                    installed = true;
                    syncButton();
                }
                return;
            } catch {
                // Offer the browser menu if the native prompt is no longer available.
            }
        }

        document.getElementById('install-iphone').hidden = android;
        document.getElementById('install-android').hidden = apple;
        if (!guide.open) guide.showModal();
    });
})();
