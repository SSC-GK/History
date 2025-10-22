/* ======================================================= */
/* ====== MAIN APP CONTROLLER FOR MODULAR QUIZ APP ======= */
/* ======================================================= */

// Import all modules
import { config, state, loadSettings, saveSettings, loadQuizState, clearQuizState } from './js/state.js';
import { dom, cacheDomElements } from './js/dom.js';
import * as auth from './js/auth.js';
import { Toast } from './js/utils.js';
import { initializeAllFireballs_anim, animateFireballs_anim } from './js/animations.js';
import { 
    applyInitialSettings, 
    toggleQuizSettings,
    toggleProfileSettings,
    toggleDarkMode, 
    toggleMute, 
    toggleShuffle, 
    toggleAnimations, 
    toggleHapticFeedback,
    zoomIn,
    zoomOut,
    toggleFullScreen,
    hideAIExplanation
} from './js/settings.js';
import { initFilterModule } from './js/filter.js';
import { initQuizModule, loadQuiz, resumeLoadedQuiz } from './js/quiz.js';
import { initReviewModule, showFinalScoreScreen } from './js/review.js';

// --- VIEW MANAGER ---
const mainSections = [
    'loginGate', 'homepageSection', 'filterSection', 'quizMainContainer', 
    'quizBreadcrumbContainer', 'finalScoreSection', 'reviewSection'
];
const modalOverlays = [
    'sideMenuOverlay', 'quizSettingsOverlay', 'profileSettingsOverlay', 'privacyPolicyOverlay',
    'aboutUsOverlay', 'userGuideOverlay', 'contentCreationOverlay'
];


/**
 * Hides all main application sections and shows only the specified one.
 * @param {string} viewId The ID of the section to show (e.g., 'homepage-section').
 * @param {object} [options={}] Optional parameters for the view.
 * @param {string} [options.mode] Special mode for a view, e.g., 'quiz' for filterSection.
 */
function showView(viewId, options = {}) {
    mainSections.forEach(key => {
        const element = document.getElementById(key.replace('Section', '-section'));
        if (dom[key] && dom[key].style) {
            dom[key].style.display = 'none';
        }
    });

    const targetElement = document.getElementById(viewId);
    if (targetElement) {
        // Special display types for certain sections
        if (viewId === 'login-gate') {
            targetElement.style.display = 'flex';
        } else if (viewId === 'quiz-main-container') {
            targetElement.style.display = 'block';
            if (dom.quizBreadcrumbContainer) dom.quizBreadcrumbContainer.style.display = 'block';
        } else {
            targetElement.style.display = 'block';
        }
    }

    // --- NEW LOGIC: Conditionally show/hide tabs on filter page ---
    if (viewId === 'filter-section') {
        const pptTab = document.querySelector('.tab-btn[data-tab="ppt-panel"]');
        const jsonTab = document.querySelector('.tab-btn[data-tab="json-panel"]');
        const quizTab = document.querySelector('.tab-btn[data-tab="quiz-panel"]');

        if (options.mode === 'quiz') {
            // Quiz-only mode: Hide premium tabs
            if (pptTab) pptTab.style.display = 'none';
            if (jsonTab) jsonTab.style.display = 'none';
            
            // Ensure the quiz tab is selected as it's the only one visible
            if (quizTab && !quizTab.classList.contains('active')) {
                quizTab.click();
            }
        } else { 
            // Default/Content Creation mode: Show all tabs
            if (pptTab) pptTab.style.display = ''; // Reset to default CSS style
            if (jsonTab) jsonTab.style.display = ''; // Reset to default CSS style
        }
    }
}


/**
 * Toggles a modal's visibility with smooth animations.
 * @param {string} modalKey The key of the modal in the `dom` object (e.g., 'aboutUsOverlay').
 * @param {boolean} [forceClose=false] If true, forces the modal to close.
 */
function toggleModal(modalKey, forceClose = false) {
    const modalElement = dom[modalKey];
    if (!modalElement) return;

    const isVisible = modalElement.classList.contains('visible');
    
    if (forceClose || isVisible) {
        modalElement.classList.remove('visible');
        // Let the animation finish before hiding it completely
        setTimeout(() => {
            modalElement.style.display = 'none';
        }, 300);
    } else {
        // Close any other open modals first
        modalOverlays.forEach(key => {
            if (key !== modalKey && dom[key] && dom[key].classList.contains('visible')) {
                toggleModal(key, true);
            }
        });

        modalElement.style.display = 'flex';
        // Allow the browser to render the element before adding the animation class
        setTimeout(() => {
            modalElement.classList.add('visible');
        }, 10);
    }
}


document.addEventListener('DOMContentLoaded', () => {

    const app = {
        // --- CORE INITIALIZATION ---
        init: function() {
            cacheDomElements();
            this.loadAndApplySettings();
            this.bindGlobalEventListeners();
            this.startBackgroundAnimations();
            
            // Centralized auth state listener
            auth.onAuthStateChange((user) => {
                if (user) {
                    this.showApp(user);
                } else {
                    this.showLoginGate();
                }
            });
        },

        showApp: async function(user) {
            showView('homepage-section');
            
            // Fetch user profile from Supabase and store it in the state
            const profile = await auth.fetchUserProfile(user.id);
            state.userProfile = profile;

            // Populate side menu with user info from the 'profiles' table for consistency
            if (profile) {
                dom.sideMenuProfileName.textContent = profile.full_name || 'Quiz User';
                dom.sideMenuProfilePic.src = profile.avatar_url || 'https://via.placeholder.com/60';
                dom.sideMenuSubscriptionStatus.textContent = profile.subscription_status || 'free';
            } else if (user) { // Fallback to auth metadata if profile is somehow missing
                dom.sideMenuProfileName.textContent = user.user_metadata?.full_name || 'Quiz User';
                dom.sideMenuProfilePic.src = user.user_metadata?.avatar_url || 'https://via.placeholder.com/60';
                dom.sideMenuSubscriptionStatus.textContent = 'free';
            }
            
            const wasResumed = await this.promptToResumeQuiz();
            if (wasResumed) return; // Resume logic handles the rest, skip normal init

            // Initialize modules with necessary callbacks to handle transitions
            const callbacks = {
                startQuiz: this.startQuiz.bind(this),
                endQuiz: this.endQuiz.bind(this),
                restartCurrentGroup: this.restartCurrentGroup.bind(this),
                restartFullQuiz: this.restartFullQuiz.bind(this),
                confirmGoBackToHome: this.confirmGoBackToHome.bind(this),
                updateDynamicHeaders: this.updateDynamicHeaders.bind(this),
                toggleQuizInternalNavigation: () => { /* Placeholder, will be populated by quiz module */ },
            };

            // This is a shared state object for callbacks, allowing modules to register their functions.
            state.callbacks = callbacks;

            initFilterModule(callbacks);
            initQuizModule(callbacks);
            initReviewModule(callbacks);
        },
        
        showLoginGate: function() {
            // FIX: Hide the loading overlay for unauthenticated users.
            if (dom.loadingOverlay.style.display !== 'none') {
                dom.loadingOverlay.classList.add('fade-out');
                dom.loadingOverlay.addEventListener('transitionend', () => {
                    dom.loadingOverlay.style.display = 'none';
                }, { once: true });
            }
            
            showView('login-gate');
            clearQuizState();
            state.userProfile = null; // Clear profile on logout

            // DPDP Compliance: Consent checkbox logic
            const updateSignInButtonState = () => {
                dom.signInBtn.disabled = !(dom.ageConsentCheckbox.checked && dom.privacyConsentCheckbox.checked);
            };
            dom.ageConsentCheckbox.onchange = updateSignInButtonState;
            dom.privacyConsentCheckbox.onchange = updateSignInButtonState;
            updateSignInButtonState(); // Set initial state
        },
        
        promptToResumeQuiz: async function() {
            loadQuizState();
            if (state.isQuizActive && state.questionGroups && state.questionGroups.length > 0) {
                const result = await Swal.fire({
                    title: 'Resume Session?',
                    text: "It looks like you have an unfinished quiz. Would you like to resume where you left off?",
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonColor: 'var(--primary-color)',
                    cancelButtonColor: 'var(--wrong-color)',
                    confirmButtonText: 'Yes, Resume!',
                    cancelButtonText: 'No, Start New'
                });

                if (result.isConfirmed) {
                    this.resumeQuiz();
                    return true;
                } else {
                    clearQuizState();
                    state.isQuizActive = false;
                    state.questionGroups = [];
                    // Load the filter data even if not resuming, so it's ready
                    initFilterModule({startQuiz: this.startQuiz.bind(this)});
                    return false;
                }
            }
            // If no active quiz, still init the filter module in the background
            initFilterModule({startQuiz: this.startQuiz.bind(this)});
            return false;
        },

        loadAndApplySettings: function() {
            loadSettings();
            applyInitialSettings();
        },

        startBackgroundAnimations: function() {
            if (!state.animationsDisabled) {
                if (initializeAllFireballs_anim()) {
                    state.isAnimating = true;
                    animateFireballs_anim();
                }
            }
        },

        // --- SCREEN TRANSITION HANDLERS ---
        startQuiz: function() {
            state.isQuizActive = true;
            showView('quiz-main-container');
            loadQuiz();
            this.updateDynamicHeaders();
        },
        
        resumeQuiz: function() {
            state.isQuizActive = true;
            showView('quiz-main-container');

            // Initialize modules with callbacks for the resumed session
            const callbacks = {
                startQuiz: this.startQuiz.bind(this),
                endQuiz: this.endQuiz.bind(this),
                restartCurrentGroup: this.restartCurrentGroup.bind(this),
                restartFullQuiz: this.restartFullQuiz.bind(this),
                confirmGoBackToHome: this.confirmGoBackToHome.bind(this),
                updateDynamicHeaders: this.updateDynamicHeaders.bind(this),
                toggleQuizInternalNavigation: () => {}, // Placeholder
            };
            state.callbacks = callbacks;
            initQuizModule(callbacks);
            initReviewModule(callbacks);
            
            resumeLoadedQuiz();
            this.updateDynamicHeaders();
        },

        endQuiz: function() {
            state.isQuizActive = false;
            dom.quizSection.style.display = 'none';
            dom.reviewSection.style.display = 'none';
            dom.finalScoreSection.style.display = 'block';
            dom.finalScoreSection.classList.add('section-fade-in');
            showFinalScoreScreen();
        },

        restartCurrentGroup: function() {
            // This is handled inside the quiz module, which will re-initialize a group
        },

        restartFullQuiz: function() {
            if (dom.navigationPanel.classList.contains('open')) {
                dom.navigationPanel.classList.remove('open');
                dom.navOverlay.classList.remove('active');
                dom.navMenuIcon.classList.remove('is-active');
            }
        
            document.body.style.overflow = 'auto';
            clearQuizState();
            state.isQuizActive = false;
        
            showView('homepage-section'); // Return to homepage
        
            state.questionGroups = [];
            state.currentGroupIndex = 0;
            state.currentQuizData = null;
        },

        confirmGoBackToHome: function() {
            Swal.fire({
                target: dom.quizMainContainer.style.display === 'block' ? dom.quizMainContainer : dom.filterSection,
                position: 'top',
                title: 'Return to Homepage?',
                text: "Your current progress will be lost if you are in a quiz. This action will start a new session.",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: 'var(--primary-color)',
                cancelButtonColor: 'var(--wrong-color)',
                confirmButtonText: 'Yes, Go Home!'
            }).then((result) => {
                if (result.isConfirmed) {
                    app.restartFullQuiz();
                }
            });
        },
        
        updateDynamicHeaders: function() {
            const groupName = state.currentQuizData?.groupName || "Quiz";

            // Get all active filters from the state
            const activeFilters = [];
            for (const key in state.selectedFilters) {
                if (state.selectedFilters[key] && state.selectedFilters[key].length > 0) {
                    activeFilters.push(...state.selectedFilters[key]);
                }
            }
            
            let filterText = '';
            if (activeFilters.length > 0) {
                // Create the non-clickable, comma-separated list in brackets
                filterText = ` &gt; <span class="breadcrumb-filters">[${activeFilters.join(', ')}]</span>`;
            }

            if (dom.dynamicBreadcrumb) {
                const breadcrumbHtml = `<a href="#" id="breadcrumb-home-link">Home</a> &gt; <a href="#" id="breadcrumb-filters-link">Filters</a> &gt; <span class="current-topic">${groupName}</span>${filterText}`;
                dom.dynamicBreadcrumb.innerHTML = breadcrumbHtml;
            }
            
            if (dom.quizTitle) dom.quizTitle.textContent = groupName;
            if (dom.scoreTitle) dom.scoreTitle.textContent = `Quiz Result - ${groupName}`;
            if (dom.reviewTitle) dom.reviewTitle.textContent = `Review Answer - ${groupName}`;
        },

        // --- SIDE MENU (REFACTORED FOR BUG FIX) ---
        toggleSideMenu: function() {
            const isVisible = dom.sideMenuOverlay.classList.contains('visible');
            if (isVisible) {
                this.closeSideMenu();
            } else {
                this.openSideMenu();
            }
        },

        openSideMenu: function() {
            dom.sideMenuOverlay.classList.add('visible');
            dom.hamburgerMenuBtn.classList.add('is-active');
        },

        closeSideMenu: function() {
            dom.sideMenuOverlay.classList.remove('visible');
            dom.hamburgerMenuBtn.classList.remove('is-active');
        },


        // --- GLOBAL EVENT BINDING ---
        bindGlobalEventListeners: function() {
            // Auth Buttons
            dom.signInBtn.onclick = () => auth.signInWithGoogle();
            dom.logoutBtn.onclick = () => auth.signOut();
            dom.deleteAccountBtn.onclick = () => auth.deleteAccount();
            
            // Bug Fix 1: Centralize quiz nav menu listener
            dom.navMenuIcon.onclick = () => {
                if (state.callbacks.toggleQuizInternalNavigation) {
                    state.callbacks.toggleQuizInternalNavigation();
                }
            };

            // Homepage Navigation
            const goToFilters = () => showView('filter-section', { mode: 'quiz' });
            dom.heroStartQuizBtn.onclick = goToFilters;
            dom.homeCustomQuizCard.onclick = goToFilters;
            
            // New Modal Triggers from Homepage
            dom.homeContentCreationCard.onclick = () => toggleModal('contentCreationOverlay');
            dom.homeUserGuideCard.onclick = () => toggleModal('userGuideOverlay');
            
            dom.backToHomeLink.onclick = (e) => {
                e.preventDefault();
                showView('homepage-section');
            };

            // Side Menu (Using Refactored Functions)
            dom.hamburgerMenuBtn.onclick = () => this.toggleSideMenu();
            dom.sideMenuCloseBtn.onclick = () => this.closeSideMenu();
            dom.sideMenuOverlay.onclick = (e) => {
                if (e.target === dom.sideMenuOverlay) this.closeSideMenu();
            };

            // Side Menu Links
            const setupSideMenuLink = (link, action) => {
                if (link) {
                    link.onclick = (e) => {
                        e.preventDefault();
                        this.closeSideMenu();
                        action();
                    };
                }
            };

            setupSideMenuLink(dom.sideMenuQuizlmLink, () => showView('filter-section', { mode: 'quiz' }));
            setupSideMenuLink(dom.sideMenuPaidCourseLink, () => toggleModal('contentCreationOverlay'));
            setupSideMenuLink(dom.sideMenuUserGuideLink, () => toggleModal('userGuideOverlay'));
            setupSideMenuLink(dom.sideMenuAboutUsLink, () => toggleModal('aboutUsOverlay'));
            setupSideMenuLink(dom.sideMenuSettingsLink, async () => {
                const user = await auth.getCurrentUser();
                if (user && user.email) {
                    dom.userEmailDisplay.textContent = user.email;
                } else {
                    dom.userEmailDisplay.textContent = 'Not available';
                }
                toggleProfileSettings(false);
            });
            setupSideMenuLink(dom.sideMenuPrivacyLink, () => toggleModal('privacyPolicyOverlay'));

            // Content Creation Modal Actions
            const setupContentCreationAction = (button, tabId) => {
                if (button) {
                    button.onclick = () => {
                        toggleModal('contentCreationOverlay', true);
                        showView('filter-section'); // This will show all tabs by default now
                        document.querySelector(`.tab-btn[data-tab="${tabId}"]`).click();
                    };
                }
            };
            setupContentCreationAction(dom.modalCreatePptBtn, 'ppt-panel');
            setupContentCreationAction(dom.modalCreatePdfBtn, 'ppt-panel');
            setupContentCreationAction(dom.modalDownloadJsonBtn, 'json-panel');


            // --- Generic Modal Close Logic ---
            modalOverlays.forEach(modalKey => {
                const overlay = dom[modalKey];
                const closeBtnKey = `${modalKey.replace('Overlay', '')}CloseBtn`;
                const closeBtn = dom[closeBtnKey];

                if (overlay) {
                    overlay.onclick = (e) => {
                        if (e.target === overlay) {
                            if (modalKey === 'sideMenuOverlay') this.closeSideMenu();
                            else if (modalKey === 'quizSettingsOverlay') toggleQuizSettings(true);
                            else if (modalKey === 'profileSettingsOverlay') toggleProfileSettings(true);
                            else toggleModal(modalKey, true);
                        }
                    };
                }
                if (closeBtn) {
                     closeBtn.onclick = () => {
                         if (modalKey === 'quizSettingsOverlay') toggleQuizSettings(true);
                         else if (modalKey === 'profileSettingsOverlay') toggleProfileSettings(true);
                         else toggleModal(modalKey, true);
                     };
                }
            });
            // Specific logic for legacy privacy modal
            dom.privacyPolicyLink.onclick = (e) => { e.preventDefault(); toggleModal('privacyPolicyOverlay'); };


            // Settings Panels
            dom.quizSettingsBtn.onclick = () => toggleQuizSettings(false);
            dom.darkModeToggle.onchange = () => toggleDarkMode();
            dom.soundToggle.onchange = () => toggleMute();
            dom.shuffleToggle.onchange = () => toggleShuffle();
            dom.animationsToggle.onchange = () => toggleAnimations();
            dom.hapticToggle.onchange = () => toggleHapticFeedback();
            
            // Other global controls
            dom.fullscreenBtn.onclick = () => toggleFullScreen();
            dom.aiExplanationCloseBtn.addEventListener('click', () => hideAIExplanation());
            dom.aiExplanationOverlay.addEventListener('click', (event) => {
                if (event.target === dom.aiExplanationOverlay) {
                    hideAIExplanation();
                }
            });

            // Zoom
            document.getElementById('zoom-in-btn').onclick = () => zoomIn();
            document.getElementById('zoom-out-btn').onclick = () => zoomOut();
            document.getElementById('zoom-in-btn-review').onclick = () => zoomIn();
            document.getElementById('zoom-out-btn-review').onclick = () => zoomOut();
            
            // Before Unload
            window.addEventListener('beforeunload', (event) => {
                if (state.isQuizActive) {
                    event.preventDefault();
                    event.returnValue = '';
                }
            });

            this.addKeyboardListeners();
            this.addSwipeListeners();
        },

        // --- INPUT HANDLERS (KEYBOARD & SWIPE) ---
        handleKeyPress: function(event) {
            const isAnyModalOpen = modalOverlays.some(key => dom[key] && dom[key].classList.contains('visible'));

            if (event.key === 'Escape') {
                if (dom.aiExplanationOverlay && dom.aiExplanationOverlay.classList.contains('visible')) { hideAIExplanation(); return; }
                if (dom.navigationPanel && dom.navigationPanel.classList.contains('open')) { state.callbacks.toggleQuizInternalNavigation(); return; }
                if (isAnyModalOpen) {
                    modalOverlays.forEach(key => {
                        if (dom[key] && dom[key].classList.contains('visible')) {
                             if (key === 'sideMenuOverlay') this.closeSideMenu();
                             else if (key === 'quizSettingsOverlay') toggleQuizSettings(true);
                             else if (key === 'profileSettingsOverlay') toggleProfileSettings(true);
                             else toggleModal(key, true);
                        }
                    });
                    return;
                }
            }

            if (isAnyModalOpen) return; // Prevent quiz actions if a modal is open

            const isQuizActive = dom.quizSection.style.display === 'block';
            const isReviewActive = dom.reviewSection.style.display === 'block';
            const isFinalScoreActive = dom.finalScoreSection.style.display === 'block';

            if (isQuizActive) {
                state.callbacks.quizKeyPressHandler(event);
            } else if (isReviewActive) {
                state.callbacks.reviewKeyPressHandler(event);
            } else if (isFinalScoreActive) {
                state.callbacks.scoreKeyPressHandler(event);
            }
        },

        addKeyboardListeners: function() {
            document.removeEventListener('keydown', this.handleKeyPress);
            document.addEventListener('keydown', this.handleKeyPress.bind(this));
        },

        handleTouchStart: function(event) {
            if (event.target.closest('button, a, #explanation, #review-explanation')) {
                state.touchStartX = 0;
                return;
            }
            state.touchStartX = event.touches[0].clientX;
            state.touchStartY = event.touches[0].clientY;
        },

        handleMouseDown: function(event) {
            if (event.target.closest('button, a, #explanation, #review-explanation')) {
                return;
            }
            state.isMouseDown = true;
            state.touchStartX = event.clientX;
            state.touchStartY = event.clientY;
        },
        
        handleTouchEnd: function(event) {
            if (state.touchStartX === 0) return;
            const touchEndX = event.changedTouches[0].clientX;
            const touchEndY = event.changedTouches[0].clientY;
            this.processSwipe(touchEndX, touchEndY);
        },

        handleMouseUp: function(event) {
            if (!state.isMouseDown) return;
            state.isMouseDown = false;
            const touchEndX = event.clientX;
            const touchEndY = event.clientY;
            this.processSwipe(touchEndX, touchEndY);
        },

        handleMouseLeave: function() {
            if (state.isMouseDown) {
                state.isMouseDown = false;
                state.touchStartX = 0;
                state.touchStartY = 0;
            }
        },
        
        processSwipe: function(touchEndX, touchEndY) {
            if (state.touchStartX === 0) return;
            
            const isAnyModalOpen = modalOverlays.some(key => dom[key] && dom[key].classList.contains('visible'));
            if (isAnyModalOpen || dom.navigationPanel.classList.contains('open')) {
                state.touchStartX = 0;
                state.touchStartY = 0;
                return;
            }

            const deltaX = touchEndX - state.touchStartX;
            const deltaY = touchEndY - state.touchStartY;
            const swipeThreshold = 50;

            if (Math.abs(deltaX) > swipeThreshold && Math.abs(deltaX) > Math.abs(deltaY)) {
                const isQuizActive = dom.quizSection.style.display === 'block';
                const isReviewActive = dom.reviewSection.style.display === 'block';
        
                if (deltaX > 0) { // Swipe Right (Previous)
                    if (isQuizActive && state.callbacks.previousQuestionHandler) state.callbacks.previousQuestionHandler();
                    else if (isReviewActive && state.callbacks.navigateReview) state.callbacks.navigateReview(-1);
                } else { // Swipe Left (Next/Skip)
                    if (isQuizActive && state.callbacks.nextQuestionHandler) state.callbacks.nextQuestionHandler();
                    else if (isReviewActive && state.callbacks.navigateReview) state.callbacks.navigateReview(1);
                }
            }
        
            state.touchStartX = 0;
            state.touchStartY = 0;
        },

        addSwipeListeners: function() {
            const swipeAreas = [dom.quizSection, dom.reviewSection];
            swipeAreas.forEach(area => {
                if(area) {
                    area.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: true });
                    area.addEventListener('touchend', this.handleTouchEnd.bind(this));
                    area.addEventListener('mousedown', this.handleMouseDown.bind(this));
                    area.addEventListener('mouseup', this.handleMouseUp.bind(this));
                    area.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
                }
            });
        }
    };

    app.init();
});