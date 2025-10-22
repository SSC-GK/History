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
    toggleSettings, 
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
            this.populateUserProfile(user);
            dom.loginGate.style.display = 'none';
            dom.appHeader.style.display = 'flex';
            dom.appContent.style.display = 'block';
            dom.appFooter.style.display = 'block';

            const wasResumed = await this.promptToResumeQuiz();
            if (wasResumed) return;

            // Default to showing the homepage
            this.showHomepage();
            
            // Initialize modules with necessary callbacks to handle transitions
            const callbacks = {
                startQuiz: this.startQuiz.bind(this),
                endQuiz: this.endQuiz.bind(this),
                restartCurrentGroup: this.restartCurrentGroup.bind(this),
                restartFullQuiz: this.restartFullQuiz.bind(this),
                confirmGoBackToFilters: this.confirmGoBackToFilters.bind(this),
                updateDynamicHeaders: this.updateDynamicHeaders.bind(this),
                goBackToHomepage: this.showHomepage.bind(this)
            };

            initFilterModule(callbacks);
            initQuizModule(callbacks);
            initReviewModule(callbacks);
        },
        
        showLoginGate: function() {
            if (dom.loadingOverlay.style.display !== 'none') {
                dom.loadingOverlay.classList.add('fade-out');
                dom.loadingOverlay.addEventListener('transitionend', () => {
                    dom.loadingOverlay.style.display = 'none';
                }, { once: true });
            }

            dom.loginGate.style.display = 'flex';
            dom.appHeader.style.display = 'none';
            dom.appContent.style.display = 'none';
            dom.appFooter.style.display = 'none';

            // Hide all app sections
            this.hideAllSections();
            clearQuizState();

            const updateSignInButtonState = () => {
                dom.signInBtn.disabled = !(dom.ageConsentCheckbox.checked && dom.privacyConsentCheckbox.checked);
            };
            dom.ageConsentCheckbox.onchange = updateSignInButtonState;
            dom.privacyConsentCheckbox.onchange = updateSignInButtonState;
            updateSignInButtonState(); // Set initial state
        },

        hideAllSections: function() {
            const sections = [
                dom.homepage, dom.filterSection, dom.quizMainContainer, 
                dom.quizBreadcrumbContainer, dom.finalScoreSection, dom.reviewSection
            ];
            sections.forEach(sec => {
                if (sec) sec.style.display = 'none';
            });
        },

        showHomepage: function() {
            this.hideAllSections();
            dom.homepage.style.display = 'block';
            
            // If the filter module hasn't loaded its questions yet, this is the time.
            if (state.allQuestionsMasterList.length === 0) {
                 if (dom.loadingOverlay.style.display !== 'none') {
                    // It's already showing, just wait.
                }
            } else {
                 if (dom.loadingOverlay.style.display !== 'none') {
                    dom.loadingOverlay.classList.add('fade-out');
                    dom.loadingOverlay.addEventListener('transitionend', () => {
                        dom.loadingOverlay.style.display = 'none';
                    }, { once: true });
                }
            }
        },

        showFilterPage: function(defaultTabId = 'quiz-panel') {
            this.hideAllSections();
            dom.filterSection.style.display = 'block';

            // Programmatically click the correct tab
            const targetTabBtn = document.querySelector(`.tab-btn[data-tab="${defaultTabId}"]`);
            if (targetTabBtn) {
                targetTabBtn.click();
            }
        },
        
        populateUserProfile: function(user) {
            if (user?.user_metadata) {
                dom.sideNavProfileName.textContent = user.user_metadata.full_name || user.email;
                dom.sideNavProfileImg.src = user.user_metadata.avatar_url || 'https://sb.kaleidousercontent.com/67418/1672x1018/6463a5af0d/individuals-orgs-placeholder-avatar.png';
            }
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
                    return false;
                }
            }
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
            this.hideAllSections();
            dom.quizMainContainer.style.display = 'block';
            dom.quizBreadcrumbContainer.style.display = 'block';
            loadQuiz();
            this.updateDynamicHeaders();
        },
        
        resumeQuiz: function() {
            state.isQuizActive = true;
            this.hideAllSections();
            dom.quizMainContainer.style.display = 'block';
            dom.quizBreadcrumbContainer.style.display = 'block';

            const callbacks = {
                startQuiz: this.startQuiz.bind(this),
                endQuiz: this.endQuiz.bind(this),
                restartCurrentGroup: this.restartCurrentGroup.bind(this),
                restartFullQuiz: this.restartFullQuiz.bind(this),
                confirmGoBackToFilters: this.confirmGoBackToFilters.bind(this),
                updateDynamicHeaders: this.updateDynamicHeaders.bind(this),
                goBackToHomepage: this.showHomepage.bind(this)
            };
            initQuizModule(callbacks);
            initReviewModule(callbacks);
            this.bindGlobalEventListeners();
            
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

            this.showHomepage(); // Go back to homepage instead of filters
        
            state.questionGroups = [];
            state.currentGroupIndex = 0;
            state.currentQuizData = null;
        },

        confirmGoBackToFilters: function() {
            Swal.fire({
                target: dom.quizMainContainer,
                position: 'top',
                title: 'Exit Quiz?',
                text: "Your current quiz progress will be lost. You will return to the homepage.",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: 'var(--primary-color)',
                cancelButtonColor: 'var(--wrong-color)',
                confirmButtonText: 'Yes, Exit!'
            }).then((result) => {
                if (result.isConfirmed) {
                    app.restartFullQuiz();
                }
            });
        },
        
        updateDynamicHeaders: function() {
            const groupName = state.currentQuizData?.groupName || "Quiz";

            if (dom.dynamicBreadcrumb) {
                const breadcrumbHtml = `<a href="#" id="breadcrumb-home-link">Home</a> &gt; <a href="#" id="breadcrumb-filters-link">Filters</a> &gt; <span class="current-topic">${groupName}</span>`;
                dom.dynamicBreadcrumb.innerHTML = breadcrumbHtml;
            }
            
            if (dom.quizTitle) dom.quizTitle.textContent = groupName;
            if (dom.scoreTitle) dom.scoreTitle.textContent = `Quiz Result - ${groupName}`;
            if (dom.reviewTitle) dom.reviewTitle.textContent = `Review Answer - ${groupName}`;
        },

        toggleSideNav: function() {
            const isOpen = dom.sideNavPanel.classList.toggle('open');
            dom.sideNavOverlay.classList.toggle('active', isOpen);
            dom.hamburgerMenuBtn.classList.toggle('is-active', isOpen);
        },

        // --- GLOBAL EVENT BINDING ---
        bindGlobalEventListeners: function() {
            // Auth Buttons
            dom.signInBtn.onclick = () => auth.signInWithGoogle();
            dom.logoutBtn.onclick = () => auth.signOut();
            dom.deleteAccountBtn.onclick = () => auth.deleteAccount();

            // Modals
            this.bindModalEvents('privacy-policy', dom.privacyPolicyLink, dom.navLinkPrivacyPolicy);
            this.bindModalEvents('about-us', dom.navLinkAboutUs);
            this.bindModalEvents('user-guide', dom.navLinkUserGuide);

            // Side Navigation
            dom.hamburgerMenuBtn.onclick = () => this.toggleSideNav();
            dom.sideNavOverlay.onclick = () => this.toggleSideNav();
            
            // Homepage card clicks
            dom.homeCardQuizLM.onclick = () => this.showFilterPage('quiz-panel');
            dom.homeCardPaidCourse.onclick = () => this.showFilterPage('ppt-panel');

            // Side Nav link clicks
            dom.navLinkHome.onclick = (e) => { e.preventDefault(); this.showHomepage(); this.toggleSideNav(); };
            dom.navLinkQuizLM.onclick = (e) => { e.preventDefault(); this.showFilterPage('quiz-panel'); this.toggleSideNav(); };
            dom.navLinkPaidCourse.onclick = (e) => { e.preventDefault(); this.showFilterPage('ppt-panel'); this.toggleSideNav(); };
            dom.navLinkSettings.onclick = async (e) => {
                e.preventDefault();
                this.toggleSideNav();
                const user = await auth.getCurrentUser();
                if (user && user.email) {
                    dom.userEmailDisplay.textContent = user.email;
                } else {
                    dom.userEmailDisplay.textContent = 'Not available';
                }
                toggleSettings(false);
            };

            // Settings Panel
            dom.settingsBtn.onclick = async () => {
                const user = await auth.getCurrentUser();
                if (user && user.email) {
                    dom.userEmailDisplay.textContent = user.email;
                } else {
                    dom.userEmailDisplay.textContent = 'Not available';
                }
                toggleSettings(false);
            };
            dom.settingsOverlay.onclick = (e) => {
                if (e.target === dom.settingsOverlay) toggleSettings(true);
            };
            dom.settingsCloseBtn.onclick = () => toggleSettings(true);
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
        
        bindModalEvents: function(modalName, ...triggerElements) {
            const overlay = document.getElementById(`${modalName}-overlay`);
            const closeBtn = document.getElementById(`${modalName}-close-btn`);
            if (!overlay || !closeBtn) return;

            const openModal = (e) => {
                e.preventDefault();
                overlay.style.display = 'flex';
            };
            const closeModal = () => {
                overlay.style.display = 'none';
            };

            triggerElements.forEach(el => {
                if (el) el.onclick = openModal;
            });
            closeBtn.onclick = closeModal;
            overlay.onclick = (e) => {
                if (e.target === overlay) closeModal();
            };
        },

        // --- INPUT HANDLERS (KEYBOARD & SWIPE) ---
        handleKeyPress: function(event) {
            if (dom.aiExplanationOverlay && dom.aiExplanationOverlay.classList.contains('visible')) {
                if (event.key === 'Escape') hideAIExplanation();
                return;
            }
            if (dom.navigationPanel && dom.navigationPanel.classList.contains('open')) {
                if (event.key === 'Escape') state.callbacks.toggleQuizInternalNavigation();
                return;
            }
            if (dom.settingsOverlay && dom.settingsOverlay.classList.contains('visible')) {
                if (event.key === 'Escape') toggleSettings(true);
                return;
            }

            const isQuizActive = dom.quizSection.style.display === 'block';
            const isReviewActive = dom.reviewSection.style.display === 'block';
            const isFinalScoreActive = dom.finalScoreSection.style.display === 'block';

            if (isQuizActive) {
                // Call quiz key handlers
                state.callbacks.quizKeyPressHandler(event);
            } else if (isReviewActive) {
                // Call review key handlers
                state.callbacks.reviewKeyPressHandler(event);
            } else if (isFinalScoreActive) {
                // Call score screen key handlers
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

            if (dom.settingsOverlay.classList.contains('visible') || 
                dom.aiExplanationOverlay.classList.contains('visible') ||
                dom.navigationPanel.classList.contains('open')) {
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