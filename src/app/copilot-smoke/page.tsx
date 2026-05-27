import { notFound } from 'next/navigation';
import CopilotSmokeClient from './CopilotSmokeClient';

export default function CopilotSmokePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <CopilotSmokeClient />;
}
