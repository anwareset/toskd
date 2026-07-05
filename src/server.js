// src/server.js
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import supabase from "./db.js";
import { put } from "@vercel/blob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Middleware
app.use(express.json({ limit: "10mb" }));

// --- API Endpoints ---

// Get all questions
app.get("/api/questions", async (req, res) => {
  try {
    const { data, error } = await supabase.from("questions").select("*");
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error fetching questions:", error);
    res.status(500).json({ error: "Failed to fetch questions" });
  }
});

// Add a new question
app.post("/api/questions", async (req, res) => {
  try {
    const {
      content,
      question_type,
      options,
      correct_answer,
      explanation,
      image,
      explanation_image,
    } = req.body;
    let image_url = null;
    let explanation_image_url = null;

    if (image) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const { url } = await put(`questions/${Date.now()}.png`, buffer, {
        access: "public",
      });
      image_url = url;
    }

    if (explanation_image) {
      const base64Data = explanation_image.replace(
        /^data:image\/\w+;base64,/,
        "",
      );
      const buffer = Buffer.from(base64Data, "base64");
      const { url } = await put(`explanations/${Date.now()}.png`, buffer, {
        access: "public",
      });
      explanation_image_url = url;
    }

    const { data, error } = await supabase
      .from("questions")
      .insert({
        content,
        question_type,
        options,
        correct_answer,
        explanation,
        image_url,
        explanation_image_url,
      })
      .select();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error("Error adding question:", error);
    res.status(500).json({ error: "Failed to add question" });
  }
});

// Get all question packs
app.get("/api/packs", async (req, res) => {
  try {
    const { data, error } = await supabase.from("question_packs").select("*");
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error fetching packs:", error);
    res.status(500).json({ error: "Failed to fetch packs" });
  }
});

// Get single pack by ID
app.get("/api/packs/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("question_packs")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error fetching pack:", error);
    res.status(500).json({ error: "Failed to fetch pack" });
  }
});

// Create a new question pack
app.post("/api/packs", async (req, res) => {
  try {
    const { name, duration_minutes, passing_grade } = req.body;
    const { data, error } = await supabase
      .from("question_packs")
      .insert({ name, duration_minutes, passing_grade: passing_grade || 85 })
      .select();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error("Error creating pack:", error);
    res.status(500).json({ error: "Failed to create pack" });
  }
});

// Add questions to a pack
app.post("/api/packs/:id/questions", async (req, res) => {
  try {
    const { question_id, question_number } = req.body;
    const { data, error } = await supabase
      .from("pack_questions")
      .insert({ pack_id: req.params.id, question_id, question_number })
      .select();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error("Error adding question to pack:", error);
    res.status(500).json({ error: "Failed to add question to pack" });
  }
});

// Get questions for a specific pack
app.get("/api/packs/:id/questions", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("pack_questions")
      .select("*, questions(*)")
      .eq("pack_id", req.params.id)
      .order("question_number", { ascending: true });
    if (error) throw error;
    res.json(data.map((item) => item.questions));
  } catch (error) {
    console.error("Error fetching pack questions:", error);
    res.status(500).json({ error: "Failed to fetch pack questions" });
  }
});

// Start exam
app.post("/api/exam/start", async (req, res) => {
  try {
    const { pack_id, participant_name } = req.body;
    const { data, error } = await supabase
      .from("exam_results")
      .insert({
        pack_id,
        participant_name,
        score: 0,
        status: "In Progress",
        answers: {},
      })
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    console.error("Error starting exam:", error);
    res.status(500).json({ error: "Failed to start exam" });
  }
});

// Submit exam answers
app.post("/api/exam/submit", async (req, res) => {
  try {
    const { pack_id, participant_name, answers } = req.body;

    const { data: packData, error: packError } = await supabase
      .from("question_packs")
      .select("passing_grade")
      .eq("id", pack_id)
      .single();
    if (packError) throw packError;

    const { data: packQuestions, error: questionsError } = await supabase
      .from("pack_questions")
      .select("questions(*)")
      .eq("pack_id", pack_id);
    if (questionsError) throw questionsError;

    let correctAnswers = 0;
    const questions = packQuestions.map((item) => item.questions);
    questions.forEach((q) => {
      if (answers[q.id] === q.correct_answer) correctAnswers++;
    });

    const score = correctAnswers * 5;
    const status =
      score >= packData.passing_grade ? "Lulus PG" : "Tidak Lulus PG";

    const { data, error } = await supabase
      .from("exam_results")
      .insert({ pack_id, participant_name, score, status, answers })
      .select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    console.error("Error submitting exam:", error);
    res.status(500).json({ error: "Failed to submit exam" });
  }
});

// Get exam results
app.get("/api/exam/:id/results", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("exam_results")
      .select("*, question_packs(*)")
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error fetching exam results:", error);
    res.status(500).json({ error: "Failed to fetch exam results" });
  }
});

// Get scoreboard
app.get("/api/scoreboard", async (req, res) => {
  try {
    const { pack_id } = req.query;
    const { data, error } = await supabase
      .from("exam_results")
      .select("participant_name, score, status")
      .eq("pack_id", pack_id)
      .order("score", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error fetching scoreboard:", error);
    res.status(500).json({ error: "Failed to fetch scoreboard" });
  }
});

// Update a question
app.put("/api/questions/:id", async (req, res) => {
  try {
    const {
      content,
      question_type,
      options,
      correct_answer,
      explanation,
      image,
      image_url: existingUrl,
      explanation_image,
      explanation_image_url: existingExplanationUrl,
    } = req.body;
    let image_url = existingUrl || null;
    if (image && image.startsWith("data:")) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const { url } = await put(`questions/${Date.now()}.png`, buffer, {
        access: "public",
      });
      image_url = url;
    }
    let explanation_image_url = existingExplanationUrl || null;
    if (explanation_image && explanation_image.startsWith("data:")) {
      const base64Data = explanation_image.replace(
        /^data:image\/\w+;base64,/,
        "",
      );
      const buffer = Buffer.from(base64Data, "base64");
      const { url } = await put(`explanations/${Date.now()}.png`, buffer, {
        access: "public",
      });
      explanation_image_url = url;
    }
    const { data, error } = await supabase
      .from("questions")
      .update({
        content,
        question_type,
        options,
        correct_answer,
        explanation,
        image_url,
        explanation_image_url,
      })
      .eq("id", req.params.id)
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error("Error updating question:", error);
    res.status(500).json({ error: "Failed to update question" });
  }
});

// Check if question is used in packs
app.get("/api/questions/:id/usage", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("pack_questions")
      .select("question_packs(name)")
      .eq("question_id", req.params.id);
    if (error) throw error;
    const packNames = data
      .map((item) => item.question_packs?.name)
      .filter(Boolean);
    res.json({ used: packNames.length > 0, packs: packNames });
  } catch (error) {
    console.error("Error checking question usage:", error);
    res.status(500).json({ error: "Failed to check usage" });
  }
});

// Delete a question
app.delete("/api/questions/:id", async (req, res) => {
  try {
    const { error: relError } = await supabase
      .from("pack_questions")
      .delete()
      .eq("question_id", req.params.id);
    if (relError) throw relError;

    const { error } = await supabase
      .from("questions")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting question:", error);
    res.status(500).json({ error: "Failed to delete question" });
  }
});

// Update a pack
app.put("/api/packs/:id", async (req, res) => {
  try {
    const { name, duration_minutes, passing_grade } = req.body;
    const { data, error } = await supabase
      .from("question_packs")
      .update({ name, duration_minutes, passing_grade })
      .eq("id", req.params.id)
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error("Error updating pack:", error);
    res.status(500).json({ error: "Failed to update pack" });
  }
});

// Delete a pack
app.delete("/api/packs/:id", async (req, res) => {
  try {
    // Delete related exam results first
    const { error: resError } = await supabase
      .from("exam_results")
      .delete()
      .eq("pack_id", req.params.id);
    if (resError) throw resError;

    // Delete pack questions relations
    const { error: pqError } = await supabase
      .from("pack_questions")
      .delete()
      .eq("pack_id", req.params.id);
    if (pqError) throw pqError;

    // Delete pack
    const { error } = await supabase
      .from("question_packs")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting pack:", error);
    res.status(500).json({ error: "Gagal menghapus paket soal" });
  }
});

// Remove a question from a pack
app.delete("/api/packs/:packId/questions/:questionId", async (req, res) => {
  try {
    const { error } = await supabase
      .from("pack_questions")
      .delete()
      .eq("pack_id", req.params.packId)
      .eq("question_id", req.params.questionId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error("Error removing question from pack:", error);
    res.status(500).json({ error: "Failed to remove question from pack" });
  }
});

// Update question order in a pack (bulk)
app.put("/api/packs/:id/questions", async (req, res) => {
  try {
    const { questions } = req.body; // [{question_id, question_number}]
    const packId = req.params.id;
    // Delete all existing and re-insert
    const { error: delError } = await supabase
      .from("pack_questions")
      .delete()
      .eq("pack_id", packId);
    if (delError) throw delError;
    if (questions.length > 0) {
      const rows = questions.map((q) => ({
        pack_id: packId,
        question_id: q.question_id,
        question_number: q.question_number,
      }));
      const { error: insError } = await supabase
        .from("pack_questions")
        .insert(rows);
      if (insError) throw insError;
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error updating pack questions order:", error);
    res.status(500).json({ error: "Failed to update order" });
  }
});

// Get scoreboard - enhanced with optional pack_id filter and created_at
app.get("/api/scoreboard-all", async (req, res) => {
  try {
    let query = supabase
      .from("exam_results")
      .select(
        "participant_name, score, status, created_at, pack_id, question_packs(name)",
      )
      .order("score", { ascending: false });
    const { pack_id } = req.query;
    if (pack_id) query = query.eq("pack_id", pack_id);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error fetching scoreboard:", error);
    res.status(500).json({ error: "Failed to fetch scoreboard" });
  }
});

// --- Static files (AFTER API routes) ---
app.use(express.static(join(__dirname, "..", "public")));

// Export for Vercel serverless
export default app;
