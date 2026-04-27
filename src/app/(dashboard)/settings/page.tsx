'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, MoreVertical, Shield } from 'lucide-react';
import * as settingsService from '@/services/settings.service';
import {
  PageHeader,
  DataTable,
  Button,
  Modal,
  Input,
  Select,
  Tabs,
  Dropdown,
  ConfirmDialog,
  useToast,
  Badge,
} from '@/components/ui';

type ReferenceTable =
  | 'departments'
  | 'equipment_categories'
  | 'manufacturers'
  | 'equipment_models'
  | 'vendors'
  | 'suppliers'
  | 'failure_codes'
  | 'maintenance_action_codes'
  | 'calibration_types'
  | 'pm_templates';

interface TabConfig {
  id: ReferenceTable;
  label: string;
  columns: { key: string; header: string; sortable?: boolean; searchable?: boolean }[];
  formFields: FormField[];
}

interface FormField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea';
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

const TAB_CONFIGS: TabConfig[] = [
  {
    id: 'departments',
    label: 'Departments',
    columns: [
      { key: 'name', header: 'Name', sortable: true, searchable: true },
      { key: 'code', header: 'Code', sortable: true },
      { key: 'description', header: 'Description' },
    ],
    formFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'code', label: 'Code', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'text' },
    ],
  },
  {
    id: 'equipment_categories',
    label: 'Categories',
    columns: [
      { key: 'name', header: 'Name', sortable: true, searchable: true },
      { key: 'code', header: 'Code', sortable: true },
      { key: 'description', header: 'Description' },
      { key: 'criticality_level', header: 'Criticality' },
    ],
    formFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'code', label: 'Code', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'text' },
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
    ],
  },
  {
    id: 'manufacturers',
    label: 'Manufacturers',
    columns: [
      { key: 'name', header: 'Name', sortable: true, searchable: true },
      { key: 'country', header: 'Country' },
    ],
    formFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'country', label: 'Country', type: 'text' },
    ],
  },
  {
    id: 'equipment_models',
    label: 'Models',
    columns: [
      { key: 'name', header: 'Name', sortable: true, searchable: true },
      { key: 'description', header: 'Description' },
    ],
    formFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'text' },
    ],
  },
  {
    id: 'vendors',
    label: 'Vendors',
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
    columns: [
      { key: 'code', header: 'Code', sortable: true, searchable: true },
      { key: 'description', header: 'Description', searchable: true },
      { key: 'category', header: 'Category' },
    ],
    formFields: [
      { key: 'code', label: 'Code', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'text', required: true },
      { key: 'category', label: 'Category', type: 'text' },
    ],
  },
  {
    id: 'maintenance_action_codes',
    label: 'Action Codes',
    columns: [
      { key: 'code', header: 'Code', sortable: true, searchable: true },
      { key: 'description', header: 'Description', searchable: true },
      { key: 'category', header: 'Category' },
    ],
    formFields: [
      { key: 'code', label: 'Code', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'text', required: true },
      { key: 'category', label: 'Category', type: 'text' },
    ],
  },
  {
    id: 'calibration_types',
    label: 'Calibration Types',
    columns: [
      { key: 'name', header: 'Name', sortable: true, searchable: true },
      { key: 'description', header: 'Description' },
      { key: 'interval_months', header: 'Interval (months)' },
    ],
    formFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'interval_months', label: 'Interval (months)', type: 'number', required: true },
    ],
  },
  {
    id: 'pm_templates',
    label: 'PM Templates',
    columns: [
      { key: 'name', header: 'Name', sortable: true, searchable: true },
      { key: 'description', header: 'Description' },
      { key: 'frequency_days', header: 'Frequency (days)' },
    ],
    formFields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'frequency_days', label: 'Frequency (days)', type: 'number', required: true },
    ],
  },
];

export default function SettingsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ReferenceTable>('departments');
  const [dataMap, setDataMap] = useState<Record<string, Record<string, unknown>[]>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Record<string, unknown> | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ table: ReferenceTable; id: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTableData = useCallback(async (table: ReferenceTable) => {
    setLoadingMap((prev) => ({ ...prev, [table]: true }));
    const { data, error } = await settingsService.getAll(table);
    if (error) {
      toast('error', `Failed to load ${table}`);
    } else {
      setDataMap((prev) => ({ ...prev, [table]: (data ?? []) as Record<string, unknown>[] }));
    }
    setLoadingMap((prev) => ({ ...prev, [table]: false }));
  }, [toast]);

  useEffect(() => {
    fetchTableData(activeTab);
  }, [activeTab, fetchTableData]);

  const currentConfig = TAB_CONFIGS.find((t) => t.id === activeTab)!;
  const tableData = dataMap[activeTab] ?? [];
  const isLoading = loadingMap[activeTab] ?? true;

  const openCreateModal = () => {
    setEditingItem(null);
    setFormData({});
    setModalOpen(true);
  };

  const openEditModal = (row: Record<string, unknown>) => {
    setEditingItem(row);
    const initial: Record<string, unknown> = {};
    currentConfig.formFields.forEach((f) => {
      initial[f.key] = row[f.key] ?? '';
    });
    setFormData(initial);
    setModalOpen(true);
  };

  const handleSave = async () => {
    const missing = currentConfig.formFields
      .filter((f) => f.required && !formData[f.key])
      .map((f) => f.label);
    if (missing.length > 0) {
      toast('warning', `Required: ${missing.join(', ')}`);
      return;
    }

    setSaving(true);
    try {
      if (editingItem) {
        const { error } = await settingsService.update(
          activeTab,
          editingItem.id as string,
          formData
        );
        if (error) throw error;
        toast('success', 'Record updated successfully');
      } else {
        const { error } = await settingsService.create(activeTab, formData);
        if (error) throw error;
        toast('success', 'Record created successfully');
      }
      setModalOpen(false);
      fetchTableData(activeTab);
    } catch {
      toast('error', `Failed to ${editingItem ? 'update' : 'create'} record`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await settingsService.remove(deleteTarget.table, deleteTarget.id);
      if (error) throw error;
      toast('success', 'Record deleted successfully');
      fetchTableData(activeTab);
    } catch {
      toast('error', 'Failed to delete record');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const columnsWithActions = [
    ...currentConfig.columns,
    {
      key: '_actions',
      header: '',
      sortable: false,
      searchable: false,
      className: 'w-12',
      render: (row: Record<string, unknown>) => (
        <Dropdown
          trigger={
            <button className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800">
              <MoreVertical className="h-4 w-4" />
            </button>
          }
          items={[
            {
              label: 'Edit',
              icon: <Pencil className="h-4 w-4" />,
              onClick: () => openEditModal(row),
            },
            {
              label: 'Delete',
              icon: <Trash2 className="h-4 w-4" />,
              destructive: true,
              onClick: () =>
                setDeleteTarget({ table: activeTab, id: row.id as string }),
            },
          ]}
        />
      ),
    },
  ];

  const tabs = TAB_CONFIGS.map((cfg) => ({
    id: cfg.id,
    label: cfg.label,
    count: dataMap[cfg.id]?.length,
    content: (
      <DataTable
        columns={columnsWithActions}
        data={tableData}
        loading={isLoading}
        searchPlaceholder={`Search ${cfg.label.toLowerCase()}...`}
        emptyMessage={`No ${cfg.label.toLowerCase()} found`}
        actions={
          <Button onClick={openCreateModal} size="sm">
            <Plus className="h-4 w-4" />
            Add {cfg.label.replace(/s$/, '')}
          </Button>
        }
      />
    ),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage reference data and system configuration"
        actions={
          <Badge variant="info">
            <Shield className="mr-1 h-3 w-3" />
            Admin Only
          </Badge>
        }
      />

      <Tabs
        tabs={tabs}
        defaultTab="departments"
        onChange={(id) => setActiveTab(id as ReferenceTable)}
      />

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingItem ? `Edit ${currentConfig.label.replace(/s$/, '')}` : `Add ${currentConfig.label.replace(/s$/, '')}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={saving}>
              {editingItem ? 'Update' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {currentConfig.formFields.map((field) =>
            field.type === 'select' && field.options ? (
              <Select
                key={field.key}
                label={field.label}
                options={field.options}
                placeholder={`Select ${field.label.toLowerCase()}`}
                value={(formData[field.key] as string) ?? ''}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
              />
            ) : (
              <Input
                key={field.key}
                label={field.label}
                type={field.type === 'number' ? 'number' : 'text'}
                placeholder={field.placeholder ?? `Enter ${field.label.toLowerCase()}`}
                required={field.required}
                value={(formData[field.key] as string) ?? ''}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    [field.key]:
                      field.type === 'number' ? Number(e.target.value) : e.target.value,
                  }))
                }
              />
            )
          )}
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Record"
        description="Are you sure you want to delete this record? This action cannot be undone."
        confirmLabel="Delete"
        loading={deleting}
        destructive
      />
    </div>
  );
}
