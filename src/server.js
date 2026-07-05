// src/server.js
import express from 'express';
import supabase from './db.js';
import { uploadImage } from './blob.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// API Endpoints

// Get all questions
app.get('/api/questions', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('questions')
      .select('*');

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
});

// Add a new question
app.post('/api/questions', async (req, res) => {
  try {
    const { content, question_type, options, correct_answer, explanation, image } = req.body;
    let image_url = null;

    if (image) {
      // Assuming image is a base64 string or similar, convert to Blob
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const blob = new Blob([buffer]);
      const file = new File([blob], `question-image-${Date.now()}.png`, { type: 'image/png' });
      image_url = await uploadImage(file);
    }

    const { data, error } = await supabase
      .from('questions')
      .insert({ content, question_type, options, correct_answer, explanation, image_url })
      .select();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('Error adding question:', error);
    res.status(500).json({ error: 'Failed to add question' });
  }
});

// Get all question packs
app.get('/api/packs', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('question_packs')
      .select('*');

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching packs:', error);
    res.status(500).json({ error: 'Failed to fetch packs' });
  }
});

// Create a new question pack
app.post('/api/packs', async (req, res) => {
  try {
    const { name, duration_minutes, passing_grade } = req.body;
    const { data, error } = await supabase
      .from('question_packs')
      .insert({ name, duration_minutes, passing_grade: passing_grade || 85 })
      .select();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating pack:', error);
    res.status(500).json({ error: 'Failed to create pack' });
  }
});

// Add questions to a pack
app.post('/api/packs/:id/questions', async (req, res) => {
  try {
    const { id } = req.params;
    const { question_id, question_number } = req.body;

    const { data, error } = await supabase
      .from('pack_questions')
      .insert({ pack_id: id, question_id, question_number })
      .select();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('Error adding question to pack:', error);
    res.status(500).json({ error: 'Failed to add question to pack' });
  }
});

// Get questions for a specific pack
app.get('/api/packs/:id/questions', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('pack_questions')
      .select('*, questions(*)')
      .eq('pack_id', id)
      .order('question_number', { ascending: true });

    if (error) throw error;
    const questions = data.map(item => item.questions);
    res.json(questions);
  } catch (error) {
    console.error('Error fetching pack questions:', error);
    res.status(500).json({ error: 'Failed to fetch pack questions' });
  }
});

// Start exam (create initial exam result record)
app.post('/api/exam/start', async (req, res) => {
  try {
    const { pack_id, participant_name } = req.body;
    const { data, error } = await supabase
      .from('exam_results')
      .insert({
        pack_id,
        participant_name,
        score: 0,
        status: 'In Progress',
        answers: {}
      })
      .select();

    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    console.error('Error starting exam:', error);
    res.status(500).json({ error: 'Failed to start exam' });
  }
});

// Submit exam answers
app.post('/api/exam/submit', async (req, res) => {
  try {
    const { pack_id, participant_name, answers } = req.body;

    // Fetch pack details to get passing grade
    const { data: packData, error: packError } = await supabase
      .from('question_packs')
      .select('passing_grade')
      .eq('id', pack_id)
      .single();

    if (packError) throw packError;

    // Fetch all questions in the pack to calculate score
    const { data: packQuestions, error: questionsError } = await supabase
      .from('pack_questions')
      .select('questions(*)')
      .eq('pack_id', pack_id);

    if (questionsError) throw questionsError;

    // Calculate score
    let correctAnswers = 0;
    const questions = packQuestions.map(item => item.questions);

    questions.forEach(question => {
      if (answers[question.id] === question.correct_answer) {
        correctAnswers++;
      }
    });

    const totalQuestions = questions.length;
    const score = Math.round((correctAnswers / totalQuestions) * 100);
    const status = score >= packData.passing_grade ? 'Lulus PG' : 'Tidak Lulus PG';

    // Save exam result
    const { data, error } = await supabase
      .from('exam_results')
      .insert({
        pack_id,
        participant_name,
        score,
        status,
        answers
      })
      .select();

    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    console.error('Error submitting exam:', error);
    res.status(500).json({ error: 'Failed to submit exam' });
  }
});

// Get exam results
app.get('/api/exam/:id/results', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('exam_results')
      .select('*, question_packs(*)')
      .eq('id', id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching exam results:', error);
    res.status(500).json({ error: 'Failed to fetch exam results' });
  }
});

// Get scoreboard for a specific pack
app.get('/api/scoreboard', async (req, res) => {
  try {
    const { pack_id } = req.query;
    const { data, error } = await supabase
      .from('exam_results')
      .select('participant_name, score, status')
      .eq('pack_id', pack_id)
      .order('score', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching scoreboard:', error);
    res.status(500).json({ error: 'Failed to fetch scoreboard' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
