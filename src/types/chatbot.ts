import { z } from 'zod';

export const CHAT_INTENTS = [
  'assistant_intro',
  'maintenance_tip',
  'troubleshooting',
  'work_order_help',
  'equipment_lookup',
  'analytics_explanation',
  'calibration_or_logistics',
  'too_detailed',
  'unsafe',
  'out_of_scope',
] as const;

export const CHAT_CAPABILITIES = [
  'assistant_intro',
  'my_tasks',
  'prioritize_tasks',
  'summarize_work_order',
  'summarize_equipment',
  'explain_equipment_risk',
  'explain_pm_status',
  'explain_replacement_priority',
  'safe_troubleshooting',
  'maintenance_tips',
  'maintenance_guidance',
  'logistics_status',
  'procurement_status',
  'pending_approvals',
  'approval_tasks',
  'alerts_and_escalations',
  'decision_support_analysis',
  'summarize_department_readiness',
  'training_status',
  'disposal_status',
  'general_fallback',
  'general_system_fallback',
] as const;

export const CHAT_DECISIONS = ['answer', 'limited_answer', 'check_manual', 'escalate', 'refuse'] as const;
export const ANSWER_BASIS = [
  'system_data',
  'system_capabilities',
  'manual_or_sop',
  'general_safe_guidance',
  'insufficient_data',
] as const;
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export const CHAT_PROVIDERS = ['gemini'] as const;
export const SAFETY_MODES = ['normal', 'strict', 'fallback'] as const;
export const RESPONSE_MODES = ['json', 'text'] as const;
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
export type ChatMessageRole = 'user' | 'assistant';
export type ChatModelMessageRole = 'system' | 'user' | 'assistant';
export type TroubleshootingSubtype =
  | 'safe_general_troubleshooting'
  | 'specific_technical_troubleshooting'
  | 'unsafe_internal_or_bypass_troubleshooting'
  | 'none';
export type RequestSpecificity = 'general' | 'specific' | 'unsafe';

export const ChatContextRefsSchema = z.object({
  equipmentId: z.string().uuid().optional(),
  workOrderId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  organizationUnitId: z.string().uuid().optional(),
});

export const ChatModuleContextSchema = z.object({
  moduleLabel: z.string().trim().min(1).max(80).optional(),
  pathname: z.string().trim().min(1).max(250).optional(),
  route: z.string().trim().max(250).optional(),
  pageLabel: z.string().trim().max(120).optional(),
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
});

export type ChatContextRefs = z.infer<typeof ChatContextRefsSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type AssistantContent = z.infer<typeof AssistantContentSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

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
}

export interface MemorySnapshot {
  sessionId: string;
  shortSummary: string;
  focus: string;
  threadIntent?: ChatIntent;
  activeCapability?: CapabilityId;
  recentTurns: Array<{ role: ChatMessageRole; content: string }>;
  lastEntities: ResolvedEntity[];
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
}

export interface ChatModuleContext {
  moduleLabel?: string;
  pathname?: string;
  route?: string;
  pageLabel?: string;
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
