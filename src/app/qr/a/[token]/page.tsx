// QR scan landing route (Phase 3).
//
// Public route — middleware allows /qr without auth so this server component
// can decide what to render. The contract is:
//   - Invalid token format       → QrInvalidState variant="invalid"
//   - Token validated, no asset  → QrInvalidState variant="not_found"
//   - Token found but revoked    → QrInvalidState variant="revoked"
//   - Token + asset OK, no auth  → QrLoginRequired with returnTo
//   - Token + asset OK + auth    → QrAssetLandingPage (role-aware)
//
// QR is identity only. The auth session + role decide what is actually shown
// on the landing page; the token never grants permissions.

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getServerProfile } from '@/lib/auth/helpers';
import { resolveQrLandingAsset, logQrScan, logQrSecurityEvent } from '@/services/qr.service';
import { getQrRoleContext } from '@/services/qr-context.service';
import AssistantPageContextBridge from '@/components/assistant/AssistantPageContextBridge';
import QrInvalidState from './QrInvalidState';
import QrLoginRequired from './QrLoginRequired';
import QrAssetLandingPage from './QrAssetLandingPage';
import QrLandingClientShell from './QrLandingClientShell';

type RouteParams = Promise<{ token: string }>;
type RouteSearchParams = Promise<Record<string, string | string[] | undefined>>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Always render fresh — scans should reflect live asset state, and we record
// a scan row per successful authenticated resolution.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function QrLandingRoute({ params, searchParams }: { params: RouteParams; searchParams: RouteSearchParams }) {
  const { token } = await params;
  const query = await searchParams;
  const requestSearchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) requestSearchParams.append(key, item);
    } else if (value != null) {
      requestSearchParams.set(key, value);
    }
  }
  const requestSearch = requestSearchParams.toString() ? `?${requestSearchParams.toString()}` : '';

  const supabase = await createClient();
  const resolution = await resolveQrLandingAsset(token, supabase as never);
  const hdrs = await headers();
  const userAgent = hdrs.get('user-agent');

  if (resolution.status === 'invalid') {
    const { data: { user } } = await supabase.auth.getUser();
    await logQrSecurityEvent({
      token,
      scanStatus: 'invalid',
      authUserId: user?.id ?? null,
      userAgent,
      metadata: { route: 'qr.landing.invalid' },
    }, supabase as never);
    return <QrInvalidState variant="invalid" authenticated={!!user} />;
  }

  if (resolution.status === 'not_found') {
    const { data: { user } } = await supabase.auth.getUser();
    await logQrSecurityEvent({
      token,
      scanStatus: 'not_found',
      authUserId: user?.id ?? null,
      userAgent,
      metadata: { route: 'qr.landing.not_found' },
    }, supabase as never);
    return <QrInvalidState variant="not_found" authenticated={!!user} />;
  }

  if (resolution.status === 'revoked') {
    const { data: { user } } = await supabase.auth.getUser();
    const profile = user
      ? await getServerProfile()
      : null;
    const profileId = (profile?.id as string | undefined) ?? null;
    const roleName = Array.isArray(profile?.roleNames) ? profile.roleNames.join(',') : null;

    await logQrSecurityEvent({
      token,
      scanStatus: 'revoked',
      assetId: profile ? resolution.assetId : null,
      scannerProfileId: profileId,
      authUserId: user?.id ?? null,
      roleName,
      userAgent,
      metadata: {
        route: 'qr.landing.revoked',
        replaced_at: resolution.replacedAt ?? null,
        asset_known_to_server: Boolean(resolution.assetId),
      },
    }, supabase as never);

    // R16: a revoked QR scan is a security/label-integrity event. Emit to
    // Developer/Admin/BME Head so they see the attempted scan. The
    // notification engine handles dedupe by (recipient + event + source_id)
    // with a 10-minute cooldown, so a refreshing scanner does not spam.
    // Source_id is the QR token itself — we do NOT include asset_id in
    // the payload because the public-facing branch must not leak which
    // asset the token belonged to. The masked token is enough for an
    // admin to look up the scan in audit / equipment_qr_scans.
    try {
      const { emitNotificationEvent } = await import('@/services/notifications/notification-engine');
      const maskedToken = token.length > 8
        ? `${token.slice(0, 4)}…${token.slice(-4)}`
        : token;
      await emitNotificationEvent({
        event_type: 'qr.revoked_scanned',
        source_table: 'equipment_qr_scans',
        source_id: token, // dedupe key — same revoked token from same scanner only fires once per window
        priority: 'high',
        payload: {
          masked_token: maskedToken,
          replaced_at: resolution.replacedAt ?? null,
          // profiles.id when logged in. auth.users.id is intentionally
          // separate and only retained in security evidence.
          scanner_profile_id: profileId,
          // Honest "we don't know which asset" — UI must not pretend otherwise.
          asset_id: null,
        },
      });
    } catch (e) {
      console.error('[notifications] qr.revoked_scanned emit failed:', e);
    }

    return <QrInvalidState variant="revoked" authenticated={!!user} />;
  }

  const profile = await getServerProfile();
  if (!profile) {
    await logQrSecurityEvent({
      token,
      scanStatus: 'auth_required',
      userAgent,
      metadata: { route: 'qr.landing.auth_required' },
    }, supabase as never);
    return <QrLoginRequired returnTo={`/qr/a/${token}${requestSearch}`} />;
  }

  const asset = resolution.asset;
  const chatDepartmentId =
    asset.department_id && UUID_RE.test(asset.department_id) ? asset.department_id : undefined;
  const profileContext = {
    id: profile.id as string,
    full_name: (profile.full_name as string | null) ?? null,
    email: (profile.email as string | null) ?? null,
    job_title: (profile.job_title as string | null) ?? null,
    department_id: (profile.department_id as string | null) ?? null,
    roleNames: profile.roleNames ?? [],
  };
  const context = await getQrRoleContext({
    asset,
    profile: profileContext,
    client: supabase as never,
  });

  // R31: fire-and-forget scan log. Never block rendering, never crash on
  // failure. logQrScan() (Phase 6 service) DOES dedup open_qr_landing
  // page-render scans for the same asset/profile within
  // QR_SCAN_DEDUP_WINDOW_MINUTES (default 5 min). The dedup is best-effort;
  // a failed dedup probe still writes the scan rather than blocking it.
  try {
    const primary = profile.roleNames?.[0] ?? null;
    await logQrScan(
      {
        assetId: asset.id,
        scannedBy: profile.id,
        authUserId: (profile.user_id as string | null) ?? null,
        roleName: profile.roleNames?.join(',') || primary,
        scanSource: 'web',
        onlineStatus: 'online',
        userAgent: userAgent ?? null,
        actionTaken: 'open_qr_landing',
        token,
        metadata: { route: 'qr.landing.v2', roleCategory: context.roleCategory },
      },
      supabase as never,
    );
  } catch (err) {
    console.error('[qr.landing] scan log failed', err);
  }

  return (
    <QrLandingClientShell>
      <AssistantPageContextBridge
        moduleLabel="QR Field Scan"
        pageLabel={`${asset.asset_code} · ${asset.name}`}
        contextRefs={{ equipmentId: asset.id, departmentId: chatDepartmentId }}
        selectedRecordType="equipment"
        selectedRecordId={asset.id}
        selectedRecordLabel={`${asset.asset_code} · ${asset.name}`}
        qrToken={token}
        offlineStatus="online"
        roleHints={[context.roleCategory]}
        pageSummary="Authenticated QR field scan page with role-tailored asset context, work status, PM/calibration, parts blockers, scan evidence, and QR lifecycle hints."
        visibleCounts={{
          openRequests: context.requests.open.length,
          openWorkOrders: context.workOrders.open.length,
          overduePm: context.pm.overdue.length,
          activePm: context.pm.active.length,
          calibrationDueState: context.calibration.state,
          qrLabelStatus: asset.qr_label_status,
        }}
        availableEvidenceLinks={[{ label: 'QR page', href: `/qr/a/${token}`, type: 'qr' }, { label: 'Equipment', href: `/equipment/${asset.id}`, type: 'equipment' }]}
        quickPrompts={['Summarize this asset before inspection.', 'What should I know before inspecting this?', 'What safe first-line checks should I do?']}
      />
      <QrAssetLandingPage
        asset={asset}
        profile={profileContext}
        context={context}
      />
    </QrLandingClientShell>
  );
}
