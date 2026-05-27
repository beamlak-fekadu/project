# 01 — Copilot Pipeline Map

## End-to-End Flow: User Message → Rendered Response

### 1. UI Entry Points

| Entry Point | Component | How It Works |
|---|---|---|
| Ask AI Button | `src/components/assistant/AskAiButton.tsx` | Passes `seedPrompt`, `contextRefs`, `moduleLabel` to `openAssistant()` |
| Global Launcher | `src/components/assistant/AssistantPanel.tsx` | Slide-out panel with input, quick prompts by module/role |
| Chatbot Page | `src/app/(dashboard)/chatbot/page.tsx` | Full-page chatbot interface |
| Page Context Bridge | `src/components/assistant/AssistantPageContextBridge.tsx` | Auto-injects route, module, selected record into assistant provider |
| Developer Lab | `src/app/(dashboard)/developer-lab/CopilotDiagnosticsClient.tsx` | Developer diagnostics and smoke test |
| Quick Prompts | `AssistantPanel.tsx` lines 22-100 | `QUICK_PROMPTS_BY_MODULE` and `QUICK_PROMPTS_BY_ROLE` |

### 2. Request Path

```
User types message
    ↓
AssistantProvider.sendMessage()
    ↓
chat-client.service.ts → POST /api/chat
    ↓
src/app/api/chat/route.ts
    ├── getUserChatProfile()  → profiles + user_roles + departments
    ├── ChatRequestSchema.safeParse(body)
    ├── ensureChatSession()  → chat_sessions table
    ├── insertChatMessage(role: 'user')
    ↓
orchestrateAssistantResponse()  [assistant-orchestrator.ts]
    ├── 1. loadConversationMemory()
    ├── 2. classifyChatRequest()     → intent + capability + confidence
    ├── 3. withPageAwareCapability() → page-context override of capability
    ├── 4. resolveEntitiesDetailed() → equipment/WO/dept entities
    ├── 5. buildTaskContext()
    │       ├── buildChatEvidence()    → Supabase queries
    │       ├── loadTaskBlocks()       → shared operational data
    │       ├── loadRiskAndAnalytics() → risk/reliability/replacement
    │       ├── loadLogistics()        → stock/procurement
    │       ├── loadDecisionSupportSnapshot()
    │       ├── planToolRetrieval()    → legacy tool plan
    │       ├── planFormalTools()      → formal tool plan
    │       └── executeCopilotTool()   → run formal tools
    ├── 6. evaluateSafetyDecision()  → answer/limited/check_manual/escalate/refuse
    ├── 7. [IF BLOCKED] → buildBlockedAssistantContent() → return
    ├── 8. buildDeterministicAnswerCandidate()
    ├── 9. shouldUseProvider()       → skip Gemini for local/intro/diagnostics
    ├── 10. buildPromptPayload()     → system prompt + user prompt + grounding context
    ├── 11. generateAssistantContent() → Gemini API call
    ├── 12. normalizeAssistantResponse() → parse JSON / recover
    ├── 13. enrichAssistantPayload() → merge proactive signals, links, etc.
    ├── 14. enforceOffTopicRedirect()
    ├── 15. [IF PARSER RECOVERY + CONTEXT] → use deterministic fallback
    ├── 16. applyResponseUsefulnessGuard() → replace generic with deterministic
    ├── 17. verifyAssistantClaimsAgainstEvidence()
    ├── 18. buildActionDraftsFromContext()
    ├── 19. ensureUiSafeAssistant()
    ├── 20. logCopilotTelemetry()
    ├── 21. logCopilotUsageEvent()
    └── 22. persistConversationMemory()
    ↓
insertChatMessage(role: 'assistant')
    ↓
ChatResponseSchema.parse() → JSON response
    ↓
AssistantProvider receives response
    ↓
AssistantMessageCard renders structured sections
```

### 3. Where Key Decisions Are Made

| Decision | File | Function | Line(s) |
|---|---|---|---|
| **User intent** | `classifier-service.ts` | `classifyChatRequest()` | 592-825 |
| **Selected capability** | `classifier-service.ts` | `INTENT_TO_CAPABILITY` map + `CAPABILITY_KEYWORDS` scoring | 318-580 |
| **Page-aware override** | `assistant-orchestrator.ts` | `derivePageAwareCapability()` | 68-123 |
| **Response mode** | `capability-registry.ts` | `CapabilityDefinition.responseMode` | per capability |
| **Safety decision** | `safety-service.ts` | `evaluateSafetyDecision()` | 119-422 |
| **Context/data loaded** | `task-context-service.ts` | `buildTaskContext()` | 308-447 |
| **Final prompt** | `prompt-service.ts` | `buildPromptPayload()` | 121-295 |
| **Final response format** | `assistant-response-pipeline.ts` | `normalizeAssistantResponse()` | 390-512 |
| **Usefulness gate** | `response-usefulness-guard.ts` | `applyResponseUsefulnessGuard()` | 85-113 |
| **Claim verification** | `claim-verification.ts` | `verifyAssistantClaimsAgainstEvidence()` | — |

### 4. Failure Modes

| Step | Failure | Effect |
|---|---|---|
| Classifier | Broad regex matches troubleshooting for status/summary queries | Wrong capability selected |
| Classifier | Default fallback is `maintenance_tip` | Non-maintenance queries get maintenance framing |
| Safety | `troubleshooting` intent always gets `limited_answer` | Even evidence-backed troubleshooting is constrained |
| Context | `logisticsSnapshot` only loads for `calibration_or_logistics` intent | Other intents miss stock data |
| Context | `analyticsSnapshot` only loads for `analytics_explanation` or when `equipmentId` present | Summary queries without explicit asset miss analytics |
| Prompt | Global system prompt says "For troubleshooting, provide safe first-line checks only" | Bleeds into non-troubleshooting responses |
| Provider | Gemini returns malformed JSON | Parser recovery drops structured data |
| Provider | Gemini echoes safety instructions as the answer body | Summary becomes troubleshooting boilerplate |
| Usefulness guard | `looksGeneric()` heuristics miss some generic patterns | Generic LLM output reaches the user |
