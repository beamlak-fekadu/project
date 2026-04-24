import type { ChatEvidence } from '@/types/chatbot';
import { buildTier1TroubleshootingBundle } from '../troubleshooting-context';

export function getSafeTroubleshootingContext(
  evidence: ChatEvidence,
  options: { openWorkOrderOnAsset?: boolean; userMessage?: string }
) {
  const base = buildTier1TroubleshootingBundle(evidence, {
    openWorkOrderOnAsset: options.openWorkOrderOnAsset,
    userMessage: options.userMessage,
  });
  return {
    ...base,
    message_hints: buildMessageHints(options.userMessage ?? ''),
  };
}

function buildMessageHints(userMessage: string) {
  const t = userMessage.toLowerCase();
  const out: string[] = [];
  if (/\bultrasound|probe|doppler|transducer\b/i.test(t)) {
    out.push('ultrasound: check probe head/cable, gel/coupling, exam preset, and artifact vs true resolution loss; verify monitor/display path (cable, clone output).');
  }
  if (/\bmonitor|display|power|won'?t start|not powering|black screen\b/i.test(t)) {
    out.push('display/power: power path (outlet, breaker, line cord), rear power switch, battery runtime if portable, and external video path before opening the device.');
  }
  if (/\bimage quality|fuzzy|artifact|noisy|resolution\b/i.test(t) && !/\bservice mode|error code|board\b/i.test(t)) {
    out.push('image quality (generic): first verify patient prep, transducer contact, and correct preset before assuming hardware service.');
  }
  return out;
}
