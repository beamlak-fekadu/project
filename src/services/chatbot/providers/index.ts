import { type ChatLlmProvider, type ChatProviderName } from '@/types/chatbot';
import { geminiProvider } from './gemini-provider';

const PROVIDERS: Record<ChatProviderName, ChatLlmProvider> = {
  gemini: geminiProvider,
};

function resolveProviderName() {
  const configured = (process.env.AI_PROVIDER ?? 'gemini').toLowerCase();
  if (configured !== 'gemini') {
    throw new Error(`Unsupported AI_PROVIDER "${configured}". This deployment only registers the gemini provider.`);
  }
  return 'gemini';
}

export function getChatProvider(): ChatLlmProvider {
  const providerName = resolveProviderName();
  return PROVIDERS[providerName as ChatProviderName];
}
