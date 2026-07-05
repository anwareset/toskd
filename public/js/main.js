// public/js/main.js

document.getElementById('start-exam').addEventListener('click', () => {
  // Placeholder for starting the exam - might involve selecting a pack first
  // For now, let's redirect to the exam page directly
  window.location.href = '/exam.html';
});

document.getElementById('manage-questions').addEventListener('click', () => {
  window.location.href = '/dashboard.html';
});

document.getElementById('scoreboard').addEventListener('click', () => {
  window.location.href = '/scoreboard.html';
});
