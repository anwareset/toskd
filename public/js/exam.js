// public/js/exam.js

let currentPack = null;
let currentQuestionIndex = 0;
let timeLeft = 0;
let timer = null;
let answers = {}; // {question_id: 'A', ...}
let questions = []; // To store the questions for the current pack

const packNameEl = document.getElementById('pack-name');
const timeLeftEl = document.getElementById('time-left');
const questionContentEl = document.getElementById('question-content');
const optionsContainerEl = document.getElementById('options');
const prevQuestionBtn = document.getElementById('prev-question');
const nextQuestionBtn = document.getElementById('next-question');
const endExamBtn = document.getElementById('end-exam');
const questionNumbersEl = document.getElementById('question-numbers');

// Function to get URL parameters
function getUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    return {
        packId: urlParams.get('packId')
    };
}

// Function to fetch pack details and questions
async function initializeExam() {
    const params = getUrlParams();
    if (!params.packId) {
        // If no packId, redirect to dashboard to select one
        window.location.href = '/dashboard.html';
        return;
    }

    try {
        // Fetch pack details
        const packRes = await fetch(`/api/packs/${params.packId}`);
        currentPack = await packRes.json();
        packNameEl.textContent = `Paket Soal: ${currentPack.name}`;
        timeLeft = currentPack.duration_minutes * 60; // Convert minutes to seconds
        startTimer();

        // Fetch questions for the pack
        const questionsRes = await fetch(`/api/packs/${params.packId}/questions`);
        questions = await questionsRes.json();
        renderQuestionNumbers();
        loadQuestion(currentQuestionIndex);
    } catch (error) {
        console.error('Error initializing exam:', error);
        // Handle error, maybe show a message to the user
        questionContentEl.textContent = 'Gagal memuat soal. Silakan coba lagi.';
    }
}

// Function to render question number buttons
function renderQuestionNumbers() {
    questionNumbersEl.innerHTML = ''; // Clear existing numbers
    questions.forEach((_, index) => {
        const button = document.createElement('button');
        button.classList.add('question-number');
        button.textContent = index + 1;
        button.dataset.index = index;
        button.addEventListener('click', () => {
            currentQuestionIndex = index;
            loadQuestion(currentQuestionIndex);
            updateNavigationButtons();
            updateQuestionNumberStyles();
        });
        questionNumbersEl.appendChild(button);
    });
}

// Function to load a specific question
function loadQuestion(index) {
    if (index < 0 || index >= questions.length) return;

    const question = questions[index];
    questionContentEl.innerHTML = question.content; // Use innerHTML to render HTML content

    // Clear previous options and check state
    const optionsHtml = Object.entries(question.options).map(([key, value]) => {
        const isChecked = answers[question.id] === key ? 'checked' : '';
        return `
          <label>
            <input type="radio" name="answer" value="${key}" ${isChecked}>
            ${key}. ${value}
          </label>
        `;
    }).join('');

    document.querySelectorAll('.options label').forEach(label => {
        // Remove old event listeners to prevent duplicates if any
        const input = label.querySelector('input');
        if (input) {
            const oldListener = input._changeListener;
            if (oldListener) input.removeEventListener('change', oldListener);
        }
        label.remove(); // Remove existing labels
    });
    document.querySelector('.options').insertAdjacentHTML('beforeend', optionsHtml);

    // Add event listeners to the new radio buttons
    document.querySelectorAll('.options input[name="answer"]').forEach(radioInput => {
        radioInput.addEventListener('change', handleAnswerSelection);
    });

    currentQuestionIndex = index;
    updateNavigationButtons();
    updateQuestionNumberStyles();
}

// Handle answer selection
function handleAnswerSelection(event) {
    const selectedValue = event.target.value;
    const questionId = questions[currentQuestionIndex].id;
    answers[questionId] = selectedValue;
    updateQuestionNumberStyles(); // Update style immediately after selection
    // Optionally, automatically go to the next question or save progress
    // nextQuestion();
}

// Function to update navigation button states
function updateNavigationButtons() {
    prevQuestionBtn.disabled = currentQuestionIndex === 0;
    nextQuestionBtn.disabled = currentQuestionIndex === questions.length - 1;
}

// Function to update question number styles based on answers
function updateQuestionNumberStyles() {
    const currentQuestionId = questions[currentQuestionIndex].id;
    questions.forEach((q, index) => {
        const button = questionNumbersEl.querySelector(`.question-number[data-index='${index}']`);
        if (button) {
            if (answers[q.id]) {
                if (q.correct_answer === answers[q.id]) {
                    button.classList.add('correct');
                    button.classList.remove('incorrect', 'unanswered');
                } else {
                    button.classList.add('incorrect');
                    button.classList.remove('correct', 'unanswered');
                }
            } else {
                button.classList.add('unanswered');
                button.classList.remove('correct', 'incorrect');
            }
        }
    });

    // Highlight the current question number
    const currentButton = questionNumbersEl.querySelector(`.question-number[data-index='${currentQuestionIndex}']`);
    document.querySelectorAll('.question-number').forEach(btn => btn.classList.remove('active'));
    if (currentButton) {
        currentButton.classList.add('active');
    }
}

// Timer countdown function
function startTimer() {
    timer = setInterval(() => {
        timeLeft--;
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        timeLeftEl.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

        if (timeLeft <= 0) {
            clearInterval(timer);
            endExam();
        }
    }, 1000);
}

// Function to end the exam and submit answers
async function endExam() {
    clearInterval(timer);
    // Get participant name - assuming it's in a hidden input or derived elsewhere
    // For now, using a placeholder or prompting
    const participantName = prompt('Masukkan nama Anda untuk menyimpan hasil:');
    if (!participantName) {
        alert('Nama peserta diperlukan untuk menyimpan hasil.');
        // Optionally, restart timer or allow user to re-enter name
        startTimer(); // Restart timer if user cancels prompt
        return;
    }

    try {
        const response = await fetch('/api/exam/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                pack_id: currentPack.id,
                participant_name: participantName,
                answers: answers
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        window.location.href = `/review.html?id=${result.id}`;
    } catch (error) {
        console.error('Error submitting exam:', error);
        alert('Gagal mengirim hasil ujian. Silakan coba lagi.');
    }
}

// Event listeners for navigation buttons
prevQuestionBtn.addEventListener('click', () => {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        loadQuestion(currentQuestionIndex);
        updateNavigationButtons();
        updateQuestionNumberStyles();
    }
});

nextQuestionBtn.addEventListener('click', () => {
    if (currentQuestionIndex < questions.length - 1) {
        currentQuestionIndex++;
        loadQuestion(currentQuestionIndex);
        updateNavigationButtons();
        updateQuestionNumberStyles();
    }
});

endExamBtn.addEventListener('click', () => {
    if (confirm('Apakah Anda yakin ingin mengakhiri ujian?')) {
        endExam();
    }
});

// Initial load
window.addEventListener('load', initializeExam);
