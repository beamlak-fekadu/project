import { z } from 'zod';
import { CopilotActionDraftSchema, type CopilotActionDraft } from './copilot-actions';

export const CHAT_INTENTS = [
  'assistant_intro',
  'general_conversation',
  'off_topic_safe',
  'general_help',
  'workflow_help',
  'maintenance_tip',
  'troubleshooting',
  'safe_troubleshooting',
  'work_order_help',
  'work_order_status',
  'maintenance_status',
  'asset_summary',
  'inventory_search',
  'equipment_lookup',
  'equipment_history',
  'analytics_explanation',
  'risk_analysis',
  'reliability_metrics',
  'replacement_priority',
  'dashboard_summary',
  'decision_support',
  'preventive_maintenance',
  'calibration_status',
  'spare_parts_lookup',
  'logistics_stock',
  'procurement_status',
  'training_status',
  'disposal_status',
  'report_help',
  'calibration_or_logistics',
  'too_detailed',
  'unsafe',
  'unsafe_request',
  'out_of_scope',
  'insufficient_context',
] as const;

export const CHAT_CAPABILITIES = [
  'assistant_intro',
  'general_conversation',
  'off_topic_safe',
  'my_tasks',
  'prioritize_tasks',
  'summarize_work_order',
  'summarize_equipment',
  'explain_equipment_risk',
  'explain_pm_status',
  'summarize_alerts',
  'safe_troubleshooting',
  'maintenance_tips',
  'logistics_status',
  'procurement_status',
  'summarize_department_readiness',
  'training_status',
  'disposal_status',
  'qr_asset_context',
  'offline_sync_status',
  'report_summary',
  'metric_debug',
  'copilot_diagnostics',
  'usage_status',
  'unsafe_or_restricted',
  'general_system_fallback',
] as const;

export const CHAT_DECISIONS = ['answer', 'limited_answer', 'check_manual', 'escalate', 'refuse'] as const;
export const ANSWER_BASIS = [
  'system_data',
  'system_capabilities',
  'manual_or_sop',
  'general_safe_guidance',
  'insufficient_data',
  'model_output',
  'format_recovery',
] as const;
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export const CHAT_PROVIDERS = ['gemini'] as const;
export const SAFETY_MODES = ['normal', 'strict', 'fallback'] as const;
export const RESPONSE_MODES = ['local', 'text', 'structured'] as const;
export const RESOLUTION_SOURCES = ['explicit_context', 'module_context', 'memory_context', 'text_match', 'none'] as const;
export const ENTITY_TYPES = ['equipment', 'work_order', 'department', 'part'] as const;
export const FALLBACK_REASONS = [
  'no_capability_match',
  'low_confidence_match',
  'insufficient_context',
  'insufficient_permissions',
  'provider_failure',
  'unsafe_query',
  'out_of_scope',
] as const;

export const COPILOT_PARSER_STRATEGIES = [
  'provider_failure',
  'assistant_object',
  'strict_json',
  'json_candidate',
  'markdown_fenced_json',
  'extracted_json',
  'balanced_json',
  'lenient_repaired_json',
  'plain_text_wrapped',
  'empty_content',
  'format_recovery',
] as const;

export type ChatIntent = (typeof CHAT_INTENTS)[number];
export type CapabilityId = (typeof CHAT_CAPABILITIES)[number];
export type ChatDecision = (typeof CHAT_DECISIONS)[number];
export type AnswerBasis = (typeof ANSWER_BASIS)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export type ChatProviderName = (typeof CHAT_PROVIDERS)[number];
export type SafetyMode = (typeof SAFETY_MODES)[number];
export type ResponseMode = (typeof RESPONSE_MODES)[number];
export type ResolutionSource = (typeof RESOLUTION_SOURCES)[number];
export type EntityType = (typeof ENTITY_TYPES)[number];
export type FallbackReason = (typeof FALLBACK_REASONS)[number];
export type CopilotParserStrategy = (typeof COPILOT_PARSER_STRATEGIES)[number];
export type ChatMessageRole = 'user' | 'assistant';
export type ChatModelMessageRole = 'system' | 'user' | 'assistant';
export type EvidenceCompletenessStatus = 'complete' | 'partial' | 'insufficient' | 'denied' | 'unknown';
export type EvidenceSourceCoverageKey =
  | 'explicit_context'
  | 'page_context'
  | 'memory_context'
  | 'text_match'
  | 'formal_tool'
  | 'snapshot'
  | 'manual_or_sop';
export type TroubleshootingSubtype =
  | 'safe_general_troubleshooting'
  | 'specific_technical_troubleshooting'
  | 'unsafe_internal_or_bypass_troubleshooting'
  | 'none';
export type RequestSpecificity = 'general' | 'specific' | 'unsafe';

const ChatRecordIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(36)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const ChatContextRefsSchema = z.object({
  equipmentId: ChatRecordIdSchema.optional(),
  workOrderId: ChatRecordIdSchema.optional(),
  departmentId: ChatRecordIdSchema.optional(),
  organizationUnitId: ChatRecordIdSchema.optional(),
});

export const ChatModuleContextSchema = z.object({
  moduleLabel: z.string().trim().min(1).max(80).optional(),
  pathname: z.string().trim().min(1).max(250).optional(),
  route: z.string().trim().max(250).optional(),
  pageLabel: z.string().trim().max(120).optional(),
  activeTab: z.string().trim().max(80).optional(),
  searchQuery: z.string().trim().max(120).optional(),
  selectedRecordType: z.string().trim().max(80).optional(),
  selectedRecordId: z.string().trim().max(120).optional(),
  selectedRecordLabel: z.string().trim().max(160).optional(),
  reportType: z.string().trim().max(80).optional(),
  qrToken: z.string().trim().max(160).optional(),
  offlineStatus: z.enum(['online', 'offline', 'unknown']).optional(),
  queueStatus: z.object({
    queued: z.number().int().nonnegative().optional(),
    failed: z.number().int().nonnegative().optional(),
    conflict: z.number().int().nonnegative().optional(),
    lastSyncedAt: z.string().trim().max(80).nullable().optional(),
  }).optional(),
  pageSummary: z.string().trim().max(500).optional(),
  roleHints: z.array(z.string().trim().max(120)).max(8).optional(),
  selectedEntityLabels: z.array(z.string().trim().max(120)).max(8).optional(),
  availableActions: z.array(z.string().trim().max(120)).max(12).optional(),
  pageDataHints: z.array(z.string().trim().max(160)).max(12).optional(),
  visibleCounts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  availableEvidenceLinks: z.array(z.object({
    label: z.string().trim().max(120),
    href: z.string().trim().max(250),
    type: z.string().trim().max(60).optional(),
  })).max(10).optional(),
  currentFilters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export const ChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  sessionId: z.string().uuid().optional(),
  contextRefs: ChatContextRefsSchema.optional(),
  moduleContext: ChatModuleContextSchema.optional(),
});

export const AssistantContentSchema = z.object({
  decision: z.enum(CHAT_DECISIONS),
  title: z.string().max(180).optional(),
  intelligence_mode: z.enum(['standard', 'troubleshooting', 'prioritization', 'synthesis']).optional(),
  summary: z.string().max(2000),
  key_findings: z.array(z.string().max(400)).max(10).default([]),
  recommended_actions: z.array(z.string().max(400)).max(10).default([]),
  priority_reasoning: z.array(z.string().max(400)).max(10).default([]),
  likely_causes: z.array(z.string().max(300)).max(8).default([]),
  troubleshooting_steps: z.array(z.string().max(400)).max(10).default([]),
  maintenance_tips: z.array(z.string().max(400)).max(10).default([]),
  required_tools_or_parts: z.array(z.string().max(200)).max(10).default([]),
  escalation_recommendation: z.string().max(600).optional(),
  reason_for_limit: z.string().max(600).optional(),
  answer_basis: z.enum(ANSWER_BASIS),
  confidence: z.enum(CONFIDENCE_LEVELS),
  escalation_required: z.boolean().default(false),
  actions: z.array(z.string().max(400)).max(10).default([]),
  insights: z.array(z.string().max(400)).max(10).default([]),
  recommendations: z.array(z.string().max(400)).max(10).default([]),
  escalation_guidance: z.string().max(600).optional(),
  entities_referenced: z.array(z.string().max(160)).max(12).default([]),
  follow_up_suggestions: z.array(z.string().max(240)).max(8).default([]),
  proactive_signals: z.array(z.string().max(400)).max(8).default([]),
  routing_explanation: z.array(z.string().max(320)).max(8).default([]),
  evidence_used: z.array(z.string().max(320)).max(12).default([]),
  links: z.array(z.object({
    label: z.string().max(120),
    href: z.string().max(250),
    type: z.string().max(60).optional(),
  })).max(10).default([]),
  limitations: z.array(z.string().max(320)).max(8).default([]),
  missingDataFlags: z.array(z.string().max(120)).max(12).default([]),
  data_freshness: z.string().max(200).optional(),
  source_tables: z.array(z.string().max(120)).max(12).default([]),
  /**
   * Structured data lineage tag — one of "live", "snapshot", "stale",
   * "sandbox", "missing", "unknown". Used by the UI and tests to consistently
   * surface honesty about whether a number is current, a stored snapshot, a
   * developer-only simulation, or absent.
   */
  data_mode: z.enum(['live', 'snapshot', 'stale', 'sandbox', 'missing', 'unknown']).optional(),
  /** Optional explicit age label, e.g. "computed 38m ago". */
  data_age_label: z.string().max(120).optional(),
  action_drafts: z.array(CopilotActionDraftSchema).max(6).default([]),
});

export const ChatResponseSchema = z.object({
  sessionId: z.string().uuid(),
  intent: z.enum(CHAT_INTENTS),
  capability: z.enum(CHAT_CAPABILITIES).optional(),
  decision: z.enum(CHAT_DECISIONS),
  blocked: z.boolean(),
  confidenceScore: z.number().min(0).max(1).optional(),
  fallbackReason: z.enum(FALLBACK_REASONS).optional(),
  assistant: AssistantContentSchema,
  usageStatus: z.object({
    requestsToday: z.number().int().nonnegative(),
    tokensToday: z.number().int().nonnegative(),
    usageSource: z.enum(['provider_reported', 'estimated', 'mixed', 'none']),
    dailyRequestLimit: z.number().int().positive().nullable(),
    dailyTokenLimit: z.number().int().positive().nullable(),
    warning: z.string().nullable(),
    hardLimited: z.boolean(),
  }).optional(),
  _debug: z.record(z.string(), z.unknown()).optional(),
});

export type ChatContextRefs = z.infer<typeof ChatContextRefsSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type AssistantContent = z.infer<typeof AssistantContentSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type { CopilotActionDraft };

export interface MemoryRoutingHint {
  activeCapability?: CapabilityId;
  threadIntent?: ChatIntent;
}

export interface ClassifiedRequest {
  intent: ChatIntent;
  capability: CapabilityId;
  reasons: string[];
  troubleshootingSubtype: TroubleshootingSubtype;
  specificity: RequestSpecificity;
  matchedSignals: string[];
  confidence: number;
  confidenceLabel: ConfidenceLevel;
  ambiguous: boolean;
  fallbackReason?: FallbackReason;
  candidates: CapabilityMatch[];
}

export interface UserChatProfile {
  profileId: string;
  userId?: string;
  displayName?: string;
  roleNames: string[];
  departmentId: string | null;
  departmentName?: string | null;
  organizationUnitId?: string | null;
  permissions?: string[];
}

export interface ChatEvidence {
  equipment: Record<string, unknown> | null;
  workOrder: Record<string, unknown> | null;
  department: Record<string, unknown> | null;
  maintenanceHistory: Record<string, unknown>[];
  openWorkOrders?: Record<string, unknown>[];
  maintenanceRequests?: Record<string, unknown>[];
  pmSnapshot: Record<string, unknown> | null;
  calibrationStatus: Record<string, unknown> | null;
  logisticsSnapshot: Record<string, unknown> | null;
  analyticsSnapshot: Record<string, unknown> | null;
  manualOrSopTexts: string[];
  documentRetrieval: {
    notImplemented: boolean;
    searchDocuments: Array<{ id?: string; title: string; snippet?: string }>;
    forEquipment: Array<{ id?: string; title: string; snippet?: string }>;
    forCategory: Array<{ id?: string; title: string; snippet?: string }>;
  };
  missingDataFlags: string[];
  evidenceCompleteness?: {
    status: EvidenceCompletenessStatus;
    score: number;
    requiredPresent: string[];
    requiredMissing: string[];
    optionalMissing: string[];
    staleSignals: string[];
    conflictSignals: string[];
    sourceCoverage: Record<EvidenceSourceCoverageKey, boolean>;
  };
  evidenceSignals: string[];
  deniedContextRefs: Array<'equipment' | 'work_order' | 'department'>;
  accessDenied: boolean;
}

export interface CapabilityMatch {
  capability: CapabilityId;
  confidence: number;
  reasons: string[];
}

export interface ResolvedEntity {
  type: EntityType;
  id: string;
  label: string;
  source: ResolutionSource;
  confidence?: number;
  freshness?: 'current' | 'recent' | 'stale' | 'unknown';
  conflictReason?: string;
}

export interface MemorySnapshot {
  sessionId: string;
  shortSummary: string;
  focus: string;
  threadIntent?: ChatIntent;
  activeCapability?: CapabilityId;
  recentTurns: Array<{ role: ChatMessageRole; content: string }>;
  lastEntities: ResolvedEntity[];
  lastEvidenceUsed?: string[];
  lastSourceTables?: string[];
  lastDataFreshness?: string;
  lastDataMode?: AssistantContent['data_mode'];
  lastAnswerBasis?: AssistantContent['answer_basis'];
  lastEvidenceCompleteness?: ChatEvidence['evidenceCompleteness'];
  memoryConfidence?: 'high' | 'medium' | 'low';
  memoryAgeTurns?: number;
  lastTurnAt?: string;
}

export interface TaskContextBundle {
  capability: CapabilityId;
  blocks: Record<string, unknown>;
  evidence: ChatEvidence;
}

export interface OrchestratorContext {
  message: string;
  profile: UserChatProfile;
  sessionId: string;
  contextRefs?: ChatContextRefs;
  moduleContext?: ChatModuleContext;
  safetyMode: SafetyMode;
}

export interface SafetyEvaluation {
  decision: ChatDecision;
  blocked: boolean;
  answerBasis: AnswerBasis;
  confidence: ConfidenceLevel;
  reason: string;
  escalationRequired: boolean;
  evidenceTier: 'high' | 'medium' | 'low';
  policyCategory: 'general_operational' | 'specific_technical' | 'unsafe_or_out_of_scope';
  /** Optional alternative path to suggest after a refusal. */
  policyAlternative?: string;
  /** Optional safe first-line checks to include with unsafe refusals. */
  safeChecks?: string[];
  /** Optional structured tag for downstream telemetry/debug. */
  policyTags?: string[];
}

export interface TelemetryEvent {
  sessionId: string;
  query: string;
  intent: ChatIntent;
  capability: CapabilityId;
  confidenceScore: number;
  confidenceLabel: ConfidenceLevel;
  decision: ChatDecision;
  blocked: boolean;
  fallbackReason?: FallbackReason;
  roleNames: string[];
  moduleLabel?: string;
  route?: string;
  evidenceSignals: string[];
  groundedBy?: 'live_data' | 'memory' | 'general_fallback' | 'mixed';
  parsingRecoveryUsed?: boolean;
  classifierCandidates?: CapabilityMatch[];
  resolvedEntities?: ResolvedEntity[];
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}

export interface CopilotParserMetadata {
  parserStrategy: CopilotParserStrategy;
  parserRecoveryUsed: boolean;
  parserFailureReason?: string | null;
  rawContentLength: number;
  structuredValidationPassed: boolean;
  deterministicFallbackUsed: boolean;
  responseMode: ResponseMode;
  candidateCount?: number;
  rawPreview?: string;
}

export interface OrchestratorResult {
  intent: ChatIntent;
  capability: CapabilityId;
  confidenceScore: number;
  confidenceLabel: ConfidenceLevel;
  decision: ChatDecision;
  blocked: boolean;
  fallbackReason?: FallbackReason;
  assistant: AssistantContent;
  evidence: ChatEvidence;
  classified: ClassifiedRequest;
  memory?: MemorySnapshot;
  resolvedEntities: ResolvedEntity[];
  provider?: ChatProviderName;
  model?: string;
  providerMetadata?: Record<string, unknown>;
  policyReason?: string;
  debugMetadata?: Record<string, unknown>;
}

export interface ChatModuleContext {
  moduleLabel?: string;
  pathname?: string;
  route?: string;
  pageLabel?: string;
  activeTab?: string;
  searchQuery?: string;
  selectedRecordType?: string;
  selectedRecordId?: string;
  selectedRecordLabel?: string;
  reportType?: string;
  qrToken?: string;
  offlineStatus?: 'online' | 'offline' | 'unknown';
  queueStatus?: {
    queued?: number;
    failed?: number;
    conflict?: number;
    lastSyncedAt?: string | null;
  };
  pageSummary?: string;
  roleHints?: string[];
  selectedEntityLabels?: string[];
  availableActions?: string[];
  pageDataHints?: string[];
  visibleCounts?: Record<string, string | number | boolean | null>;
  availableEvidenceLinks?: Array<{ label: string; href: string; type?: string }>;
  currentFilters?: Record<string, string | number | boolean | null>;
}

export interface ChatModelMessage {
  role: ChatModelMessageRole;
  content: string;
}

export interface LlmGenerateParams {
  messages: ChatModelMessage[];
  requiredDecision: ChatDecision;
  intent: ChatIntent;
  responseMode?: ResponseMode;
  capability?: CapabilityId;
}

export interface LlmProviderResult {
  assistant: AssistantContent;
  provider: ChatProviderName;
  model: string;
  providerMetadata?: Record<string, unknown>;
}

export interface ChatLlmProvider {
  name: ChatProviderName;
  generate(params: LlmGenerateParams): Promise<LlmProviderResult>;
}
