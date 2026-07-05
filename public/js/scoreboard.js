// public/js/scoreboard.js

// DOM Elements
const packSelectEl = document.getElementById('pack-select');
const scoreboardBodyEl = document.getElementById('scoreboard-body');

// State
let packs = [];

// Initialize scoreboard
async function initializeScoreboard() {
    try {
        await loadPacks();
        if (packs.length > 0) {
            loadScoreboard(packs[0].id); // Load first pack by default
        }
    } catch (error) {
        console.error('Error initializing scoreboard:', error);
        alert('Gagal memuat scoreboard. Silakan refresh halaman.');
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
        renderPackOptions();
    } catch (error) {
        console.error('Error loading packs:', error);
        throw error;
    }
}

// Render pack options in select element
function renderPackOptions() {
    packSelectEl.innerHTML = '';
    packs.forEach(pack => {
        const option = document.createElement('option');
        option.value = pack.id;
        option.textContent = pack.name;
        packSelectEl.appendChild(option);
    });
}

// Load scoreboard for a specific pack
async function loadScoreboard(packId) {
    try {
        const response = await fetch(`/api/scoreboard?pack_id=${packId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const results = await response.json();
        renderScoreboard(results);
    } catch (error) {
        console.error('Error loading scoreboard:', error);
        alert('Gagal memuat data scoreboard.');
    }
}

// Render scoreboard
function renderScoreboard(results) {
    scoreboardBodyEl.innerHTML = '';
    if (results.length === 0) {
        scoreboardBodyEl.innerHTML = '<tr><td colspan="3">Belum ada hasil ujian untuk paket ini.</td></tr>';
        return;
    }

    results.forEach(result => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${result.participant_name}</td>
            <td>${result.score}</td>
            <td>${result.status}</td>
        `;
        scoreboardBodyEl.appendChild(row);
    });
}

// Event listener for pack selection change
packSelectEl.addEventListener('change', (event) => {
    const packId = event.target.value;
    loadScoreboard(packId);
});

// Initial load
window.addEventListener('load', initializeScoreboard);
