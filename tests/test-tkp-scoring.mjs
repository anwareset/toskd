// Verifies scoreForQuestion handles: TWK binary, TKP weighted, TKP legacy
// null/empty option_scores (binary fallback per spec §11.2), and lowercase
// `ans` normalization. Mirrors the implementation in src/server.js.
function isTkp(question) {
  return typeof question?.question_type === "string"
    && question.question_type.toUpperCase().startsWith("TKP");
}
function scoreForQuestion(q, ans) {
  const upperAns = typeof ans === "string" ? ans.toUpperCase().trim() : ans;
  if (!isTkp(q)) {
    return upperAns && upperAns === q.correct_answer ? 5 : 0;
  }
  if (
    q.option_scores == null ||
    typeof q.option_scores !== "object" ||
    Object.keys(q.option_scores).length === 0
  ) {
    return upperAns && upperAns === q.correct_answer ? 5 : 0;
  }
  if (!upperAns) return 0;
  return Number(q.option_scores[upperAns] || 0);
}

const cases = [
  // TWK binary (also exercises ans uppercase normalization in the equality branch)
  { q: { question_type: "TWK Pilar Negara", correct_answer: "A" }, ans: "A", want: 5, label: "TWK hit (uppercase)" },
  { q: { question_type: "TWK Pilar Negara", correct_answer: "A" }, ans: "a", want: 5, label: "TWK hit (lowercase ans)" },
  { q: { question_type: "TWK Pilar Negara", correct_answer: "A" }, ans: "B", want: 0, label: "TWK miss" },
  { q: { question_type: "TWK Pilar Negara", correct_answer: "A" }, ans: "b", want: 0, label: "TWK miss (lowercase ans)" },
  { q: { question_type: "TWK Pilar Negara", correct_answer: "A" }, ans: null, want: 0, label: "TWK skip" },
  // TKP weighted when option_scores is valid
  { q: { question_type: "TKP Pelayanan Publik", correct_answer: "C", option_scores: {A:2,B:1,C:5,D:3,E:4} }, ans: "C", want: 5, label: "TKP weighted hit (C=5)" },
  { q: { question_type: "TKP Pelayanan Publik", correct_answer: "C", option_scores: {A:2,B:1,C:5,D:3,E:4} }, ans: "A", want: 2, label: "TKP weighted partial (A=2)" },
  { q: { question_type: "TKP Pelayanan Publik", correct_answer: "C", option_scores: {A:2,B:1,C:5,D:3,E:4} }, ans: "a", want: 2, label: "TKP weighted lowercase ans (a\u21922)" },
  { q: { question_type: "TKP Pelayanan Publik", correct_answer: "C", option_scores: {A:2,B:1,C:5,D:3,E:4} }, ans: "B", want: 1, label: "TKP weighted smallest (B=1)" },
  { q: { question_type: "TKP Pelayanan Publik", correct_answer: "C", option_scores: {A:2,B:1,C:5,D:3,E:4} }, ans: null, want: 0, label: "TKP skip" },
  // LEGACY FALLBACK (spec §11.2): null option_scores → binary (now also uppercases ans!)
  { q: { question_type: "TKP Pelayanan Publik", correct_answer: "C", option_scores: null }, ans: "C", want: 5, label: "TKP legacy null → hit=5" },
  { q: { question_type: "TKP Pelayanan Publik", correct_answer: "C", option_scores: null }, ans: "c", want: 5, label: "TKP legacy null lowercase → hit=5 (CASE FIX)" },
  { q: { question_type: "TKP Pelayanan Publik", correct_answer: "C", option_scores: null }, ans: "A", want: 0, label: "TKP legacy null → miss=0" },
  { q: { question_type: "TKP Pelayanan Publik", correct_answer: "C", option_scores: null }, ans: null, want: 0, label: "TKP legacy null → skip=0" },
  // Defensive: empty object → binary fallback
  { q: { question_type: "TKP Pelayanan Publik", correct_answer: "C", option_scores: {} }, ans: "C", want: 5, label: "TKP empty-object → hit=5" },
  { q: { question_type: "TKP Pelayanan Publik", correct_answer: "C", option_scores: {} }, ans: "A", want: 0, label: "TKP empty-object → miss=0" },
];

let ok = 0, fail = 0;
for (const c of cases) {
  const got = scoreForQuestion(c.q, c.ans);
  const pass = got === c.want;
  console.log((pass ? "PASS" : "FAIL") + " :: " + c.label + " :: expected=" + c.want + " got=" + got);
  pass ? ok++ : fail++;
}
console.log("=== Total: " + ok + " passed, " + fail + " failed ===");
process.exit(fail === 0 ? 0 : 1);
