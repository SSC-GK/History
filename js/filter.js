import { config, state } from './state.js';
import { dom } from './dom.js';
import { shuffleArray } from './utils.js';

let appCallbacks = {};

export function initFilterModule(callbacks) {
    appCallbacks = callbacks;
    initializeTabs();
    bindFilterEventListeners();
    loadQuestionsForFiltering();
    state.callbacks.confirmGoBackToFilters = callbacks.confirmGoBackToFilters;
}

// Helper to remove old question number formats
function cleanQuestionText(text) {
    return (text || "").replace(/^(Q\.\d+\)|प्रश्न \d+\))\s*/, '');
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
        });
    });
}

function bindFilterEventListeners() {
    dom.startQuizBtn.onclick = () => startFilteredQuiz();
    dom.createPptBtn.onclick = () => generatePowerPoint();
    dom.createPdfBtn.onclick = () => generatePDF();
    dom.resetFiltersBtnQuiz.onclick = () => resetFilters();
    dom.resetFiltersBtnPpt.onclick = () => resetFilters();
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
            if (e.target && e.target.id === 'breadcrumb-filters-link') {
                e.preventDefault();
                appCallbacks.confirmGoBackToFilters();
            }
        });
    }
}

async function loadQuestionsForFiltering() {
    try {
        const response = await fetch('./questions.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const contentLength = response.headers.get('Content-Length');
        const total = parseInt(contentLength, 10);
        let loaded = 0;

        // Fallback for servers that don't provide Content-Length or browsers that don't support streams
        if (!total || !response.body) {
            console.warn("Progress bar not supported by this server/browser. Loading questions...");
            if (dom.loadingPercentage) dom.loadingPercentage.textContent = 'Loading...';
            state.allQuestionsMasterList = await response.json();
        } else {
            const reader = response.body.getReader();
            const chunks = [];
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                chunks.push(value);
                loaded += value.length;
                const progress = Math.round((loaded / total) * 100);
                
                // Update UI
                if (dom.loadingProgressBar) dom.loadingProgressBar.style.width = `${progress}%`;
                if (dom.loadingPercentage) dom.loadingPercentage.textContent = `${progress}%`;
            }

            // Combine chunks into a single Uint8Array
            const allChunks = new Uint8Array(loaded);
            let position = 0;
            for (const chunk of chunks) {
                allChunks.set(chunk, position);
                position += chunk.length;
            }

            // Decode and parse JSON
            const resultText = new TextDecoder("utf-8").decode(allChunks);
            state.allQuestionsMasterList = JSON.parse(resultText);
        }
        
        if (!state.allQuestionsMasterList || state.allQuestionsMasterList.length === 0) {
            throw new Error(`No questions were found or the file is empty.`);
        }

        // Smoothly hide the loader
        if (dom.loadingOverlay) {
            dom.loadingOverlay.classList.add('fade-out');
            dom.loadingOverlay.addEventListener('transitionend', () => {
                dom.loadingOverlay.style.display = 'none';
            }, { once: true });
        }
        
        populateFilterControls();
        onFilterStateChange();
    } catch (error) {
        console.error(`Could not load quiz questions:`, error);
        if (dom.loadingOverlay) {
            dom.loadingOverlay.innerHTML = `<div class="loader-content"><h1>Error Loading Quiz</h1><p>Could not fetch the questions. Please check your connection and refresh the page.</p><p style="font-size:0.8em; color: var(--text-color-light)">${error.message}</p></div>`;
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
        if (q.classification?.subject) unique.subject.add(q.classification.subject);
        if (q.properties?.difficulty) unique.difficulty.add(q.properties.difficulty);
        if (q.properties?.questionType) unique.questionType.add(q.properties.questionType);
        if (q.sourceInfo?.examName) unique.examName.add(q.sourceInfo.examName);
        if (q.sourceInfo?.examYear) unique.examYear.add(q.sourceInfo.examYear);
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

function onFilterStateChange() {
    updateDependentFilters();
    applyFilters();
    updateAllFilterCountsAndAvailability();
    updateActiveFiltersSummaryBar();
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
            if (q.classification?.subject && selectedSubjects.includes(q.classification.subject)) {
                if (q.classification?.topic) {
                    relevantTopics.add(q.classification.topic);
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
            if (q.classification?.subject && selectedSubjects.includes(q.classification.subject) &&
                q.classification?.topic && selectedTopics.includes(q.classification.topic)) {
                if (q.classification?.subTopic) {
                    relevantSubTopics.add(q.classification.subTopic);
                }
            }
        });
        populateMultiSelect('subTopic', [...relevantSubTopics].sort());
    }
}

function applyFilters(questionList = state.allQuestionsMasterList, filters = state.selectedFilters) {
    const checkCategory = (questionValue, selectedValues) => {
        if (selectedValues.length === 0) return true;
        if (questionValue === null || questionValue === undefined) return false; 
        if (Array.isArray(questionValue)) {
            return questionValue.some(val => selectedValues.includes(val));
        }
        return selectedValues.includes(questionValue);
    };

    const filtered = questionList.filter(q => 
        checkCategory(q.classification?.subject, filters.subject) &&
        checkCategory(q.classification?.topic, filters.topic) &&
        checkCategory(q.classification?.subTopic, filters.subTopic) &&
        checkCategory(q.properties?.difficulty, filters.difficulty) &&
        checkCategory(q.properties?.questionType, filters.questionType) &&
        checkCategory(q.sourceInfo?.examName, filters.examName) &&
        checkCategory(q.sourceInfo?.examYear, filters.examYear) &&
        checkCategory(q.tags, filters.tags)
    );

    if (filters === state.selectedFilters) {
        state.filteredQuestionsMasterList = filtered;
        updateQuestionCount();
    }
    return filtered;
}

function updateAllFilterCountsAndAvailability() {
    config.filterKeys.forEach(filterKey => {
        const tempFilters = JSON.parse(JSON.stringify(state.selectedFilters));
        tempFilters[filterKey] = [];
        const contextualList = applyFilters(state.allQuestionsMasterList, tempFilters);

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
    switch(filterKey) {
        case 'subject': return q.classification?.subject;
        case 'topic': return q.classification?.topic;
        case 'subTopic': return q.classification?.subTopic;
        case 'difficulty': return q.properties?.difficulty;
        case 'questionType': return q.properties?.questionType;
        case 'examName': return q.sourceInfo?.examName;
        case 'examYear': return q.sourceInfo?.examYear;
        case 'tags': return q.tags;
        default: return null;
    }
}

function updateQuestionCount() {
    const count = state.filteredQuestionsMasterList.length;
    dom.questionCount.textContent = count;
    dom.pptQuestionCount.textContent = count;
    dom.pdfQuestionCount.textContent = count;
    dom.startQuizBtn.disabled = count === 0;
    dom.createPptBtn.disabled = count === 0;
    dom.createPdfBtn.disabled = count === 0;
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
    onFilterStateChange();
}

function startFilteredQuiz() {
    if (state.filteredQuestionsMasterList.length === 0) {
        Swal.fire('No Questions Found', 'Please adjust your filters to select at least one question.', 'warning');
        return;
    }
    appCallbacks.startQuiz();
}

async function generatePowerPoint() {
    const questions = state.filteredQuestionsMasterList;
    if (questions.length === 0) {
        Swal.fire({
            target: dom.filterSection,
            title: 'No Questions Selected',
            text: 'Please apply filters to select questions before creating a PPT.',
            icon: 'info'
        });
        return;
    }

    dom.pptLoadingOverlay.style.display = 'flex';
    dom.pptLoadingText.textContent = 'Generating Your Presentation...';
    dom.pptLoadingDetails.textContent = '';
    dom.pptLoadingProgressBar.style.width = '0%';

    try {
        const pptx = new PptxGenJS();

        pptx.layout = 'LAYOUT_16x9';
        pptx.author = 'Quiz LM App';
        pptx.company = 'AI-Powered Learning';
        pptx.title = 'Customized Quiz Presentation';
        
        const QUESTION_SLIDE_BG = 'DCE6F2';
        const ANSWER_SLIDE_BG = 'E2F0D9';
        const TEXT_COLOR = '191919';
        const CORRECT_ANSWER_COLOR = '006400';
        const ENGLISH_FONT = 'Arial';
        const HINDI_FONT = 'Nirmala UI';

        // --- TITLE SLIDE (WITH DYNAMIC INFO) ---
        let titleSlide = pptx.addSlide();
        titleSlide.background = { color: 'F5F5F5' };
        
        titleSlide.addText("Quiz LM Presentation ✨", {
            x: 0.5, y: 0.8, w: '90%', h: 1,
            fontSize: 44, color: '303f9f', bold: true, align: 'center'
        });
        titleSlide.addText(`Generated with ${questions.length} questions.`, {
            x: 0, y: 2.0, w: '100%', align: 'center', color: TEXT_COLOR, fontSize: 18
        });

        // Timestamp
        const indianTimestamp = new Date().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
        titleSlide.addText(`Created on: ${indianTimestamp} (IST)`, {
            x: 0, y: 2.4, w: '100%', align: 'center', color: '757575', fontSize: 11, italic: true
        });

        // Applied Filters Text
        const filterTextForPPT = [];
        const filterHierarchy = {
            'Classification': ['subject', 'topic', 'subTopic'],
            'Properties': ['difficulty', 'questionType'],
            'Source': ['examName', 'examYear'],
            'Tags': ['tags']
        };

        let hasFilters = false;
        for (const category in filterHierarchy) {
            const filtersInCategory = [];
            filterHierarchy[category].forEach(filterKey => {
                const selected = state.selectedFilters[filterKey];
                if (selected && selected.length > 0) {
                    hasFilters = true;
                    const displayName = filterKey.charAt(0).toUpperCase() + filterKey.slice(1).replace(/([A-Z])/g, ' $1').trim();
                    filtersInCategory.push(`${displayName}: ${selected.join(', ')}`);
                }
            });

            if (filtersInCategory.length > 0) {
                filterTextForPPT.push({ text: category, options: { bold: true, breakLine: true, fontSize: 12, color: '303f9f', align: 'left'} });
                filtersInCategory.forEach(filterText => {
                    filterTextForPPT.push({ text: `  • ${filterText}`, options: { breakLine: true, fontSize: 11, color: TEXT_COLOR, align: 'left' }});
                });
                filterTextForPPT.push({ text: '', options: { breakLine: true } }); // Spacing
            }
        }
        
        if (hasFilters) {
            titleSlide.addText(filterTextForPPT, {
                x: 1.0, y: 3.0, w: '80%', h: 2.5,
                lineSpacing: 22,
                valign: 'top'
            });
        }
        
        // --- QUESTION & ANSWER SLIDES ---
        const totalQuestions = questions.length;

        const parseExplanation = (text) => {
            if (!text) return { heading: '', body: '' };
            const parts = text.split('\n\n');
            const heading = parts.shift() || '';
            const body = parts.join('\n\n').trim();
            return { heading, body };
        };

        for (let i = 0; i < totalQuestions; i++) {
            const question_item = questions[i];
            const slide_question_number = i + 1;

            const progress = Math.round(((i + 1) / totalQuestions) * 100);
            dom.pptLoadingProgressBar.style.width = `${progress}%`;
            dom.pptLoadingDetails.textContent = `Processing question ${slide_question_number} of ${totalQuestions}... (${progress}%)`;

            if (i % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));

            // SLIDE 1: QUESTION & OPTIONS
            let q_slide = pptx.addSlide({ bkgd: QUESTION_SLIDE_BG });
            
            let question_text = cleanQuestionText(question_item.question);
            q_slide.addText(`Q.${slide_question_number}) ${question_text}`, {
                x: 0.5, y: 0.3, w: 9, h: 0.8,
                fontFace: ENGLISH_FONT, fontSize: 20, color: TEXT_COLOR, bold: true
            });

            const question_text_hi = cleanQuestionText(question_item.question_hi);
            q_slide.addText(question_text_hi || '', {
                x: 0.5, y: 1.3, w: 9, h: 0.6,
                fontFace: HINDI_FONT, fontSize: 18, color: TEXT_COLOR, bold: true
            });

            let optionsY = 2.1;
            let optionsArray = [];
            (question_item.options || []).forEach((eng_option, index) => {
                const hin_option = (question_item.options_hi || [])[index] || '';
                const option_letter = String.fromCharCode(65 + index);
                optionsArray.push({
                    text: `${option_letter}) ${eng_option}`,
                    options: { fontFace: ENGLISH_FONT, fontSize: 16, color: TEXT_COLOR }
                });
                optionsArray.push({
                    text: `    ${hin_option}\n`,
                    options: { fontFace: HINDI_FONT, fontSize: 14, color: TEXT_COLOR, breakLine: true }
                });
            });
            q_slide.addText(optionsArray, { x: 0.6, y: optionsY, w: 9, h: 3.2, lineSpacing: 24 });


            // SLIDE 2 & 3: ANSWER & EXPLANATION
            const explanation = question_item.explanation || {};

            const slideParts = [
                {
                    part: 1,
                    title: `Answer & Explanation for Q.${slide_question_number} (Part 1)`,
                    content: [
                        { text: `✅ Correct Answer: ${question_item.correct || 'N/A'}`, style: { fontFace: ENGLISH_FONT, bold: true, fontSize: 16, color: CORRECT_ANSWER_COLOR }, spaceAfter: 16 },
                        parseExplanation(explanation.analysis_correct),
                        parseExplanation(explanation.conclusion),
                    ]
                },
                {
                    part: 2,
                    title: `Answer & Explanation for Q.${slide_question_number} (Part 2)`,
                    content: [
                        parseExplanation(explanation.analysis_incorrect),
                        parseExplanation(explanation.fact),
                    ]
                }
            ];

            slideParts.forEach(partInfo => {
                let aSlide = pptx.addSlide({ bkgd: ANSWER_SLIDE_BG });
                aSlide.addText(partInfo.title, { x: 0.5, y: 0.3, w: 9, h: 0.6, fontFace: ENGLISH_FONT, fontSize: 18, color: TEXT_COLOR, bold: true });

                let currentY = 1.1;
                partInfo.content.forEach(block => {
                    if (block.text) { // For the hardcoded 'Correct Answer' line
                        aSlide.addText(block.text, { x: 0.5, y: currentY, w: 9, h: 0.5, ...block.style });
                        currentY += 0.5 + (block.spaceAfter / 72 || 0.2);
                    } else if (block.heading) { // For parsed explanation blocks
                        // Add Heading
                        aSlide.addText(block.heading, {
                            x: 0.5, y: currentY, w: 9, h: 0.4,
                            fontFace: ENGLISH_FONT, fontSize: 15, bold: true, color: TEXT_COLOR
                        });
                        currentY += 0.45;

                        // Add Body
                        const cleanedBody = block.body.replace(/^- /gm, '').replace(/\*\*/g, '');
                        const lines = cleanedBody.split('\n').length;
                        const bodyHeight = Math.max(0.4, lines * 0.3);
                        aSlide.addText(cleanedBody, {
                            x: 0.6, y: currentY, w: 8.8, h: bodyHeight,
                            fontFace: ENGLISH_FONT, fontSize: 13, color: TEXT_COLOR,
                            italic: block.heading.includes('Note') || block.heading.includes('Fact')
                        });
                        currentY += bodyHeight + 0.3;
                    }
                });
            });
        }

        dom.pptLoadingText.textContent = 'Finalizing & Downloading...';
        dom.pptLoadingDetails.textContent = 'Please wait, this may take a moment.';
        await pptx.writeFile({ fileName: 'Quiz_LM_Presentation.pptx' });

    } catch (error) {
        console.error("Error generating PPT:", error);
        Swal.fire({
            target: dom.filterSection,
            title: 'Error',
            text: `An unexpected error occurred while generating the presentation: ${error.message}`,
            icon: 'error'
        });
    } finally {
        dom.pptLoadingOverlay.style.display = 'none';
    }
}


async function generatePDF() {
    const questions = state.filteredQuestionsMasterList;
    if (questions.length === 0) {
        Swal.fire({
            target: dom.filterSection,
            title: 'No Questions Selected',
            text: 'Please apply filters to select questions before creating a PDF.',
            icon: 'info'
        });
        return;
    }

    dom.pdfLoadingOverlay.style.display = 'flex';
    dom.pdfLoadingText.textContent = 'Generating Your PDF...';
    dom.pdfLoadingDetails.textContent = '';
    dom.pdfLoadingProgressBar.style.width = '0%';

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        
        const MARGIN = 40;
        const PAGE_WIDTH = doc.internal.pageSize.getWidth();
        const PAGE_HEIGHT = doc.internal.pageSize.getHeight();
        const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2);
        let y = MARGIN;

        const addFooter = (doc, pageNum, totalPages) => {
            doc.setFont('Helvetica', 'italic');
            doc.setFontSize(9);
            doc.setTextColor(150);
            doc.text('Compiler: Aalok Kumar Sharma', MARGIN, PAGE_HEIGHT - 20);
            doc.text(`Page ${pageNum} of ${totalPages}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 20, { align: 'right' });
        };
        
        // --- Title Page ---
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(26);
        const titleText = 'Quiz LM Question Bank';
        const titleLines = doc.splitTextToSize(titleText, CONTENT_WIDTH);
        doc.text(titleLines, PAGE_WIDTH / 2, y + 20, { align: 'center' });
        y += (titleLines.length * 26) + 30;

        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(16);
        doc.text(`Generated with ${questions.length} questions.`, PAGE_WIDTH / 2, y, { align: 'center' });
        y += 30;

        const indianTimestamp = new Date().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: true
        });
        doc.setFontSize(11);
        doc.setTextColor(120);
        doc.text(`Created on: ${indianTimestamp} (IST)`, PAGE_WIDTH / 2, y, { align: 'center' });
        y += 40;
        
        // Add Hyperlink
        const linkText = 'Attempt the quiz';
        const linkUrl = 'https://cglhustle.free.nf/side_menu/quiz_lm/';
        doc.setFontSize(12);
        doc.setFont('Helvetica', 'normal');
        const textWidth = doc.getTextWidth(linkText);
        const xOffset = (PAGE_WIDTH - textWidth) / 2;
        
        doc.setTextColor(0, 0, 238); // Standard link blue
        doc.textWithLink(linkText, xOffset, y, { url: linkUrl });
        doc.setDrawColor(0, 0, 238);
        doc.line(xOffset, y + 1, xOffset + textWidth, y + 1); // Draw underline
        y += 40;
        
        // Reset text color for filters
        doc.setTextColor(40);


        const filterHierarchy = {
            'Classification': ['subject', 'topic', 'subTopic'],
            'Properties': ['difficulty', 'questionType'],
            'Source': ['examName', 'examYear'],
            'Tags': ['tags']
        };

        let hasFilters = false;
        
        for (const category in filterHierarchy) {
            const filtersInCategory = [];
            filterHierarchy[category].forEach(filterKey => {
                const selected = state.selectedFilters[filterKey];
                if (selected && selected.length > 0) {
                    hasFilters = true;
                    const displayName = filterKey.charAt(0).toUpperCase() + filterKey.slice(1).replace(/([A-Z])/g, ' $1').trim();
                    filtersInCategory.push(`${displayName}: ${selected.join(', ')}`);
                }
            });

            if (filtersInCategory.length > 0) {
                if (y > PAGE_HEIGHT - MARGIN) { doc.addPage(); y = MARGIN; }
                doc.setFont('Helvetica', 'bold');
                doc.setFontSize(12);
                doc.setTextColor(48, 63, 159);
                doc.text(category, MARGIN, y);
                y += 18;

                filtersInCategory.forEach(filterText => {
                    if (y > PAGE_HEIGHT - MARGIN) { doc.addPage(); y = MARGIN; }
                    doc.setFont('Helvetica', 'normal');
                    doc.setFontSize(10);
                    doc.setTextColor(40);
                    const filterLines = doc.splitTextToSize(`• ${filterText}`, CONTENT_WIDTH - 20);
                    doc.text(filterLines, MARGIN + 20, y);
                    y += (filterLines.length * 10 * 1.2);
                });
                y += 10;
            }
        }

        if (!hasFilters) {
            doc.setFontSize(12);
            doc.setTextColor(120);
            doc.text('No filters applied.', MARGIN, y);
        }

        const answers = [];
        
        // --- Questions Loop ---
        doc.addPage();
        let pageNum = 2;
        y = MARGIN;
        
        for (let i = 0; i < questions.length; i++) {
            const question_item = questions[i];
            const questionNum = i + 1;

            const progress = Math.round((i / questions.length) * 50); // 0-50% for questions
            dom.pdfLoadingProgressBar.style.width = `${progress}%`;
            dom.pdfLoadingDetails.textContent = `Processing question ${questionNum} of ${questions.length}...`;
            
            // Add to answer key
            const correctOptIndex = question_item.options.indexOf(question_item.correct);
            let letteredCorrect = String.fromCharCode(65 + correctOptIndex);
            // Data error fallback: if correct answer text isn't in options, try to get letter from explanation
            if (correctOptIndex === -1) {
                const summary = question_item.explanation?.summary || "";
                const match = summary.match(/Correct Answer: ([A-D])\)/);
                if (match) {
                    letteredCorrect = match[1];
                } else {
                    letteredCorrect = '?'; // Fallback if summary also doesn't have it
                }
            }
            answers.push(`${questionNum}. ${letteredCorrect}) ${question_item.correct}`);

            // --- Calculate block height before rendering ---
            const cleanQ = cleanQuestionText(question_item.question);
            const questionText = `Q.${questionNum}) ${cleanQ}`;
            
            doc.setFont('Helvetica', 'bold');
            doc.setFontSize(12);
            const questionLines = doc.splitTextToSize(questionText, CONTENT_WIDTH);
            const questionHeight = (questionLines.length * 12 * 1.2) + 10;

            let optionsHeight = 0;
            doc.setFont('Helvetica', 'normal');
            doc.setFontSize(10);
            question_item.options.forEach((opt, idx) => {
                const optionText = `(${String.fromCharCode(65 + idx)}) ${opt}`;
                const optionLines = doc.splitTextToSize(optionText, CONTENT_WIDTH - 20);
                optionsHeight += (optionLines.length * 10 * 1.2) + 5;
            });

            const totalQuestionBlockHeight = questionHeight + optionsHeight + 20; // 20 for separator
            
            if (y + totalQuestionBlockHeight > PAGE_HEIGHT - MARGIN) {
                doc.addPage();
                pageNum++;
                y = MARGIN;
            }

            // --- Render the block ---
            doc.setFont('Helvetica', 'bold');
            doc.setFontSize(12);
            doc.text(questionLines, MARGIN, y);
            y += (questionLines.length * 12 * 1.2) + 10;

            doc.setFont('Helvetica', 'normal');
            doc.setFontSize(10);
            question_item.options.forEach((opt, idx) => {
                const optionText = `(${String.fromCharCode(65 + idx)}) ${opt}`;
                const optionLines = doc.splitTextToSize(optionText, CONTENT_WIDTH - 20);
                doc.text(optionLines, MARGIN + 20, y);
                y += (optionLines.length * 10 * 1.2) + 5;
            });
            
            y += 15;
            doc.setDrawColor(220);
            doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
            y += 20;

            await new Promise(resolve => setTimeout(resolve, 1));
        }

        // --- Answer Key Page ---
        dom.pdfLoadingDetails.textContent = `Generating Answer Key...`;
        doc.addPage();
        pageNum++;
        y = MARGIN;
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(20);
        doc.text('Answer Key', PAGE_WIDTH / 2, y, { align: 'center' });
        y += 40;

        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(10);
        
        const answerKeyGutter = 30;
        const answerKeyColWidth = (CONTENT_WIDTH - answerKeyGutter) / 2;
        const col1X = MARGIN;
        const col2X = MARGIN + answerKeyColWidth + answerKeyGutter;
        let currentY = y;
        const midPoint = Math.ceil(answers.length / 2);

        for (let i = 0; i < midPoint; i++) {
            const progress = 50 + Math.round((i / midPoint) * 50); // 50-100% for answer key
            dom.pdfLoadingProgressBar.style.width = `${progress}%`;

            const text1 = answers[i];
            const lines1 = doc.splitTextToSize(text1, answerKeyColWidth);
            const { h: height1 } = doc.getTextDimensions(lines1);

            const text2 = (i + midPoint < answers.length) ? answers[i + midPoint] : null;
            let lines2 = [], height2 = 0;
            if (text2) {
                lines2 = doc.splitTextToSize(text2, answerKeyColWidth);
                const { h: h2 } = doc.getTextDimensions(lines2);
                height2 = h2;
            }

            const maxLineHeight = Math.max(height1, height2);

            if (currentY + maxLineHeight > PAGE_HEIGHT - MARGIN - 20) { // Extra buffer for footer
                doc.addPage();
                pageNum++;
                currentY = MARGIN;
            }

            doc.text(lines1, col1X, currentY);
            if (text2) {
                doc.text(lines2, col2X, currentY);
            }
            
            currentY += maxLineHeight + 5; // Add some space between rows
        }
        
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            addFooter(doc, i, totalPages);
        }

        dom.pdfLoadingText.textContent = 'Finalizing & Downloading...';
        dom.pdfLoadingDetails.textContent = 'Please wait, this may take a moment.';
        
        await doc.save('Quiz_LM_Custom_PDF.pdf');

    } catch (error) {
        console.error("Error generating PDF:", error);
        Swal.fire({
            target: dom.filterSection,
            title: 'Error',
            text: `An unexpected error occurred while generating the PDF: ${error.message}`,
            icon: 'error'
        });
    } finally {
        dom.pdfLoadingOverlay.style.display = 'none';
    }
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

function handleQuickStart(preset) {
    resetFilters();
    
    switch(preset) {
        case 'quick_25_easy':
            state.selectedFilters.difficulty = ['Easy'];
            break;
        case 'quick_25_moderate':
            state.selectedFilters.difficulty = ['Medium'];
            break;
        case 'quick_25_hard':
            state.selectedFilters.difficulty = ['Hard'];
            break;
        case 'quick_25_mix':
            // No filter applied, will use all questions
            break;
    }
    applyFilters();
    
    shuffleArray(state.filteredQuestionsMasterList);
    state.filteredQuestionsMasterList = state.filteredQuestionsMasterList.slice(0, 25);

    if (state.filteredQuestionsMasterList.length === 0) {
        Swal.fire({
            target: dom.filterSection,
            title: 'No Questions Found', 
            text: 'This quick start preset yielded no questions. Please try another or use the custom filters.', 
            icon: 'warning'
        });
        resetFilters();
        return;
    }

    startFilteredQuiz();
}