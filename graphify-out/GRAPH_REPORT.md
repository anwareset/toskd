# Graph Report - toskd  (2026-08-16)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 583 nodes · 832 edges · 48 communities (44 shown, 4 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `132956e8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- server.js
- paket-soal.js
- image-uploader.js
- paket-detail.js
- kelola-soal.js
- scoreboard.js
- exam.js
- dependencies
- select-pack.js
- bulk-parser.js
- review.js
- package.json
- setupDragAndDrop
- applyBobotUiState
- test-pack-visibility.mjs
- renderBankList
- renderLists
- theme.js
- test-pack-question-order.mjs
- renderPreview
- test-otel-smoke.mjs
- renderTable
- markdown-image.js
- wrapFetch
- parseBulkInput
- schema.sql
- test-admin-auth-redirect.mjs
- test-health.mjs
- esc
- test-tkp-scoring.mjs
- vercel.json
- public.exam_results
- public.pack_questions
- public.question_packs
- public.questions

## God Nodes (most connected - your core abstractions)
1. `reapplyView()` - 13 edges
2. `parseBlock()` - 12 edges
3. `renderBankList()` - 9 edges
4. `rehostImage()` - 9 edges
5. `reapplyView()` - 8 edges
6. `applyBobotUiState()` - 8 edges
7. `renderLists()` - 8 edges
8. `main()` - 8 edges
9. `init()` - 8 edges
10. `init()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `expectedContent()` --calls--> `escapeHtml()`  [EXTRACTED]
  tests/test-bulk-parser.mjs → public/js/bulk-parser.js
- `buildUpdatedQuestion()` --calls--> `applyUrlReplacements()`  [EXTRACTED]
  scripts/migrate-images.mjs → public/js/image-uploader.js
- `collectUniqueUrls()` --calls--> `isRehostedUrl()`  [EXTRACTED]
  scripts/migrate-images.mjs → public/js/image-uploader.js
- `uploadImage()` --calls--> `isRehostedUrl()`  [EXTRACTED]
  scripts/migrate-images.mjs → public/js/image-uploader.js
- `collectUniqueUrls()` --calls--> `scanImageUrls()`  [EXTRACTED]
  scripts/migrate-images.mjs → public/js/image-uploader.js

## Import Cycles
- None detected.

## Communities (48 total, 4 thin omitted)

### Community 0 - "server.js"
Cohesion: 0.05
Nodes (46): createLogger(), errorField(), logger, REDACT_PATHS, activeServerSpan(), CRITICAL_ROUTES, CriticalRouteRatioSampler, currentTraceContext() (+38 more)

### Community 1 - "paket-soal.js"
Cohesion: 0.05
Nodes (50): bodyEl, comparator(), controlsBottomEl, controlsTopEl, CREATED_AT_EXTRACTOR(), DEFAULT_DIR, DEFAULT_SUBTEST_THRESHOLDS, defaultThresholdFor() (+42 more)

### Community 2 - "image-uploader.js"
Cohesion: 0.10
Nodes (33): applyUrlReplacements(), blobToDataUrl(), dataUrlToBlob(), downloadImage(), emitRehosted(), getBlobUrl(), idbAll(), idbDelete() (+25 more)

### Community 3 - "paket-detail.js"
Cohesion: 0.05
Nodes (39): addBtn, allQuestions, bankList, bankSelectAllCheckbox, bankSelectAllCheckboxBottom, bulkRemoveBtn, bulkRemoveConfirmCountEl, bulkRemoveConfirmModal (+31 more)

### Community 4 - "kelola-soal.js"
Cohesion: 0.05
Nodes (34): BOBOT_LETTERS, bodyEl, bulkDeleteBtn, bulkDeleteCancelBtn, bulkDeleteConfirmBtn, bulkDeleteConfirmModal, bulkModal, clearSelectionBtn (+26 more)

### Community 5 - "scoreboard.js"
Cohesion: 0.09
Nodes (34): allResults, bindNav(), bindRowsPerPage(), bindSearch(), bindSortHeaders(), bodyEl, checkAdmin(), comparator() (+26 more)

### Community 6 - "exam.js"
Cohesion: 0.09
Nodes (30): answers, buildGrid(), counterEl, endBtn, endExamCancelBtn, endExamConfirmBtn, endExamModal, gridEl (+22 more)

### Community 7 - "dependencies"
Cohesion: 0.07
Nodes (29): bcryptjs, dotenv, express, jsonwebtoken, @opentelemetry/api, @opentelemetry/instrumentation-express, @opentelemetry/instrumentation-http, @opentelemetry/instrumentation-undici (+21 more)

### Community 8 - "select-pack.js"
Cohesion: 0.11
Nodes (24): esc(), filterPacks(), getVisiblePacks(), gotoPage(), grid, loading, loadingStatus, loadPacks() (+16 more)

### Community 9 - "bulk-parser.js"
Cohesion: 0.19
Nodes (20): buildNewFormatContent(), enrichTkpBobot(), escapeHtml(), findExplicitOptionsIndex(), isLeadIn(), isQuestionLineEnd(), looksLikeQuestion(), parseBarePremiseNewFormatBlock() (+12 more)

### Community 10 - "review.js"
Cohesion: 0.13
Nodes (23): bodyEl, buildGrid(), computeBreakdowns(), contentEl, counterEl, esc(), explanationEl, gridEl (+15 more)

### Community 11 - "package.json"
Cohesion: 0.12
Nodes (15): author, description, devDependencies, pino-pretty, keywords, license, main, name (+7 more)

### Community 12 - "setupDragAndDrop"
Cohesion: 0.18
Nodes (15): applyDropAnim(), clearDropTargets(), handleDragEnd(), handleDragOver(), handleDragStart(), handleDrop(), isTouchDragDevice(), onPackItemPointerCancel() (+7 more)

### Community 13 - "applyBobotUiState"
Cohesion: 0.24
Nodes (11): applyBobotUiState(), deriveCorrectAnswerFromBobot(), initBulkHelpModeToggle(), initTkpListeners(), isTkpType(), readBobotValues(), setBobotFromQuestion(), setBulkHelpMode() (+3 more)

### Community 14 - "test-pack-visibility.mjs"
Cohesion: 0.20
Nodes (4): __dirname, __filename, SERVER_PATH, startMockPostgrest()

### Community 15 - "renderBankList"
Cohesion: 0.28
Nodes (9): esc(), formatIndonesianFull(), formatIndonesianRelative(), handleBankSelectAllChange(), openUsageModal(), renderBankList(), renderUsageChip(), updateAddButtonLabel() (+1 more)

### Community 16 - "renderLists"
Cohesion: 0.22
Nodes (9): fetchQuestionUsage(), handlePackSelectAllChange(), handleSessionExpired(), init(), renderLists(), showServerErrorToast(), typesetMath(), updatePackSelectionUI() (+1 more)

### Community 17 - "theme.js"
Cohesion: 0.28
Nodes (4): closeDrawer(), isMobile(), relayout(), unlockBodyScroll()

### Community 18 - "test-pack-question-order.mjs"
Cohesion: 0.22
Nodes (4): __dirname, __filename, SERVER_PATH, startMockPostgrest()

### Community 19 - "renderPreview"
Cohesion: 0.25
Nodes (8): initTabNavigation(), renderInlineMd(), renderPreview(), resetTabs(), scanSingleModalImages(), scheduleImageScan(), switchTab(), syncEditorsToTextareas()

### Community 20 - "test-otel-smoke.mjs"
Cohesion: 0.25
Nodes (4): __dirname, __filename, OTEL_PATH, SERVER_PATH

### Community 21 - "renderTable"
Cohesion: 0.33
Nodes (7): getFilteredQuestions(), handleBulkDeleteResponse(), init(), renderTable(), setupCheckboxDelegation(), showNotification(), updateSelectionUI()

### Community 22 - "markdown-image.js"
Cohesion: 0.43
Nodes (3): esc(), renderInlineMd(), renderInlinePreview()

### Community 23 - "wrapFetch"
Cohesion: 0.33
Nodes (6): bindPasteImageHandler(), handleSessionExpired(), imageHandler(), initQuillEditors(), showServerErrorToast(), wrapFetch()

### Community 24 - "parseBulkInput"
Cohesion: 0.40
Nodes (6): initBulkQuillEditor(), parseBulkInput(), scanBulkEditorImages(), scheduleBulkImageScan(), setBulkPreviewSummary(), updateBulkSummary()

### Community 25 - "schema.sql"
Cohesion: 0.53
Nodes (5): admins, exam_results, pack_questions, question_packs, questions

### Community 26 - "test-admin-auth-redirect.mjs"
Cohesion: 0.40
Nodes (3): __dirname, __filename, SERVER_PATH

### Community 27 - "test-health.mjs"
Cohesion: 0.40
Nodes (3): __dirname, __filename, SERVER_PATH

### Community 28 - "esc"
Cohesion: 0.67
Nodes (4): esc(), renderBulkPreview(), renderInlinePreview(), showBulkDeleteConfirmModal()

### Community 29 - "test-tkp-scoring.mjs"
Cohesion: 0.67
Nodes (3): cases, isTkp(), scoreForQuestion()

### Community 30 - "vercel.json"
Cohesion: 0.50
Nodes (3): builds, routes, version

## Knowledge Gaps
- **234 isolated node(s):** `CRITICAL_ROUTES`, `HTTP_DURATION_BUCKETS`, `otelEnabled`, `OTLP_ENDPOINT`, `SERVICE_NAME` (+229 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `CRITICAL_ROUTES`, `HTTP_DURATION_BUCKETS`, `otelEnabled` to the rest of the system?**
  _234 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05245901639344262 - nodes in this community are weakly interconnected._
- **Should `paket-soal.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05254901960784314 - nodes in this community are weakly interconnected._
- **Should `image-uploader.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09988385598141696 - nodes in this community are weakly interconnected._
- **Should `paket-detail.js` be split into smaller, more focused modules?**
  _Cohesion score 0.047619047619047616 - nodes in this community are weakly interconnected._
- **Should `kelola-soal.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05128205128205128 - nodes in this community are weakly interconnected._