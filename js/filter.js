import { config, state } from './state.js';
import { dom } from './dom.js';
import { debounce, shuffleArray } from './utils.js';
import { supabase } from './supabaseClient.js';

let appCallbacks = {};
let docWorker = null;

/**
 * Triggers a "pop" animation on a given element to provide visual feedback.
 * @param {HTMLElement} element The element to animate.
 */
function triggerCountAnimation(element) {
    if (!element) return;
    
    // Remove the class first to re-trigger the animation if it was just added
    element.classList.remove('count-updated');
    // We need a short delay to allow the browser to process the removal before re-adding
    requestAnimationFrame(() => {
        element.classList.add('count-updated');
    });
}

export function initFilterModule(callbacks) {
    appCallbacks = callbacks;
    initializeTabs();
    bindFilterEventListeners();
    loadQuestionsForFiltering();
    state.callbacks.confirmGoBackToFilters = callbacks.confirmGoBackToFilters;
}

function initializeTabs() {
    dom.tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetPanelId = button.dataset.tab;
            
            dom.tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            dom.tabPanels.forEach(panel => {
                if (panel.id === targetPanelId) {
                    panel.classList.add('active');
                } else {
                    panel.classList.remove('active');
                }
            });

            dom.tabTaglines.forEach(tagline => {
                if (tagline.dataset.tab === targetPanelId) {
                    tagline.classList.add('active');
                } else {
                    tagline.classList.remove('active');
                }
            });
        });
    });
}

const debouncedFetch = debounce(fetchAndApplyFilters, 500);

function bindFilterEventListeners() {
    dom.startQuizBtn.onclick = () => startFilteredQuiz();
    dom.createPptBtn.onclick = () => generateDocument('ppt');
    dom.createPdfBtn.onclick = () => generateDocument('pdf');
    dom.downloadJsonBtn.onclick = () => downloadJSON();
    dom.resetFiltersBtnQuiz.onclick = () => resetFilters();
    dom.resetFiltersBtnPpt.onclick = () => resetFilters();
    dom.resetFiltersBtnJson.onclick = () => resetFilters();
    dom.quickStartButtons.forEach(btn => {
        btn.onclick = () => handleQuickStart(btn.dataset.preset);
    });

    config.filterKeys.forEach(key => {
        const elements = dom.filterElements[key];
        if (elements.toggleBtn) {
            elements.toggleBtn.onclick = () => toggleMultiSelectDropdown(key);
        }
        if (elements.searchInput) {
            elements.searchInput.oninput = () => filterMultiSelectList(key);
        }
    });

    document.addEventListener('click', (e) => {
        config.filterKeys.forEach(key => {
            if (!dom.filterElements[key] || !dom.filterElements[key].container) return;
            const container = dom.filterElements[key].container;
            if (container && !container.contains(e.target)) {
                toggleMultiSelectDropdown(key, true); // Force close
            }
        });
    });

     if (dom.dynamicBreadcrumb) {
        dom.dynamicBreadcrumb.addEventListener('click', (e) => {
            e.preventDefault();
            if (e.target && e.target.id === 'breadcrumb-home-link') {
                appCallbacks.confirmGoBackToFilters(); // This now goes back to homepage
            } else if (e.target && e.target.id === 'breadcrumb-filters-link') {
                appCallbacks.confirmGoBackToFilters(); // This can also go back to homepage and then user can re-enter filters
            }
        });
    }
}

async function loadQuestionsForFiltering() {
    try {
        if (state.allQuestionsMasterList.length > 0) {
            // Data already loaded, just populate controls
            populateFilterControls();
            onFilterStateChange(true);
            return;
        }

        dom.loadingText.textContent = 'Connecting to database...';

        // OPTIMIZATION: Only select columns needed for filtering to speed up initial load.
        const { data, error } = await supabase
            .from('questions')
            .select('id, subject, topic, subTopic, difficulty, questionType, examName, examYear, tags');

        if (error) {
            throw new Error(`Supabase error: ${error.message}`);
        }

        if (!data || data.length === 0) {
            throw new Error('No questions were found in the database.');
        }

        // This master list only contains filterable data, not full question text.
        state.allQuestionsMasterList = data;

        if (dom.loadingOverlay) {
            dom.loadingOverlay.classList.add('fade-out');
            dom.loadingOverlay.addEventListener('transitionend', () => {
                dom.loadingOverlay.style.display = 'none';
            }, { once: true });
        }
        
        populateFilterControls();
        onFilterStateChange(true); // Initial fetch, skip debounce
    } catch (error) {
        console.error(`Could not load quiz questions:`, error);
        if (dom.loadingOverlay) {
            dom.loadingOverlay.innerHTML = `<div class="loader-content"><h1>Error Loading Quiz</h1><p>Could not fetch questions from the database. Please check your connection and refresh the page.</p><p style="font-size:0.8em; color: var(--text-color-light)">${error.message}</p></div>`;
        }
    }
}

function populateFilterControls() {
    const questions = state.allQuestionsMasterList;
    const unique = {
        subject: new Set(),
        difficulty: new Set(), questionType: new Set(),
        examName: new Set(), examYear: new Set(), tags: new Set()
    };

    questions.forEach(q => {
        if (q.subject) unique.subject.add(q.subject);
        if (q.difficulty) unique.difficulty.add(q.difficulty);
        if (q.questionType) unique.questionType.add(q.questionType);
        if (q.examName) unique.examName.add(q.examName);
        if (q.examYear) unique.examYear.add(q.examYear);
        if (q.tags && Array.isArray(q.tags)) q.tags.forEach(tag => unique.tags.add(tag));
    });

    populateMultiSelect('subject', [...unique.subject].sort());

    const topicBtn = dom.filterElements.topic.toggleBtn;
    topicBtn.disabled = true;
    topicBtn.textContent = "Select a Subject first";
    const subTopicBtn = dom.filterElements.subTopic.toggleBtn;
    subTopicBtn.disabled = true;
    subTopicBtn.textContent = "Select a Topic first";

    populateSegmentedControl('difficulty', [...unique.difficulty].sort());
    populateSegmentedControl('questionType', [...unique.questionType].sort());
    populateMultiSelect('examName', [...unique.examName].sort());
    populateMultiSelect('examYear', [...unique.examYear].sort((a,b) => b-a));
    populateMultiSelect('tags', [...unique.tags].sort());
}

function populateMultiSelect(filterKey, options) {
    const listElement = dom.filterElements[filterKey]?.list;
    if (!listElement) return;

    const selectedValues = state.selectedFilters[filterKey] || [];
    listElement.innerHTML = '';
    options.forEach(opt => {
        const label = document.createElement('label');
        label.className = 'multiselect-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = opt;
        checkbox.checked = selectedValues.includes(opt);
        checkbox.onchange = () => handleSelectionChange(filterKey, opt);
        
        const text = document.createElement('span');
        text.textContent = opt;

        const countSpan = document.createElement('span');
        countSpan.className = 'filter-option-count';

        label.appendChild(checkbox);
        label.appendChild(text);
        label.appendChild(countSpan);
        listElement.appendChild(label);
    });
}

function populateSegmentedControl(filterKey, options) {
    const container = dom.filterElements[filterKey]?.segmentedControl;
    if (!container) return;
    container.innerHTML = '';
    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'segmented-btn';
        btn.dataset.value = opt;
        btn.onclick = () => handleSelectionChange(filterKey, opt);
        
        const text = document.createElement('span');
        text.textContent = opt;
        
        const countSpan = document.createElement('span');
        countSpan.className = 'filter-option-count';

        btn.appendChild(text);
        btn.appendChild(countSpan);
        container.appendChild(btn);
    });
}

function handleSelectionChange(filterKey, value) {
    const selectedValues = state.selectedFilters[filterKey];
    const index = selectedValues.indexOf(value);
    if (index > -1) {
        selectedValues.splice(index, 1);
    } else {
        selectedValues.push(value);
    }

    if (filterKey === 'subject') {
        state.selectedFilters.topic = [];
        state.selectedFilters.subTopic = [];
    } else if (filterKey === 'topic') {
        state.selectedFilters.subTopic = [];
    }

    onFilterStateChange();
}

function onFilterStateChange(immediate = false) {
    updateDependentFilters();
    updateAllFilterCountsAndAvailability(); // This remains client-side for speed
    updateActiveFiltersSummaryBar();

    if (immediate) {
        fetchAndApplyFilters();
    } else {
        debouncedFetch(); 
    }
}

function updateDependentFilters() {
    const { subject: selectedSubjects, topic: selectedTopics } = state.selectedFilters;
    const { topic: topicElements, subTopic: subTopicElements } = dom.filterElements;

    if (selectedSubjects.length === 0) {
        topicElements.toggleBtn.disabled = true;
        topicElements.toggleBtn.textContent = "Select a Subject first";
        topicElements.list.innerHTML = '';
    } else {
        topicElements.toggleBtn.disabled = false;
        const relevantTopics = new Set();
        state.allQuestionsMasterList.forEach(q => {
            if (q.subject && selectedSubjects.includes(q.subject)) {
                if (q.topic) {
                    relevantTopics.add(q.topic);
                }
            }
        });
        populateMultiSelect('topic', [...relevantTopics].sort());
    }

    if (selectedTopics.length === 0) {
        subTopicElements.toggleBtn.disabled = true;
        subTopicElements.toggleBtn.textContent = "Select a Topic first";
        subTopicElements.list.innerHTML = '';
    } else {
        subTopicElements.toggleBtn.disabled = false;
        const relevantSubTopics = new Set();
        state.allQuestionsMasterList.forEach(q => {
            if (q.subject && selectedSubjects.includes(q.subject) &&
                q.topic && selectedTopics.includes(q.topic)) {
                if (q.subTopic) {
                    relevantSubTopics.add(q.subTopic);
                }
            }
        });
        populateMultiSelect('subTopic', [...relevantSubTopics].sort());
    }
}

async function fetchAndApplyFilters() {
    setButtonsLoading(true);
    const filters = state.selectedFilters;

    let query = supabase
        .from('questions')
        .select('*', { count: 'exact' });

    if (filters.subject.length > 0) query = query.in('subject', filters.subject);
    if (filters.topic.length > 0) query = query.in('topic', filters.topic);
    if (filters.subTopic.length > 0) query = query.in('subTopic', filters.subTopic);
    if (filters.difficulty.length > 0) query = query.in('difficulty', filters.difficulty);
    if (filters.questionType.length > 0) query = query.in('questionType', filters.questionType);
    if (filters.examName.length > 0) query = query.in('examName', filters.examName);
    if (filters.examYear.length > 0) query = query.in('examYear', filters.examYear);
    if (filters.tags.length > 0) query = query.contains('tags', filters.tags);
    
    const { data, error, count } = await query;

    if (error) {
        console.error('Error fetching filtered questions:', error);
        state.filteredQuestionsMasterList = [];
        updateQuestionCount(0);
    } else {
        state.filteredQuestionsMasterList = data;
        updateQuestionCount(count);
    }
    setButtonsLoading(false);
}


function updateAllFilterCountsAndAvailability() {
    // This function still runs client-side for UI responsiveness.
    const clientSideFilter = (list, filters) => {
        const checkCategory = (questionValue, selectedValues) => {
            if (selectedValues.length === 0) return true;
            if (questionValue === null || questionValue === undefined) return false;
            if (Array.isArray(questionValue)) {
                return questionValue.some(val => selectedValues.includes(val));
            }
            return selectedValues.includes(questionValue);
        };
        return list.filter(q =>
            checkCategory(q.subject, filters.subject) &&
            checkCategory(q.topic, filters.topic) &&
            checkCategory(q.subTopic, filters.subTopic) &&
            checkCategory(q.difficulty, filters.difficulty) &&
            checkCategory(q.questionType, filters.questionType) &&
            checkCategory(q.examName, filters.examName) &&
            checkCategory(q.examYear, filters.examYear) &&
            checkCategory(q.tags, filters.tags)
        );
    };

    config.filterKeys.forEach(filterKey => {
        const tempFilters = JSON.parse(JSON.stringify(state.selectedFilters));
        tempFilters[filterKey] = [];
        const contextualList = clientSideFilter(state.allQuestionsMasterList, tempFilters);

        const counts = {};
        contextualList.forEach(q => {
            const value = getQuestionValue(q, filterKey);
            if (Array.isArray(value)) {
                value.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
            } else if (value) {
                counts[value] = (counts[value] || 0) + 1;
            }
        });

        updateFilterUI(filterKey, counts);
    });
}

function updateFilterUI(filterKey, counts) {
    const { list, segmentedControl } = dom.filterElements[filterKey];
    if (list) {
        list.querySelectorAll('.multiselect-item').forEach(label => {
            const checkbox = label.querySelector('input');
            const value = checkbox.value;
            const count = counts[value] || 0;
            label.querySelector('.filter-option-count').textContent = `(${count})`;
            const isDisabled = count === 0 && !checkbox.checked;
            label.classList.toggle('disabled', isDisabled);
            checkbox.disabled = isDisabled;
        });
        updateMultiSelectButtonText(filterKey);
    } else if (segmentedControl) {
        segmentedControl.querySelectorAll('.segmented-btn').forEach(btn => {
            const value = btn.dataset.value;
            const count = counts[value] || 0;
            btn.querySelector('.filter-option-count').textContent = `(${count})`;
            btn.classList.toggle('active', state.selectedFilters[filterKey].includes(value));
        });
    }
}

function getQuestionValue(q, filterKey) {
    return q[filterKey];
}

function updateQuestionCount(count) {
    const countElements = [
        dom.questionCount,
        dom.pptQuestionCount,
        dom.pdfQuestionCount,
        dom.jsonQuestionCount
    ];
    
    // Check if the count has actually changed to avoid unnecessary animations
    const hasChanged = dom.questionCount.textContent !== String(count);

    countElements.forEach(el => {
        if (el) {
            el.textContent = count;
            if (hasChanged) {
                triggerCountAnimation(el);
            }
        }
    });

    const hasQuestions = count > 0;
    dom.startQuizBtn.disabled = !hasQuestions;
    dom.createPptBtn.disabled = !hasQuestions;
    dom.createPdfBtn.disabled = !hasQuestions;
    dom.downloadJsonBtn.disabled = !hasQuestions;
}


function setButtonsLoading(isLoading) {
    dom.startQuizBtn.classList.toggle('loading', isLoading);
    dom.createPptBtn.classList.toggle('loading', isLoading);
    dom.createPdfBtn.classList.toggle('loading', isLoading);
    dom.downloadJsonBtn.classList.toggle('loading', isLoading);
}

function resetFilters() {
    state.selectedFilters = {
        subject: [], topic: [], subTopic: [], 
        difficulty: [], questionType: [], 
        examName: [], examYear: [], 
        tags: []
    };
    config.filterKeys.forEach(key => {
         if (!dom.filterElements[key]) return;
         const elements = dom.filterElements[key];
         if (elements.list) {
             elements.list.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
         }
         if(elements.searchInput) elements.searchInput.value = '';
         filterMultiSelectList(key);
    });
    onFilterStateChange(true);
}

function startFilteredQuiz() {
    if (state.filteredQuestionsMasterList.length === 0) {
        Swal.fire('No Questions Found', 'Please adjust your filters to select at least one question.', 'warning');
        return;
    }
    appCallbacks.startQuiz();
}

async function generateDocument(format) {
    const questions = state.filteredQuestionsMasterList;
    if (questions.length === 0) {
        Swal.fire({
            target: dom.filterSection,
            title: 'No Questions Selected',
            text: `Please apply filters to select questions before creating a ${format.toUpperCase()}.`,
            icon: 'info'
        });
        return;
    }

    const overlay = dom[`${format}LoadingOverlay`];
    const textEl = dom[`${format}LoadingText`];
    const detailsEl = dom[`${format}LoadingDetails`];
    const progressBarEl = dom[`${format}LoadingProgressBar`];

    overlay.style.display = 'flex';
    textEl.textContent = `Generating Your ${format.toUpperCase()}...`;
    detailsEl.textContent = 'Initializing worker...';
    progressBarEl.style.width = '0%';

    if (docWorker) {
        docWorker.terminate();
    }
    docWorker = new Worker('./js/worker.js');
    
    docWorker.postMessage({
        type: 'generate',
        format: format,
        questions: questions,
        selectedFilters: state.selectedFilters
    });

    docWorker.onmessage = (e) => {
        const { type, value, details, blob, filename, error } = e.data;
        if (type === 'progress') {
            progressBarEl.style.width = `${value}%`;
            detailsEl.textContent = details;
        } else if (type === 'result') {
            textEl.textContent = 'Finalizing & Downloading...';
            detailsEl.textContent = 'Please wait, this may take a moment.';
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            overlay.style.display = 'none';
            docWorker.terminate();
            docWorker = null;
        } else if (type === 'error') {
            console.error(`Error from ${format} worker:`, error);
            Swal.fire({
                target: dom.filterSection,
                title: 'Error',
                text: `An unexpected error occurred while generating the ${format.toUpperCase()}: ${error}`,
                icon: 'error'
            });
            overlay.style.display = 'none';
            docWorker.terminate();
            docWorker = null;
        }
    };

    docWorker.onerror = (e) => {
        console.error(`Unhandled error in ${format} worker:`, e);
        Swal.fire({
            target: dom.filterSection,
            title: 'Worker Error',
            text: `A critical error occurred in the document generation process. Please check the console for details.`,
            icon: 'error'
        });
        if (docWorker) {
            docWorker.terminate();
            docWorker = null;
        }
    };
}


function toggleMultiSelectDropdown(filterKey, forceClose = false) {
    const dropdown = dom.filterElements[filterKey]?.dropdown;
    if (!dropdown) return;
    const isVisible = dropdown.style.display === 'flex';
    if (forceClose) {
        dropdown.style.display = 'none';
    } else {
        dropdown.style.display = isVisible ? 'none' : 'flex';
    }
}

function filterMultiSelectList(filterKey) {
    const elements = dom.filterElements[filterKey];
    if (!elements || !elements.searchInput || !elements.list) return;

    const searchTerm = elements.searchInput.value.toLowerCase();
    elements.list.querySelectorAll('.multiselect-item').forEach(label => {
        const itemText = label.querySelector('span:not(.filter-option-count)').textContent.trim().toLowerCase();
        label.style.display = itemText.includes(searchTerm) ? 'flex' : 'none';
    });
}

function updateMultiSelectButtonText(filterKey) {
    const toggleBtn = dom.filterElements[filterKey]?.toggleBtn;
    if (!toggleBtn || toggleBtn.disabled) return;

    const selected = state.selectedFilters[filterKey] || [];
    const count = selected.length;
    const labelText = dom.filterElements[filterKey].container.previousElementSibling.textContent;

    if (count === 0) {
        let plural = labelText.endsWith('s') ? labelText : labelText + 's';
        toggleBtn.textContent = `Select ${plural}`;
    } else if (count === 1) {
        toggleBtn.textContent = selected[0];
    } else {
        let plural = labelText.endsWith('s') ? labelText : labelText + 's';
        toggleBtn.textContent = `${count} ${plural} Selected`;
    }
}

function updateActiveFiltersSummaryBar() {
    dom.activeFiltersSummaryBar.innerHTML = '';
    let totalSelected = 0;
    config.filterKeys.forEach(key => {
        const selected = state.selectedFilters[key] || [];
        totalSelected += selected.length;
        selected.forEach(value => {
            const tag = document.createElement('span');
            tag.className = 'filter-tag';
            tag.textContent = value;
            
            const closeBtn = document.createElement('button');
            closeBtn.className = 'tag-close-btn';
            closeBtn.innerHTML = '&times;';
            closeBtn.setAttribute('aria-label', `Remove ${value} filter`);
            closeBtn.onclick = () => handleSelectionChange(key, value);
            
            tag.appendChild(closeBtn);
            dom.activeFiltersSummaryBar.appendChild(tag);
        });
    });
    dom.activeFiltersSummaryBarContainer.style.display = totalSelected > 0 ? 'block' : 'none';
}

async function handleQuickStart(preset) {
    resetFilters();
    let difficultyFilter = [];
    switch (preset) {
        case 'quick_25_easy': difficultyFilter = ['Easy']; break;
        case 'quick_25_moderate': difficultyFilter = ['Medium']; break;
        case 'quick_25_hard': difficultyFilter = ['Hard']; break;
        case 'quick_25_mix': /* No filter */ break;
    }
    
    setButtonsLoading(true);

    try {
        let countQuery = supabase.from('questions').select('*', { count: 'exact', head: true });
        if (difficultyFilter.length > 0) {
            countQuery = countQuery.in('difficulty', difficultyFilter);
        }
        const { count, error: countError } = await countQuery;
        
        if (countError) throw countError;

        if (count === 0) {
            Swal.fire({
                target: dom.filterSection,
                title: 'No Questions Found',
                text: 'This quick start preset yielded no questions. Please try another or use the custom filters.',
                icon: 'warning'
            });
            resetFilters();
            return;
        }

        const limit = Math.min(25, count);
        const randomOffset = count > limit ? Math.floor(Math.random() * (count - limit + 1)) : 0;

        let dataQuery = supabase.from('questions').select('*');
        if (difficultyFilter.length > 0) {
            dataQuery = dataQuery.in('difficulty', difficultyFilter);
        }
        const { data, error: dataError } = await dataQuery.range(randomOffset, randomOffset + limit - 1);

        if (dataError) throw dataError;

        state.filteredQuestionsMasterList = data;
        updateQuestionCount(data.length);
        startFilteredQuiz();

    } catch (error) {
        console.error('Quick Start failed:', error);
        Swal.fire({
            target: dom.filterSection,
            title: 'Error',
            text: `Could not fetch questions for Quick Start: ${error.message}`,
            icon: 'error'
        });
    } finally {
        setButtonsLoading(false);
    }
}

async function downloadJSON() {
    const questions = state.filteredQuestionsMasterList;
    if (questions.length === 0) {
        Swal.fire({
            target: dom.filterSection,
            title: 'No Questions Selected',
            text: 'Please apply filters to select questions before downloading.',
            icon: 'info'
        });
        return;
    }

    try {
        // Pretty print the JSON with an indentation of 2 spaces
        const jsonString = JSON.stringify(questions, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'Quiz_LM_Questions.json';
        document.body.appendChild(a);
        a.click();

        // Clean up
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    } catch (error) {
        console.error("Error generating JSON file:", error);
        Swal.fire({
            target: dom.filterSection,
            title: 'Error',
            text: `An unexpected error occurred while generating the JSON file: ${error.message}`,
            icon: 'error'
        });
    }
}