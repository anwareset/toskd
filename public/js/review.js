// public/js/review.js

// Function to get URL parameters
function getUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    return {
        resultId: urlParams.get('id')
    };
}

// Function to fetch and display exam results
async function loadExamResults() {
    const params = getUrlParams();
    if (!params.resultId) {
        alert('ID hasil ujian tidak ditemukan.');
        window.location.href = '/index.html';
        return;
    }

    try {
        const response = await fetch(`/api/exam/${params.resultId}/results`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();

        // Display basic info
        document.getElementById('participant-name').textContent = result.participant_name;
        document.getElementById('score').textContent = result.score;
        document.getElementById('status').textContent = result.status;

        // Fetch pack questions to display review
        const questionsResponse = await fetch(`/api/packs/${result.pack_id}/questions`);
        if (!questionsResponse.ok) {
            throw new Error(`HTTP error! status: ${questionsResponse.status}`);
        }
        const questions = await questionsResponse.json();

        // Display each question with review
        const reviewContainer = document.getElementById('review-questions');
        reviewContainer.innerHTML = ''; // Clear existing content

        questions.forEach((question, index) => {
            const questionDiv = document.createElement('div');
            questionDiv.classList.add('question-review');

            const userAnswer = result.answers[question.id];
            const isCorrect = userAnswer === question.correct_answer;
            const isAnswered = userAnswer !== undefined;

            let statusClass = '';
            let statusText = '';
            if (!isAnswered) {
                statusClass = 'unanswered';
                statusText = 'Tidak dijawab';
            } else if (isCorrect) {
                statusClass = 'correct';
                statusText = 'Benar';
            } else {
                statusClass = 'incorrect';
                statusText = `Salah (Jawaban benar: ${question.correct_answer})`;
            }

            questionDiv.innerHTML = `
                <h3>Soal ${index + 1}</h3>
                <div class="question-content">${question.content}</div>
                <div class="options">
                    ${Object.entries(question.options).map(([key, value]) => {
                        const isUserAnswer = key === userAnswer;
                        const isCorrectAnswer = key === question.correct_answer;
                        let optionClass = '';
                        if (isUserAnswer && isCorrectAnswer) optionClass = 'correct-option';
                        else if (isUserAnswer && !isCorrectAnswer) optionClass = 'incorrect-option';
                        else if (isCorrectAnswer) optionClass = 'correct-option';

                        return `<div class="option ${optionClass}">
                            ${key}. ${value}
                        </div>`;
                    }).join('')}
                </div>
                <div class="question-status ${statusClass}">${statusText}</div>
                <div class="explanation">
                    <h4>Pembahasan:</h4>
                    <p>${question.explanation}</p>
                </div>
            `;

            reviewContainer.appendChild(questionDiv);
        });
    } catch (error) {
        console.error('Error loading exam results:', error);
        alert('Gagal memuat hasil ujian. Silakan coba lagi.');
    }
}

// Initial load
window.addEventListener('load', loadExamResults);
