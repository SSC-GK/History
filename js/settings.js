import { config, state, saveSettings, subscribe } from './state.js';
import { dom } from './dom.js';
import { initializeAllFireballs_anim, animateFireballs_anim } from './animations.js';
import { Toast } from './utils.js';

/**
 * Initializes all settings-related subscriptions. This function is called once
 * when the application starts. It makes the settings UI reactive to state changes.
 */
export function initSettingsModule() {
    subscribe('isDarkMode', (data) => applyTheme(data.newValue));
    subscribe('animationsDisabled', (data) => applyAnimationSetting(data.newValue));
    subscribe('isMuted', (data) => updateSoundToggleUI(data.newValue));
    subscribe('isShuffleActive', (data) => updateShuffleToggleUI(data.newValue));
    subscribe('isHapticEnabled', (data) => updateHapticToggleUI(data.newValue));
    subscribe('isHeaderCollapsed', (data) => applyHeaderCollapsedState(data.newValue));
}

export function toggleSettings(forceClose = false) {
    if (forceClose) {
        dom.settingsOverlay.classList.remove('visible');
        setTimeout(() => dom.settingsOverlay.style.display = 'none', 300);
    } else {
        const isVisible = dom.settingsOverlay.classList.contains('visible');
        if (isVisible) {
            dom.settingsOverlay.classList.remove('visible');
            setTimeout(() => dom.settingsOverlay.style.display = 'none', 300);
        } else {
            dom.settingsOverlay.style.display = 'flex';
            setTimeout(() => dom.settingsOverlay.classList.add('visible'), 10);
        }
    }
}

export function toggleDarkMode() {
    state.isDarkMode = !state.isDarkMode;
    saveSettings();
}

function applyTheme(isDark) {
    document.body.dataset.theme = isDark ? 'dark' : 'light';
    if (dom.darkModeToggle) dom.darkModeToggle.checked = isDark;
}

export function toggleAnimations() {
    state.animationsDisabled = !state.animationsDisabled;
    saveSettings();
}

function applyAnimationSetting(isDisabled) {
    document.body.classList.toggle('animations-disabled', isDisabled);
    if (dom.animationsToggle) dom.animationsToggle.checked = !isDisabled;
    
    if (!isDisabled && !state.isAnimating) {
        if (initializeAllFireballs_anim()) {
            state.isAnimating = true;
            animateFireballs_anim();
        }
    } else if (isDisabled) {
        state.isAnimating = false;
    }
}

export function toggleMute() {
    state.isMuted = !state.isMuted;
    saveSettings();
}

function updateSoundToggleUI(isMuted) {
    if (dom.soundToggle) dom.soundToggle.checked = !isMuted;
    if (dom.muteBtnReview) {
        dom.muteBtnReview.innerHTML = isMuted ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
    }
}

export function toggleShuffle() {
    const willBeShuffled = dom.shuffleToggle.checked;
    const wasShuffled = state.isShuffleActive;

    if (willBeShuffled === wasShuffled) return;

    const targetElement = dom.quizMainContainer.style.display !== 'none' ? dom.quizMainContainer : dom.filterSection;

    Swal.fire({
        target: targetElement,
        title: 'Change Question Order?',
        text: state.isQuizActive
            ? (willBeShuffled ? "This will shuffle your remaining unanswered questions." : "This will sort your remaining questions by ID.")
            : (willBeShuffled ? "Questions will be shuffled for your next quiz." : "Questions will be sorted by ID for your next quiz."),
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: 'var(--primary-color)',
        cancelButtonColor: 'var(--wrong-color)',
        confirmButtonText: `Yes, ${willBeShuffled ? 'Shuffle' : 'Sort'}!`,
        cancelButtonText: 'Cancel'
    }).then((result) => {
        if (result.isConfirmed) {
            state.isShuffleActive = willBeShuffled;
            saveSettings();

            if (state.isQuizActive && state.callbacks.reorderQuizQuestions) {
                state.callbacks.reorderQuizQuestions();
            }
            
            Toast.fire({
                target: targetElement,
                icon: 'success',
                title: state.isQuizActive 
                    ? `Remaining questions have been ${willBeShuffled ? 'shuffled' : 'sorted'}.`
                    : `Question order set to ${willBeShuffled ? 'shuffled' : 'sorted'} for next quiz.`
            });

        } else {
            // Revert the checkbox to its original state if user cancels
            dom.shuffleToggle.checked = wasShuffled;
        }
    });
}


function updateShuffleToggleUI(isShuffleActive) {
    if (dom.shuffleToggle) dom.shuffleToggle.checked = isShuffleActive;
}

export function toggleHapticFeedback() {
    state.isHapticEnabled = !state.isHapticEnabled;
    saveSettings();
}

function updateHapticToggleUI(isHapticEnabled) {
    if (dom.hapticToggle) dom.hapticToggle.checked = isHapticEnabled;
}

function applyHeaderCollapsedState(isCollapsed) {
    dom.collapsibleHeaderContent.classList.toggle('collapsed', isCollapsed);
    dom.toggleHeaderBtn.classList.toggle('collapsed', isCollapsed);
    dom.quizHeaderBar.classList.toggle('collapsed', isCollapsed);
    dom.toggleHeaderBtn.setAttribute('aria-expanded', !isCollapsed);
}

export function zoomIn() {
    if (state.currentZoomMultiplier < config.maxZoom) {
        state.currentZoomMultiplier = parseFloat((state.currentZoomMultiplier + config.zoomStep).toFixed(2));
        applyTextZoom();
    }
}

export function zoomOut() {
    if (state.currentZoomMultiplier > config.minZoom) {
        state.currentZoomMultiplier = parseFloat((state.currentZoomMultiplier - config.zoomStep).toFixed(2));
        applyTextZoom();
    }
}

export function applyTextZoom() {
    config.zoomableSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            if (!state.originalFontSizes.has(el)) {
                const computedStyle = window.getComputedStyle(el);
                state.originalFontSizes.set(el, parseFloat(computedStyle.fontSize));
            }
            const baseSize = state.originalFontSizes.get(el);
            if (baseSize && !isNaN(baseSize)) el.style.fontSize = (baseSize * state.currentZoomMultiplier) + 'px';
        });
    });
    updateZoomButtonStates();
}

function updateZoomButtonStates() {
    const quizZoomIn = document.getElementById('zoom-in-btn');
    const quizZoomOut = document.getElementById('zoom-out-btn');
    const reviewZoomIn = document.getElementById('zoom-in-btn-review');
    const reviewZoomOut = document.getElementById('zoom-out-btn-review');
    if (quizZoomIn) quizZoomIn.disabled = state.currentZoomMultiplier >= config.maxZoom;
    if (quizZoomOut) quizZoomOut.disabled = state.currentZoomMultiplier <= config.minZoom;
    if (reviewZoomIn) reviewZoomIn.disabled = state.currentZoomMultiplier >= config.maxZoom;
    if (reviewZoomOut) reviewZoomOut.disabled = state.currentZoomMultiplier <= config.minZoom;
}

export function toggleFullScreen() {
    const elem = document.getElementById('quiz-main-container');
    if (!document.fullscreenElement) {
        if (elem.requestFullscreen) elem.requestFullscreen();
        else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
        dom.fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
        dom.fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
    }
}

export function showAIExplanation() {
    if (!dom.aiExplanationOverlay) return;
    dom.aiExplanationOverlay.style.display = 'flex';
    setTimeout(() => dom.aiExplanationOverlay.classList.add('visible'), 10);
}

export function hideAIExplanation() {
    if (!dom.aiExplanationOverlay) return;
    dom.aiExplanationOverlay.classList.remove('visible');
    setTimeout(() => dom.aiExplanationOverlay.style.display = 'none', 300);
}