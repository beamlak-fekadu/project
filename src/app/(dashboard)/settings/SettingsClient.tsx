'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Bell,
  Building2,
  ClipboardList,
  Database,
  MoreVertical,
  Pencil,
  Plus,
  Shield,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserCog,
  Users,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import * as settingsService from '@/services/settings.service';
import * as usersService from '@/services/users.service';
import { createReferenceRowAction, removeReferenceRowAction, updateReferenceRowAction, type ReferenceTable } from '@/actions/settings.actions';
import { assignRoleAction, removeRoleAction, updateProfileAction } from '@/actions/users.actions';
import { useRole } from '@/hooks/useRole';
import { formatRoleName } from '@/utils/roles';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DataTable,
  Dropdown,
  Input,
  Modal,
  PageHeader,
  Select,
  useToast,
  AnimatedMetric,
} from '@/components/ui';
import { motion } from 'framer-motion';
import { cardItem, cardStagger } from '@/lib/ui/motion-presets';

type SettingsSection =
  | 'profile-password'
  | 'hospital-profile'
  | 'departments'
  | 'equipment-categories'
  | 'calibration-types'
  | 'pm-templates'
  | 'spare-part-categories'
  | 'procurement-statuses'
  | 'disposal-reasons'
  | 'staff-access'
  | 'security-access'
  | 'notifications'
  | 'reference-data'
  | 'system-preferences'
  | 'data-import-export';

interface ProfileRow {
  id: string;
  user_id: string | null;
  full_name: string | null;
  email: string | null;
  department_id: string | null;
  job_title: string | null;
  is_active: boolean;
  departments: { id: string; name: string; code: string } | null;
  user_roles: {
    id: string;
    role_id: string;
    roles: { id: string; name: string; description: string | null; permissions: unknown };
  }[];
}

interface RoleOption {
  id: string;
  name: string;
  description: string | null;
  permissions?: unknown;
}

interface FormField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  required?: boolean;
  options?: { value: string; label: string }[];
}

interface ReferenceConfig {
  id: ReferenceTable;
  label: string;
  description: string;
  columns: { key: string; header: string; sortable?: boolean; searchable?: boolean }[];
  formFields: FormField[];
}

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: React.ElementType; access: string }> = [
  { id: 'profile-password', label: 'Profile and Password', icon: UserCog, access: 'Personal' },
  { id: 'hospital-profile', label: 'Hospital Profile', icon: Building2, access: 'Operational' },
  { id: 'departments', label: 'Departments', icon: Building2, access: 'Operational' },
  { id: 'equipment-categories', label: 'Equipment Categories', icon: Database, access: 'Operational' },
  { id: 'calibration-types', label: 'Calibration Types', icon: Database, access: 'Operational' },
  { id: 'pm-templates', label: 'PM Templates', icon: Database, access: 'Operational' },
  { id: 'spare-part-categories', label: 'Spare Part Categories', icon: Database, access: 'Configured' },
  { id: 'procurement-statuses', label: 'Procurement Statuses', icon: ClipboardList, access: 'Configured' },
  { id: 'disposal-reasons', label: 'Disposal Reasons', icon: Trash2, access: 'Configured' },
  { id: 'staff-access', label: 'User Management', icon: Users, access: 'Admin' },
  { id: 'security-access', label: 'Role Permissions', icon: Shield, access: 'Admin' },
  { id: 'notifications', label: 'Notifications', icon: Bell, access: 'Planned' },
  { id: 'reference-data', label: 'Reference Data', icon: Database, access: 'Admin' },
  { id: 'system-preferences', label: 'System Preferences', icon: SlidersHorizontal, access: 'Operational' },
  { id: 'data-import-export', label: 'Data Import / Export', icon: Upload, access: 'Admin' },
];

const REFERENCE_CONFIGS: ReferenceConfig[] = [
  {
    id: 'departments',
    label: 'Departments',
    description: 'Hospital departments used for ownership, readiness, reports, and role scoping.',
    columns: [
      { key: 'name', header: 'Name', sortable: true, searchable: true },
      { key: 'code', header: 'Code', sortable: true },
      { key: 'description', header: 'Description' },
      { key: 'is_active', header: 'Active' },
    ],
    formFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'code', label: 'Code', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'text' },
    ],
  },
  {
    id: 'equipment_categories',
    label: 'Equipment Categories',
    description: 'Equipment categories and criticality used by readiness, PM, calibration, and lifecycle views.',
    columns: [
      { key: 'name', header: 'Name', sortable: true, searchable: true },
      { key: 'code', header: 'Code', sortable: true },
      { key: 'criticality_level', header: 'Criticality' },
      { key: 'description', header: 'Description' },
    ],
    formFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'code', label: 'Code', type: 'text', required: true },
      {
        key: 'criticality_level',
        label: 'Criticality Level',
        type: 'select',
        options: [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
          { value: 'critical', label: 'Critical' },
        ],
      },
      { key: 'description', label: 'Description', type: 'text' },
    ],
  },
  {
    id: 'manufacturers',
    label: 'Manufacturers',
    description: 'Equipment manufacturer reference list.',
    columns: [{ key: 'name', header: 'Name', sortable: true, searchable: true }, { key: 'country', header: 'Country' }],
    formFields: [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'country', label: 'Country', type: 'text' }],
  },
  {
    id: 'equipment_models',
    label: 'Equipment Models',
    description: 'Model reference list for equipment assets.',
    columns: [{ key: 'name', header: 'Name', sortable: true, searchable: true }, { key: 'description', header: 'Description' }],
    formFields: [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'description', label: 'Description', type: 'text' }],
  },
  {
    id: 'vendors',
    label: 'Vendors',
    description: 'External service and procurement vendors.',
    columns: [
      { key: 'name', header: 'Name', sortable: true, searchable: true },
      { key: 'contact_person', header: 'Contact Person' },
      { key: 'phone', header: 'Phone' },
      { key: 'email', header: 'Email' },
    ],
    formFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'contact_person', label: 'Contact Person', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'address', label: 'Address', type: 'text' },
    ],
  },
  {
    id: 'suppliers',
    label: 'Suppliers',
    description: 'Supplier list for spare parts and materials.',
    columns: [
      { key: 'name', header: 'Name', sortable: true, searchable: true },
      { key: 'contact_person', header: 'Contact Person' },
      { key: 'phone', header: 'Phone' },
      { key: 'email', header: 'Email' },
    ],
    formFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'contact_person', label: 'Contact Person', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'address', label: 'Address', type: 'text' },
    ],
  },
  {
    id: 'failure_codes',
    label: 'Failure Codes',
    description: 'Failure classification codes for maintenance evidence.',
    columns: [{ key: 'code', header: 'Code', sortable: true }, { key: 'description', header: 'Description', searchable: true }, { key: 'category', header: 'Category' }],
    formFields: [{ key: 'code', label: 'Code', type: 'text', required: true }, { key: 'description', label: 'Description', type: 'text', required: true }, { key: 'category', label: 'Category', type: 'text' }],
  },
  {
    id: 'maintenance_action_codes',
    label: 'Action Codes',
    description: 'Maintenance action codes for repair and inspection evidence.',
    columns: [{ key: 'code', header: 'Code', sortable: true }, { key: 'description', header: 'Description', searchable: true }, { key: 'category', header: 'Category' }],
    formFields: [{ key: 'code', label: 'Code', type: 'text', required: true }, { key: 'description', label: 'Description', type: 'text', required: true }, { key: 'category', label: 'Category', type: 'text' }],
  },
  {
    id: 'calibration_types',
    label: 'Calibration Types',
    description: 'Calibration interval definitions used by calibration workflows.',
    columns: [{ key: 'name', header: 'Name', sortable: true, searchable: true }, { key: 'interval_months', header: 'Interval (months)' }, { key: 'description', header: 'Description' }],
    formFields: [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'interval_months', label: 'Interval (months)', type: 'number', required: true }, { key: 'description', label: 'Description', type: 'text' }],
  },
  {
    id: 'pm_templates',
    label: 'PM Templates',
    description: 'Preventive maintenance templates and frequency references.',
    columns: [{ key: 'name', header: 'Name', sortable: true, searchable: true }, { key: 'frequency_days', header: 'Frequency (days)' }, { key: 'description', header: 'Description' }],
    formFields: [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'frequency_days', label: 'Frequency (days)', type: 'number', required: true }, { key: 'description', label: 'Description', type: 'text' }],
  },
  {
    id: 'memis_lookup_values',
    label: 'MEMIS Lookup Values',
    description: 'Imported MEMIS-style lookup values used for compatibility and migration support.',
    columns: [{ key: 'lookup_group', header: 'Group' }, { key: 'code', header: 'Code' }, { key: 'label', header: 'Label' }, { key: 'is_active', header: 'Active' }],
    formFields: [{ key: 'lookup_group', label: 'Group', type: 'text', required: true }, { key: 'code', label: 'Code', type: 'text', required: true }, { key: 'label', label: 'Label', type: 'text', required: true }, { key: 'description', label: 'Description', type: 'text' }],
  },
];

const ROLE_GROUPS = [
  { id: 'bme_head', label: 'BME Head', match: (roles: string[]) => roles.includes('bme_head') },
  { id: 'technician', label: 'Biomedical Engineers/Technicians', match: (roles: string[]) => roles.includes('technician') },
  { id: 'department_head', label: 'Department Heads', match: (roles: string[]) => roles.includes('department_head') },
  { id: 'department_user', label: 'Department Users', match: (roles: string[]) => roles.includes('department_user') },
  { id: 'store_user', label: 'Store/Logistics Users', match: (roles: string[]) => roles.includes('store_user') },
  { id: 'viewer', label: 'Viewers/Management', match: (roles: string[]) => roles.includes('viewer') },
  { id: 'developer', label: 'Developer/System', match: (roles: string[]) => roles.includes('developer') || roles.includes('admin'), system: true },
];

const ROLE_VARIANT: Record<string, 'info' | 'purple' | 'warning' | 'success' | 'default'> = {
  developer: 'purple',
  admin: 'purple',
  bme_head: 'info',
  technician: 'info',
  department_head: 'warning',
  department_user: 'warning',
  store_user: 'success',
  viewer: 'default',
};

function normalizeSection(value: string | null): SettingsSection {
  return SECTIONS.some((section) => section.id === value) ? (value as SettingsSection) : 'profile-password';
}

function roleNames(profile: ProfileRow) {
  return (profile.user_roles ?? []).map((role) => role.roles?.name).filter(Boolean) as string[];
}

function permissionsCount(value: unknown) {
  return Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0;
}

export default function SettingsClient() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { isDeveloper, isAdmin, isBmeHead, primaryRole } = useRole();
  const canAdministerSettings = isDeveloper || isAdmin;
  const canViewGovernance = canAdministerSettings || isBmeHead;
  const initialSection = normalizeSection(searchParams.get('tab'));
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [referenceTable, setReferenceTable] = useState<ReferenceTable>(
    initialSection === 'equipment-categories' ? 'equipment_categories'
      : initialSection === 'calibration-types' ? 'calibration_types'
        : initialSection === 'pm-templates' ? 'pm_templates'
          : 'departments'
  );
  const [referenceData, setReferenceData] = useState<Record<string, Record<string, unknown>[]>>({});
  const [referenceLoading, setReferenceLoading] = useState<Record<string, boolean>>({});
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [auditRows, setAuditRows] = useState<Record<string, unknown>[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(true);

  const [referenceModalOpen, setReferenceModalOpen] = useState(false);
  const [editingReference, setEditingReference] = useState<Record<string, unknown> | null>(null);
  const [referenceForm, setReferenceForm] = useState<Record<string, unknown>>({});
  const [referenceSaving, setReferenceSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ table: ReferenceTable; id: string } | null>(null);

  const [selectedUser, setSelectedUser] = useState<ProfileRow | null>(null);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [savingRole, setSavingRole] = useState(false);
  const [toggleTarget, setToggleTarget] = useState<ProfileRow | null>(null);

  const loadReferenceTable = useCallback(async (table: ReferenceTable) => {
    setReferenceLoading((prev) => ({ ...prev, [table]: true }));
    const { data, error } = await settingsService.getAll(table);
    if (error) toast('error', `Failed to load ${table}`);
    else setReferenceData((prev) => ({ ...prev, [table]: (data ?? []) as Record<string, unknown>[] }));
    setReferenceLoading((prev) => ({ ...prev, [table]: false }));
  }, [toast]);

  const loadSettingsData = useCallback(async () => {
    setSettingsLoading(true);
    const supabase = createClient();
    const [profileRes, rolesRes, auditRes] = await Promise.all([
      usersService.getAllProfiles(),
      usersService.getRoles(),
      supabase.from('audit_logs').select('id, action, entity_type, created_at').order('created_at', { ascending: false }).limit(10),
    ]);
    // Surface load failures instead of silently rendering 0 — a PostgREST
    // embed error here used to leave the page showing "0 profiles" with no
    // explanation. Now the user sees a toast and the developer console gets
    // the raw error.
    if (profileRes.error) {
      console.error('[settings] failed to load profiles:', profileRes.error);
      toast('error', 'Failed to load staff profiles. Check Developer Lab for diagnostics.');
    }
    if (rolesRes.error) {
      console.error('[settings] failed to load roles:', rolesRes.error);
      toast('error', 'Failed to load roles.');
    }
    if (profileRes.data) setProfiles(profileRes.data as unknown as ProfileRow[]);
    if (rolesRes.data) setRoles(rolesRes.data as unknown as RoleOption[]);
    if (auditRes.data) setAuditRows(auditRes.data as Record<string, unknown>[]);
    setSettingsLoading(false);
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSettingsData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSettingsData]);

  useEffect(() => {
    if (referenceData[referenceTable]) return;
    const timer = window.setTimeout(() => void loadReferenceTable(referenceTable), 0);
    return () => window.clearTimeout(timer);
  }, [loadReferenceTable, referenceData, referenceTable]);

  const currentReference = REFERENCE_CONFIGS.find((item) => item.id === referenceTable) ?? REFERENCE_CONFIGS[0];

  function openReferenceCreate(table = referenceTable) {
    setReferenceTable(table);
    setEditingReference(null);
    setReferenceForm({});
    setReferenceModalOpen(true);
  }

  function openReferenceEdit(row: Record<string, unknown>, table = referenceTable) {
    const config = REFERENCE_CONFIGS.find((item) => item.id === table) ?? REFERENCE_CONFIGS[0];
    setReferenceTable(table);
    const initial: Record<string, unknown> = {};
    for (const field of config.formFields) initial[field.key] = row[field.key] ?? '';
    setEditingReference(row);
    setReferenceForm(initial);
    setReferenceModalOpen(true);
  }

  async function saveReference() {
    const missing = currentReference.formFields.filter((field) => field.required && !referenceForm[field.key]).map((field) => field.label);
    if (missing.length > 0) {
      toast('warning', `Required: ${missing.join(', ')}`);
      return;
    }
    setReferenceSaving(true);
    const result = editingReference
      ? await updateReferenceRowAction(referenceTable, editingReference.id as string, referenceForm)
      : await createReferenceRowAction(referenceTable, referenceForm);
    setReferenceSaving(false);
    if (!result.success) {
      toast('error', result.error ?? 'Failed to save reference row');
      return;
    }
    toast('success', editingReference ? 'Reference row updated' : 'Reference row created');
    setReferenceModalOpen(false);
    void loadReferenceTable(referenceTable);
    void loadSettingsData();
  }

  async function deleteReference() {
    if (!deleteTarget) return;
    const result = await removeReferenceRowAction(deleteTarget.table, deleteTarget.id);
    if (!result.success) toast('error', result.error ?? 'Failed to delete reference row');
    else {
      toast('success', 'Reference row deleted');
      void loadReferenceTable(deleteTarget.table);
      void loadSettingsData();
    }
    setDeleteTarget(null);
  }

  function openRoleModal(user: ProfileRow) {
    setSelectedUser(user);
    setSelectedRoleId('');
    setRoleModalOpen(true);
  }

  async function assignRole() {
    if (!selectedUser || !selectedRoleId) {
      toast('warning', 'Select a role first');
      return;
    }
    if (selectedUser.user_roles.some((userRole) => userRole.role_id === selectedRoleId)) {
      toast('warning', 'Staff member already has this role');
      return;
    }
    setSavingRole(true);
    const result = await assignRoleAction(selectedUser.id, selectedRoleId);
    setSavingRole(false);
    if (!result.success) toast('error', result.error ?? 'Failed to assign role');
    else {
      toast('success', 'Role assigned');
      setRoleModalOpen(false);
      void loadSettingsData();
    }
  }

  async function removeRole(user: ProfileRow, roleId: string) {
    const result = await removeRoleAction(user.id, roleId);
    if (!result.success) toast('error', result.error ?? 'Failed to remove role');
    else {
      toast('success', 'Role removed');
      void loadSettingsData();
    }
  }

  async function toggleProfile() {
    if (!toggleTarget) return;
    const result = await updateProfileAction(toggleTarget.id, { is_active: !toggleTarget.is_active });
    if (!result.success) toast('error', result.error ?? 'Failed to update profile');
    else {
      toast('success', toggleTarget.is_active ? 'Profile deactivated' : 'Profile activated');
      void loadSettingsData();
    }
    setToggleTarget(null);
  }

  const staffRows = useMemo(() => profiles.map((profile) => ({ ...profile, rolesLabel: roleNames(profile).join(' ') })), [profiles]);
  const profilesWithoutRoles = profiles.filter((profile) => roleNames(profile).length === 0).length;
  const profileOnly = profiles.filter((profile) => !profile.user_id).length;
  const inactiveAccounts = profiles.filter((profile) => !profile.is_active).length;

  const staffColumns = [
    {
      key: 'full_name',
      header: 'Staff',
      sortable: true,
      searchable: true,
      render: (row: Record<string, unknown>) => {
        const staff = row as unknown as ProfileRow;
        return (
          <div>
            <p className="font-medium text-[var(--foreground)]">{staff.full_name ?? 'Unnamed staff'}</p>
            <p className="text-xs text-[var(--text-muted)]">{staff.email ?? 'No email'} · {staff.user_id ? 'Auth-linked login user' : 'Profile-only staff'}</p>
          </div>
        );
      },
    },
    { key: 'job_title', header: 'Job Title' },
    {
      key: 'department',
      header: 'Department',
      render: (row: Record<string, unknown>) => (row as unknown as ProfileRow).departments?.name ?? '-',
    },
    {
      key: 'rolesLabel',
      header: 'Roles',
      render: (row: Record<string, unknown>) => {
        const staff = row as unknown as ProfileRow;
        const names = roleNames(staff);
        if (names.length === 0) return <Badge variant="warning">No role</Badge>;
        return (
          <div className="flex flex-wrap gap-1">
            {names.map((name) => <Badge key={name} variant={ROLE_VARIANT[name] ?? 'default'}>{formatRoleName(name)}</Badge>)}
          </div>
        );
      },
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (row: Record<string, unknown>) => <Badge variant={(row as unknown as ProfileRow).is_active ? 'success' : 'default'}>{(row as unknown as ProfileRow).is_active ? 'Active' : 'Inactive'}</Badge>,
    },
    ...(canAdministerSettings
      ? [{
          key: '_actions',
          header: '',
          render: (row: Record<string, unknown>) => {
            const staff = row as unknown as ProfileRow;
            const isSystem = roleNames(staff).some((role) => role === 'developer');
            return (
              <Dropdown
                trigger={<button className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--surface-2)]"><MoreVertical className="h-4 w-4" /></button>}
                items={[
                  ...(canAdministerSettings && !isSystem
                    ? [{ label: 'Manage Roles', icon: <UserCog className="h-4 w-4" />, onClick: () => openRoleModal(staff) }]
                    : []),
                  ...(canAdministerSettings && !isSystem
                    ? [{
                        label: staff.is_active ? 'Deactivate' : 'Activate',
                        icon: staff.is_active ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />,
                        destructive: staff.is_active,
                        onClick: () => setToggleTarget(staff),
                      }]
                    : []),
                ]}
              />
            );
          },
        }]
      : []),
  ];

  function renderReferenceManager(table = referenceTable) {
    const reference = REFERENCE_CONFIGS.find((item) => item.id === table) ?? REFERENCE_CONFIGS[0];
    const rows = referenceData[table] ?? [];
    const columns = [
      ...reference.columns,
      ...(canAdministerSettings
        ? [{
            key: '_actions',
            header: '',
            searchable: false,
            render: (row: Record<string, unknown>) => (
              <Dropdown
                trigger={<button className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--surface-2)]"><MoreVertical className="h-4 w-4" /></button>}
                items={[
                  { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onClick: () => openReferenceEdit(row, table) },
                  { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, destructive: true, onClick: () => setDeleteTarget({ table, id: row.id as string }) },
                ]}
              />
            ),
          }]
        : []),
    ];

    return (
      <Card>
        <CardHeader className="items-start">
          <div>
            <CardTitle>{reference.label}</CardTitle>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{reference.description}</p>
          </div>
          {canAdministerSettings ? (
            <Button size="sm" onClick={() => openReferenceCreate(table)}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          ) : (
            <Badge variant="info">Read-only</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {table === referenceTable && activeSection === 'reference-data' && (
            <Select
              label="Reference group"
              value={referenceTable}
              onChange={(event) => setReferenceTable(event.target.value as ReferenceTable)}
              options={REFERENCE_CONFIGS.map((config) => ({ value: config.id, label: config.label }))}
            />
          )}
          <DataTable
            columns={columns}
            data={rows}
            loading={referenceLoading[table]}
            searchPlaceholder={`Search ${reference.label.toLowerCase()}...`}
            emptyMessage={`No ${reference.label.toLowerCase()} found`}
          />
        </CardContent>
      </Card>
    );
  }

  function renderStaffAccess() {
    return (
      <div className="space-y-4">
        <motion.div variants={cardStagger} initial="initial" animate="animate" className="grid gap-4 md:grid-cols-4">
          <motion.div variants={cardItem}><Card><p className="text-sm text-[var(--text-muted)]">Profiles</p><p className="text-2xl font-semibold"><AnimatedMetric value={profiles.length} /></p></Card></motion.div>
          <motion.div variants={cardItem}><Card><p className="text-sm text-[var(--text-muted)]">Auth-linked</p><p className="text-2xl font-semibold"><AnimatedMetric value={profiles.length - profileOnly} /></p></Card></motion.div>
          <motion.div variants={cardItem}><Card><p className="text-sm text-[var(--text-muted)]">Profile-only</p><p className="text-2xl font-semibold"><AnimatedMetric value={profileOnly} /></p></Card></motion.div>
          <motion.div variants={cardItem}><Card><p className="text-sm text-[var(--text-muted)]">Without role</p><p className="text-2xl font-semibold"><AnimatedMetric value={profilesWithoutRoles} /></p></Card></motion.div>
        </motion.div>
        {ROLE_GROUPS.filter((group) => isDeveloper || isAdmin || !group.system).map((group) => {
          const grouped = staffRows.filter((profile) => group.match(roleNames(profile as ProfileRow)));
          return (
            <Card key={group.id}>
              <CardHeader>
                <CardTitle>{group.label}</CardTitle>
                <Badge variant={group.system ? 'purple' : 'info'}>{grouped.length}</Badge>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={staffColumns}
                  data={grouped as unknown as Record<string, unknown>[]}
                  searchPlaceholder={`Search ${group.label.toLowerCase()}...`}
                  emptyMessage={`No ${group.label.toLowerCase()} found`}
                  pageSize={8}
                />
              </CardContent>
            </Card>
          );
        })}
        <Card>
          <CardHeader><CardTitle>User Creation</CardTitle></CardHeader>
          <CardContent className="text-sm text-[var(--text-muted)]">
            Auth account creation is not implemented inside BMEDIS. New login users must be created through Supabase Auth, then linked to a profile. Profile-only staff remain visible for assignment, departments, training, and audit context.
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderSecurityAccess() {
    return (
      <div className="space-y-4">
        <motion.div variants={cardStagger} initial="initial" animate="animate" className="grid gap-4 md:grid-cols-4">
          <motion.div variants={cardItem}><Card><p className="text-sm text-[var(--text-muted)]">Roles</p><p className="text-2xl font-semibold"><AnimatedMetric value={roles.length} /></p></Card></motion.div>
          <motion.div variants={cardItem}><Card><p className="text-sm text-[var(--text-muted)]">Profiles without roles</p><p className="text-2xl font-semibold"><AnimatedMetric value={profilesWithoutRoles} /></p></Card></motion.div>
          <motion.div variants={cardItem}><Card><p className="text-sm text-[var(--text-muted)]">Inactive accounts</p><p className="text-2xl font-semibold"><AnimatedMetric value={inactiveAccounts} /></p></Card></motion.div>
          <motion.div variants={cardItem}><Card><p className="text-sm text-[var(--text-muted)]">Recent governance events</p><p className="text-2xl font-semibold"><AnimatedMetric value={auditRows.length} /></p></Card></motion.div>
        </motion.div>
        <Card>
          <CardHeader><CardTitle>Role Permission Matrix</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-[var(--text-muted)]">
                  <tr><th className="py-2 pr-4">Role</th><th className="py-2 pr-4">Users</th><th className="py-2 pr-4">Permissions</th><th className="py-2">Description</th></tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {roles.map((role) => (
                    <tr key={role.id}>
                      <td className="py-3 pr-4"><Badge variant={ROLE_VARIANT[role.name] ?? 'default'}>{formatRoleName(role.name)}</Badge></td>
                      <td className="py-3 pr-4">{profiles.filter((profile) => roleNames(profile).includes(role.name)).length}</td>
                      <td className="py-3 pr-4">{permissionsCount(role.permissions)} configured</td>
                      <td className="py-3 text-[var(--text-muted)]">{role.description ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>RLS and Audit Posture</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-[var(--text-muted)]">
              <p>All operational tables are expected to keep Row Level Security enabled. Server actions remain the mutation boundary for authorization, audit logging, and route revalidation.</p>
              <p>Developer diagnostics live in Developer Lab; BME Head operational access stays here without scoring sliders or debug controls.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Recent Access Governance Events</CardTitle></CardHeader>
            <CardContent>
              {auditRows.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No recent role/profile/security audit rows found.</p>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {auditRows.map((row) => (
                    <div key={row.id as string} className="py-2 text-sm">
                      <p className="text-[var(--foreground)]">{String(row.action)} on {String(row.entity_type)}</p>
                      <p className="text-xs text-[var(--text-muted)]">{new Date(String(row.created_at)).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  function renderSection() {
    if (activeSection === 'profile-password') {
      return (
        <Card>
          <CardHeader><CardTitle>Profile and Password</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 text-sm text-[var(--text-muted)]">
            <p>Profile information comes from the linked staff profile and department assignment.</p>
            <p>Password and authentication changes are handled by Supabase Auth flows. In-app password management is not implemented in this pass.</p>
          </CardContent>
        </Card>
      );
    }
    if (activeSection === 'departments') return renderReferenceManager('departments');
    if (activeSection === 'equipment-categories') return renderReferenceManager('equipment_categories');
    if (activeSection === 'calibration-types') return renderReferenceManager('calibration_types');
    if (activeSection === 'pm-templates') return renderReferenceManager('pm_templates');
    if (activeSection === 'spare-part-categories') {
      return (
        <Card>
          <CardHeader><CardTitle>Spare Part Categories</CardTitle><Badge variant="info">Configured in reference data</Badge></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-[var(--text-muted)]">Spare part categories are free-text classification values stored on each part row in the <code className="rounded bg-[var(--surface-3)] px-1">spare_parts.category</code> column. A dedicated lookup table has not been added yet, so CRUD is not available here.</p>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
              <p className="mb-2 font-medium text-[var(--foreground)]">Where it affects the system</p>
              <ul className="list-disc pl-4 text-[var(--text-muted)]">
                <li>Spare parts catalog grouping and category filter</li>
                <li>Training report category filter</li>
                <li>Procurement justification context</li>
              </ul>
            </div>
            <p className="text-[var(--text-muted)]">To manage categories today, update the <code className="rounded bg-[var(--surface-3)] px-1">category</code> field directly when editing a spare part.</p>
          </CardContent>
        </Card>
      );
    }
    if (activeSection === 'procurement-statuses') {
      const PROCUREMENT_STATUSES = [
        { value: 'requested', label: 'Requested', description: 'Request submitted; needs BME review and approval.' },
        { value: 'approved', label: 'Approved', description: 'Approved; ready to place order with supplier.' },
        { value: 'ordered', label: 'Ordered', description: 'Order placed; supplier follow-up and delivery tracking.' },
        { value: 'in_transit', label: 'In Transit', description: 'Goods in transit; prepare receipt and stock update.' },
        { value: 'delivered', label: 'Delivered', description: 'Goods received; receive into stock and close evidence.' },
        { value: 'canceled', label: 'Canceled', description: 'Request canceled; reason should be documented.' },
      ];
      return (
        <Card>
          <CardHeader><CardTitle>Procurement Statuses</CardTitle><Badge variant="info">Database enum — read-only</Badge></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-[var(--text-muted)]">Procurement statuses are a PostgreSQL enum defined in the database schema. They cannot be changed without a database migration. Inline status updates are available on the Procurement page.</p>
            <div className="grid gap-2 md:grid-cols-2">
              {PROCUREMENT_STATUSES.map((status) => (
                <div key={status.value} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 text-xs text-[var(--foreground)]">{status.value}</code>
                    <span className="text-xs font-medium text-[var(--foreground)]">{status.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{status.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      );
    }
    if (activeSection === 'disposal-reasons') {
      const DISPOSAL_METHODS = [
        { value: 'auction', label: 'Auction', description: 'Equipment sold by public or closed auction; proceeds documented.' },
        { value: 'donation', label: 'Donation', description: 'Equipment donated to another institution or organization.' },
        { value: 'recycling', label: 'Recycling', description: 'Equipment sent to certified e-waste or materials recycling.' },
        { value: 'destruction', label: 'Destruction', description: 'Equipment destroyed; used for hazardous, non-resalable, or expired items.' },
        { value: 'return_to_vendor', label: 'Return to Vendor', description: 'Equipment returned under warranty, contract, or trade-in agreement.' },
        { value: 'other', label: 'Other', description: 'Any other disposal method; must be described in notes.' },
      ];
      return (
        <Card>
          <CardHeader><CardTitle>Disposal Methods</CardTitle><Badge variant="info">Database enum — read-only</Badge></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-[var(--text-muted)]">Disposal methods are a PostgreSQL enum defined in the database schema. They cannot be changed without a database migration. These values are selected on the Disposal page when creating or completing a disposal request.</p>
            <div className="grid gap-2 md:grid-cols-2">
              {DISPOSAL_METHODS.map((method) => (
                <div key={method.value} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 text-xs text-[var(--foreground)]">{method.value}</code>
                    <span className="text-xs font-medium text-[var(--foreground)]">{method.label}</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{method.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      );
    }
    if (activeSection === 'staff-access') return renderStaffAccess();
    if (activeSection === 'security-access') return renderSecurityAccess();
    if (activeSection === 'reference-data') return renderReferenceManager();

    if (activeSection === 'hospital-profile') {
      return (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Hospital Profile</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between gap-4"><span className="text-[var(--text-muted)]">System name</span><span>BMEDIS</span></div>
              <div className="flex justify-between gap-4"><span className="text-[var(--text-muted)]">Implementation site</span><span>Menelik II Hospital</span></div>
              <div className="flex justify-between gap-4"><span className="text-[var(--text-muted)]">Implementation mode</span><Badge variant="info">Thesis/demo validation</Badge></div>
              <div className="flex justify-between gap-4"><span className="text-[var(--text-muted)]">Current role</span><span>{formatRoleName(primaryRole)}</span></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Operational Scope</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-[var(--text-muted)]">
              <p>Settings is the administration center for hospital profile, departments, categories, staff access, security posture, reference data, and import/export support.</p>
              <p>Developer-only scoring sliders and refresh diagnostics are intentionally kept in Developer Lab.</p>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (activeSection === 'notifications') {
      return (
        <Card>
          <CardHeader><CardTitle>Notifications</CardTitle><Badge variant="info">Planned</Badge></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3 text-sm text-[var(--text-muted)]">
            <p>Notification rules and escalation paths build on the unified Notification Center and internal recommendation signals.</p>
            <p>Future channels may include in-app summaries, assigned owners, escalation rules, and weekly management digests.</p>
            <p>No external notification channel is configured in this pass.</p>
          </CardContent>
        </Card>
      );
    }

    if (activeSection === 'system-preferences') {
      return (
        <Card>
          <CardHeader><CardTitle>System Preferences</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-[var(--text-muted)]">
            <p>Operational thresholds and organization preferences can live here once they are stable and safe for BME Head administration.</p>
            <p>Scoring sliders, thesis debug controls, and sensitivity analysis do not belong here; they are Developer Lab only.</p>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card>
        <CardHeader><CardTitle>Data Import / Export</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-[var(--text-muted)]">
          <p>Operational data export is available per module from the Reports center. Each report supports a timestamped PDF snapshot with evidence tables.</p>
          <p>Bulk import of hospital reference data (departments, categories, staff) is intentionally not exposed in-app; it is performed via vetted Supabase migrations or seed files to preserve auditability.</p>
          <div className="pt-1">
            <Link href="/reports" className="inline-flex items-center gap-1 text-[var(--brand)] hover:underline">Open Reports Center</Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Administration center for hospital profile, staff access, security posture, reference data, and system preferences."
        actions={<Badge variant={canAdministerSettings ? 'purple' : 'info'}>{canAdministerSettings ? 'Admin controls' : 'Read-only controls'}</Badge>}
      />

      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
        {SECTIONS.filter((section) => section.access !== 'Admin' || canViewGovernance).map((section) => {
          const Icon = section.icon;
          const active = activeSection === section.id;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => {
                setActiveSection(section.id);
                if (section.id === 'departments') setReferenceTable('departments');
                if (section.id === 'equipment-categories') setReferenceTable('equipment_categories');
                if (section.id === 'calibration-types') setReferenceTable('calibration_types');
                if (section.id === 'pm-templates') setReferenceTable('pm_templates');
              }}
              className={`rounded-lg border p-3 text-left transition ${active ? 'border-[var(--brand)] bg-[var(--surface-2)]' : 'border-[var(--border-subtle)] hover:border-[var(--brand)]/50'}`}
            >
              <Icon className="mb-2 h-4 w-4 text-[var(--brand)]" />
              <p className="text-sm font-medium text-[var(--foreground)]">{section.label}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{section.access}</p>
            </button>
          );
        })}
      </div>

      {settingsLoading && (activeSection === 'staff-access' || activeSection === 'security-access') ? (
        <Card><p className="text-sm text-[var(--text-muted)]">Loading settings data...</p></Card>
      ) : renderSection()}

      <Modal
        open={referenceModalOpen}
        onClose={() => setReferenceModalOpen(false)}
        title={editingReference ? `Edit ${currentReference.label}` : `Add ${currentReference.label}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setReferenceModalOpen(false)} disabled={referenceSaving}>Cancel</Button>
            <Button onClick={saveReference} loading={referenceSaving}>{editingReference ? 'Update' : 'Create'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {currentReference.formFields.map((field) => field.type === 'select' && field.options ? (
            <Select
              key={field.key}
              label={field.label}
              options={field.options}
              value={(referenceForm[field.key] as string) ?? ''}
              onChange={(event) => setReferenceForm((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          ) : (
            <Input
              key={field.key}
              label={field.label}
              type={field.type === 'number' ? 'number' : 'text'}
              required={field.required}
              value={(referenceForm[field.key] as string | number | undefined) ?? ''}
              onChange={(event) => setReferenceForm((current) => ({ ...current, [field.key]: field.type === 'number' ? Number(event.target.value) : event.target.value }))}
            />
          ))}
        </div>
      </Modal>

      <Modal
        open={roleModalOpen}
        onClose={() => setRoleModalOpen(false)}
        title={`Manage Roles - ${selectedUser?.full_name ?? ''}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setRoleModalOpen(false)} disabled={savingRole}>Cancel</Button>
            <Button onClick={assignRole} loading={savingRole}>Assign Role</Button>
          </>
        }
      >
        <div className="space-y-4">
          {selectedUser && roleNames(selectedUser).length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-[var(--foreground)]">Current roles</p>
              <div className="flex flex-wrap gap-2">
                {selectedUser.user_roles.map((userRole) => (
                  <span key={userRole.id} className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] px-2 py-1 text-sm">
                    {formatRoleName(userRole.roles.name)}
                    <button type="button" onClick={() => removeRole(selectedUser, userRole.role_id)} className="text-[var(--text-muted)] hover:text-[var(--danger)]">
                      <ShieldOff className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          <Select
            label="Add role"
            placeholder="Select role"
            options={roles.filter((role) => role.name !== 'developer').map((role) => ({ value: role.id, label: formatRoleName(role.name) }))}
            value={selectedRoleId}
            onChange={(event) => setSelectedRoleId(event.target.value)}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteReference}
        title="Delete Reference Row"
        description="This removes the selected reference row. Existing records may still reference historical values."
        confirmLabel="Delete"
        destructive
      />

      <ConfirmDialog
        open={!!toggleTarget}
        onClose={() => setToggleTarget(null)}
        onConfirm={toggleProfile}
        title={toggleTarget?.is_active ? 'Deactivate Profile' : 'Activate Profile'}
        description={toggleTarget?.is_active ? 'This staff profile will no longer be active in operational lists.' : 'This staff profile will become active again.'}
        confirmLabel={toggleTarget?.is_active ? 'Deactivate' : 'Activate'}
        destructive={!!toggleTarget?.is_active}
      />
    </div>
  );
}
