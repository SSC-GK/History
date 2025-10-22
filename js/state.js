// Simple Event Emitter (Pub/Sub)
class EventEmitter {
    constructor() {
        this.events = {};
    }

    subscribe(eventName, fn) {
        if (!this.events[eventName]) {
            this.events[eventName] = [];
        }
        this.events[eventName].push(fn);
        
        // Return an unsubscribe function
        return () => {
            this.events[eventName] = this.events[eventName].filter(eventFn => fn !== eventFn);
        };
    }

    publish(eventName, data) {
        const event = this.events[eventName];
        if (event) {
            event.forEach(fn => {
                fn.call(null, data);
            });
        }
    }
}

const events = new EventEmitter();
export const subscribe = events.subscribe.bind(events);


// --- CONFIG & STATE ---
export const config = {
    questionsPerGroup: 50,
    timePerQuestion: 60,
    zoomStep: 0.1,
    minZoom: 0.7,
    maxZoom: 1.5,
    zoomableSelectors: [
        '.container h1', '.container h2', '.container #review-question-number', '.container #review-time-taken',
        '.container .options button', '.container #explanation', '.container #review-explanation', '.container .summary-item span',
        '.container .question-numbering-area span', '.container #status-tracker', '.container #review-status-tracker',
        'button#next-btn', 'button#restart-btn', 'button#review-btn', 'button#prev-review-btn', 'button#next-review-btn', 'button#back-to-summary-btn'
    ],
    filterKeys: ['subject', 'topic', 'subTopic', 'difficulty', 'questionType', 'examName', 'examYear', 'tags']
};

// Internal state object that should not be mutated directly from outside
const internalState = {
    allQuestionsMasterList: [],
    filteredQuestionsMasterList: [],
    questionGroups: [],
    currentGroupIndex: 0,
    currentQuizData: null,
    timer: null,
    timeLeftForQuestion: 60,
    currentLifelineUsed: false,
    isMuted: false,
    isShuffleActive: false,
    isDarkMode: false,
    animationsDisabled: false,
    isHapticEnabled: true,
    bookmarkedQuestions: [],
    isAnimating: false,
    isTransitioningQuestion: false,
    isHeaderCollapsed: false,
    currentZoomMultiplier: 1.0,
    originalFontSizes: new Map(),
    fireballs_anim_array: [],
    fireballBaseSpeed_anim: 1.5,
    currentReviewIndex: 0,
    currentReviewFilter: 'all',
    filteredAttempts: [],
    ai: null,
    touchStartX: 0,
    touchStartY: 0,
    isMouseDown: false,
    isQuizActive: false,
    selectedFilters: {
        subject: [], topic: [], subTopic: [], 
        difficulty: [], questionType: [], 
        examName: [], examYear: [], 
        tags: []
    },
    callbacks: {}, // To store callbacks for inter-module communication
};

// Proxy handler to intercept state changes and publish events
const stateHandler = {
    set: function(obj, prop, value) {
        const oldValue = obj[prop];
        
        // Prevent unnecessary event publishing if value is the same
        if (oldValue === value) {
            return true;
        }

        // For arrays, a deep comparison might be needed if you want to avoid firing on identical content
        if (Array.isArray(oldValue) && Array.isArray(value) && JSON.stringify(oldValue) === JSON.stringify(value)) {
            return true;
        }

        // Update the actual internal state object
        obj[prop] = value;
        
        // Announce the change to any subscribers
        events.publish(prop, { newValue: value, oldValue: oldValue });
        
        return true; // Indicate success
    }
};

// Export the proxied state object. All mutations will now be intercepted.
export const state = new Proxy(internalState, stateHandler);

// --- LOCAL STORAGE FUNCTIONS ---

export function saveSettings() {
    try {
        const settingsToSave = {
            isShuffleActive: state.isShuffleActive,
            isMuted: state.isMuted,
            isDarkMode: state.isDarkMode,
            animationsDisabled: state.animationsDisabled,
            isHapticEnabled: state.isHapticEnabled,
            bookmarkedQuestions: state.bookmarkedQuestions,
            isHeaderCollapsed: state.isHeaderCollapsed,
        };
        localStorage.setItem('quizAppSettings', JSON.stringify(settingsToSave));
    } catch (e) {
        console.error("Could not save settings to localStorage", e);
    }
}

export function loadSettings() {
    try {
        const savedSettingsJSON = localStorage.getItem('quizAppSettings');
        if (savedSettingsJSON) {
            const savedSettings = JSON.parse(savedSettingsJSON);
            
            // These assignments will trigger the proxy's 'set' handler,
            // which in turn publishes events to update the UI.
            state.isShuffleActive = savedSettings.isShuffleActive || false;
            state.isMuted = savedSettings.isMuted || false;
            state.isDarkMode = savedSettings.isDarkMode || false;
            state.animationsDisabled = savedSettings.animationsDisabled || false;
            state.isHapticEnabled = savedSettings.isHapticEnabled !== false; // Default to true
            state.bookmarkedQuestions = savedSettings.bookmarkedQuestions || [];
            state.isHeaderCollapsed = savedSettings.isHeaderCollapsed || false;
        }
    } catch (e) {
        console.error("Could not load settings from localStorage", e);
        localStorage.removeItem('quizAppSettings');
    }
}

export function saveQuizState() {
    if (!state.isQuizActive) return;
    try {
        const sessionState = {
            isQuizActive: state.isQuizActive,
            questionGroups: state.questionGroups,
            currentGroupIndex: state.currentGroupIndex,
            selectedFilters: state.selectedFilters, // Save filters to reconstruct headers
        };
        localStorage.setItem('quizActiveSession', JSON.stringify(sessionState));
    } catch (e) {
        console.error("Could not save quiz session to localStorage", e);
    }
}

export function loadQuizState() {
    try {
        const savedSessionJSON = localStorage.getItem('quizActiveSession');
        if (savedSessionJSON) {
            const savedSession = JSON.parse(savedSessionJSON);
            // These assignments also trigger the proxy
            state.isQuizActive = savedSession.isQuizActive || false;
            state.questionGroups = savedSession.questionGroups || [];
            state.currentGroupIndex = savedSession.currentGroupIndex || 0;
            state.selectedFilters = savedSession.selectedFilters || state.selectedFilters;
            if(state.questionGroups.length > 0) {
                 state.currentQuizData = state.questionGroups[state.currentGroupIndex];
            }
        }
    } catch (e) {
        console.error("Could not load quiz session from localStorage", e);
        clearQuizState();
    }
}

export function clearQuizState() {
    localStorage.removeItem('quizActiveSession');
}