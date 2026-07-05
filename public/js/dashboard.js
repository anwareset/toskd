// public/js/dashboard.js

// DOM Elements
const questionListEl = document.getElementById('question-list');
const packListEl = document.getElementById('pack-list');
const addQuestionBtn = document.getElementById('add-question');
const createPackBtn = document.getElementById('create-pack');

// State
let questions = [];
let packs = [];

// Initialize dashboard
async function initializeDashboard() {
    try {
        await Promise.all([
            loadQuestions(),
            loadPacks()
        ]);
    } catch (error) {
        console.error('Error initializing dashboard:', error);
        alert('Gagal memuat dashboard. Silakan refresh halaman.');
    }
}

// Load all questions
async function loadQuestions() {
    try {
        const response = await fetch('/api/questions');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        questions = await response.json();
        renderQuestions();
    } catch (error) {
        console.error('Error loading questions:', error);
        throw error;
    }
}

// Load all question packs
async function loadPacks() {
    try {
        const response = await fetch('/api/packs');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        packs = await response.json();
        renderPacks();
    } catch (error) {
        console.error('Error loading packs:', error);
        throw error;
    }
}

// Render questions
function renderQuestions() {
    questionListEl.innerHTML = '';
    if (questions.length === 0) {
        questionListEl.innerHTML = '<li>Belum ada soal. Tambahkan soal baru.</li>';
        return;
    }

    questions.forEach(question => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div>
                <strong>${question.content.substring(0, 50)}...</strong>
                <span>(${question.question_type})</span>
                <button onclick="editQuestion(${question.id})">Edit</button>
                <button onclick="deleteQuestion(${question.id})">Hapus</button>
            </div>
        `;
        questionListEl.appendChild(li);
    });
}

// Render packs
function renderPacks() {
    packListEl.innerHTML = '';
    if (packs.length === 0) {
        packListEl.innerHTML = '<li>Belum ada paket soal. Buat paket soal baru.</li>';
        return;
    }

    packs.forEach(pack => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div>
                <strong>${pack.name}</strong>
                <span>${pack.duration_minutes} menit</span>
                <button onclick="editPack(${pack.id})">Edit</button>
                <button onclick="viewPack(${pack.id})">Lihat Soal</button>
                <button onclick="deletePack(${pack.id})">Hapus</button>
            </div>
        `;
        packListEl.appendChild(li);
    });
}

// Add question functionality
addQuestionBtn.addEventListener('click', () => {
    // For simplicity, open a prompt to add a question
    // In a real app, this would open a form/modal
    const content = prompt('Masukkan teks soal:');
    if (!content) return;

    const questionType = prompt('Tipe soal (text/math/figural):', 'text');
    if (!questionType) return;

    // For brevity, using defaults for options, correct_answer, explanation
    const options = {
        A: prompt('Opsi A:', 'Pilihan A'),
        B: prompt('Opsi B:', 'Pilihan B'),
        C: prompt('Opsi C:', 'Pilihan C'),
        D: prompt('Opsi D:', 'Pilihan D'),
        E: prompt('Opsi E:', 'Pilihan E')
    };

    const correctAnswer = prompt('Jawaban benar (A/B/C/D/E):', 'A');
    const explanation = prompt('Pembahasan soal:');

    // Call API to add question
    fetch('/api/questions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            content,
            question_type: questionType,
            options,
            correct_answer: correctAnswer,
            explanation
        })
    })
    .then(response => response.json())
    .then(data => {
        alert('Soal berhasil ditambahkan!');
        loadQuestions();
    })
    .catch(error => {
        console.error('Error adding question:', error);
        alert('Gagal menambahkan soal.');
    });
});

// Create pack functionality
createPackBtn.addEventListener('click', () => {
    const name = prompt('Nama paket soal:');
    if (!name) return;

    const durationMinutes = parseInt(prompt('Durasi ujian (menit):', '60'));
    const passingGrade = parseInt(prompt('Nilai kelulusan (0-100):', '85'));

    // Call API to create pack
    fetch('/api/packs', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name,
            duration_minutes: durationMinutes,
            passing_grade: passingGrade
        })
    })
    .then(response => response.json())
    .then(data => {
        alert('Paket soal berhasil dibuat!');
        loadPacks();
    })
    .catch(error => {
        console.error('Error creating pack:', error);
        alert('Gagal membuat paket soal.');
    });
});

// Placeholder functions for edit/delete
function editQuestion(id) {
    alert(`Edit soal dengan ID ${id} - implementasikan form edit`);
}

function deleteQuestion(id) {
    if (confirm('Hapus soal ini?')) {
        // In a real app, call DELETE /api/questions/:id
        alert(`Soal dengan ID ${id} dihapus - implementasikan API`);
        loadQuestions();
    }
}

function editPack(id) {
    alert(`Edit paket soal dengan ID ${id} - implementasikan form edit`);
}

function viewPack(id) {
    // Redirect to a pack detail page or show questions in the pack
    window.location.href = `/exam.html?packId=${id}`;
}

function deletePack(id) {
    if (confirm('Hapus paket soal ini?')) {
        // In a real app, call DELETE /api/packs/:id
        alert(`Paket soal dengan ID ${id} dihapus - implementasikan API`);
        loadPacks();
    }
}

// Initial load
window.addEventListener('load', initializeDashboard);
