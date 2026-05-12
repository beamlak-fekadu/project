'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Download, Printer, ArrowLeft } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import FilterBar from '@/components/ui/FilterBar';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import * as reportsService from '@/services/reports.service';
import * as settingsService from '@/services/settings.service';
import type { ReportFilters } from '@/services/reports.service';
import { exportToCSV, exportToPDF } from '@/utils/export';
import { prepareReportSnapshotAction } from '@/actions/reports.actions';

type Row = Record<string, unknown>;

interface ReportConfig {
  title: string;
  description: string;
  filterDefs: string[];
  fetchData: (filters: ReportFilters) => Promise<{ data: unknown[] | null; error: unknown }>;
  columns: { key: string; header: string; sortable?: boolean; render?: (row: Row) => React.ReactNode }[];
}

function formatLabel(val: string) {
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const resultVariant: Record<string, 'success' | 'error' | 'warning'> = {
  pass: 'success', fail: 'error', adjusted: 'warning',
};

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple'> = {
  pending: 'warning', approved: 'info', scheduled: 'purple', in_progress: 'purple',
  completed: 'success', rejected: 'error', canceled: 'default', overdue: 'error',
  open: 'warning', assigned: 'info', on_hold: 'default', skipped: 'default',
  active: 'success', inactive: 'default', disposed: 'error', in_storage: 'info',
  functional: 'success', needs_repair: 'warning', non_functional: 'error',
  under_maintenance: 'purple', decommissioned: 'default',
};

function normalizeReportType(type: string) {
  return ({
    'biomedical-operations': 'equipment',
    'department-readiness': 'equipment',
    'evaluation-demo': 'equipment',
    evaluation: 'equipment',
    'maintenance-performance': 'maintenance',
    'pm-compliance': 'pm',
    'calibration-compliance': 'calibration',
    'spare-parts-stock': 'spare-parts',
    'training-competency': 'training',
    'disposal-lifecycle': 'disposal',
    'technician-workload': 'work-orders',
    replacement: 'replacement-planning',
    procurement: 'procurement-pipeline',
  } as Record<string, string>)[type] ?? type;
}

function methodologyFor(type: string) {
  const normalized = normalizeReportType(type);
  if (normalized === 'pm') return 'PM compliance evidence comes from generated schedule rows. Completed schedules count as completed evidence; skipped/deferred/overdue rows remain visible for audit.';
  if (normalized === 'calibration') return 'Calibration compliance uses calibration records, result status, and next due dates. Failed or adjusted results remain evidence for follow-up work.';
  if (normalized === 'replacement-planning') return 'Replacement planning uses RPI component scores and supporting lifecycle evidence. The report supports BME Head review; it does not approve replacement automatically.';
  if (normalized === 'risk-fmea') return 'FMEA reporting uses severity, occurrence, detectability, and RPN with assignment method and explanation evidence where available.';
  if (normalized === 'procurement-pipeline') return 'Procurement evidence follows each request through status, priority, expected delivery, delay, and justification.';
  return 'Rows come from the operational source tables for this module. Filters narrow evidence; exports use the same filtered row set shown on screen.';
}

function summarizeReport(type: string, rows: Row[]) {
  const normalized = normalizeReportType(type);
  if (normalized === 'maintenance') return `This maintenance evidence snapshot contains ${rows.length} maintenance events for repair history, downtime, service cost, and recurring failure review.`;
  if (normalized === 'pm') return `This PM compliance snapshot contains ${rows.length} scheduled task rows, separating completed evidence from skipped, deferred, overdue, and active work.`;
  if (normalized === 'calibration') return `This calibration snapshot contains ${rows.length} calibration records with due dates, failed or adjusted results, and safety follow-up evidence.`;
  if (normalized === 'replacement-planning') return `This replacement planning snapshot contains ${rows.length} ranked assets with RPI component scores and lifecycle evidence.`;
  if (normalized === 'procurement-pipeline') return `This procurement snapshot contains ${rows.length} requests across review, order, transit, delivery, and delay states.`;
  return `This report contains ${rows.length} operational evidence rows from the source tables used by BMERMS workflows.`;
}

function getReportConfig(type: string): ReportConfig | null {
  const normalizedType = normalizeReportType(type);

  switch (normalizedType) {
    case 'equipment':
      return {
        title: 'Equipment Report',
        description: 'Complete listing of all equipment assets',
        filterDefs: ['department', 'category', 'status'],
        fetchData: reportsService.getEquipmentReport,
        columns: [
          { key: 'asset_code', header: 'Asset Code', sortable: true },
          { key: 'name', header: 'Name', sortable: true },
          { key: 'serial_number', header: 'Serial #' },
          {
            key: 'department',
            header: 'Department',
            render: (row: Row) => {
              const dept = row.departments as { name: string } | null;
              return dept?.name || '—';
            },
          },
          {
            key: 'category',
            header: 'Category',
            render: (row: Row) => {
              const cat = row.equipment_categories as { name: string } | null;
              return cat?.name || '—';
            },
          },
          {
            key: 'condition',
            header: 'Condition',
            render: (row: Row) => (
              <Badge variant={statusVariant[row.condition as string] || 'default'}>
                {formatLabel(row.condition as string)}
              </Badge>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (row: Row) => (
              <Badge variant={statusVariant[row.status as string] || 'default'}>
                {formatLabel(row.status as string)}
              </Badge>
            ),
          },
          {
            key: 'purchase_cost',
            header: 'Purchase Cost',
            render: (row: Row) =>
              row.purchase_cost != null ? `$${(row.purchase_cost as number).toLocaleString()}` : '—',
          },
        ],
      };

    case 'maintenance':
      return {
        title: 'Maintenance History Report',
        description: 'All maintenance events and repair history',
        filterDefs: ['date_range'],
        fetchData: reportsService.getMaintenanceReport,
        columns: [
          {
            key: 'asset',
            header: 'Asset',
            render: (row: Row) => {
              const asset = row.equipment_assets as { asset_code: string; name: string } | null;
              return asset ? `${asset.asset_code} — ${asset.name}` : '—';
            },
          },
          {
            key: 'event_type',
            header: 'Type',
            render: (row: Row) => (
              <Badge variant="info">{formatLabel(row.event_type as string)}</Badge>
            ),
          },
          {
            key: 'failure_date',
            header: 'Failure Date',
            sortable: true,
            render: (row: Row) =>
              row.failure_date ? new Date(row.failure_date as string).toLocaleDateString() : '—',
          },
          {
            key: 'repair_duration_hours',
            header: 'Repair Hours',
            render: (row: Row) =>
              row.repair_duration_hours != null ? `${row.repair_duration_hours}h` : '—',
          },
          { key: 'action_taken', header: 'Action Taken' },
          {
            key: 'service_cost',
            header: 'Cost',
            render: (row: Row) =>
              row.service_cost != null ? `$${(row.service_cost as number).toFixed(2)}` : '—',
          },
          {
            key: 'completion_date',
            header: 'Completed',
            sortable: true,
            render: (row: Row) =>
              row.completion_date ? new Date(row.completion_date as string).toLocaleDateString() : '—',
          },
        ],
      };

    case 'pm':
      return {
        title: 'PM Completion Report',
        description: 'Preventive maintenance schedule and completion status',
        filterDefs: ['status', 'date_range'],
        fetchData: reportsService.getPMReport,
        columns: [
          {
            key: 'asset',
            header: 'Asset',
            render: (row: Row) => {
              const asset = row.equipment_assets as { asset_code: string; name: string } | null;
              return asset ? `${asset.asset_code} — ${asset.name}` : '—';
            },
          },
          {
            key: 'plan',
            header: 'PM Plan',
            render: (row: Row) => {
              const plan = row.pm_plans as { name: string } | null;
              return plan?.name || '—';
            },
          },
          {
            key: 'scheduled_date',
            header: 'Scheduled Date',
            sortable: true,
            render: (row: Row) => new Date(row.scheduled_date as string).toLocaleDateString(),
          },
          {
            key: 'status',
            header: 'Status',
            render: (row: Row) => (
              <Badge variant={statusVariant[row.status as string] || 'default'}>
                {formatLabel(row.status as string)}
              </Badge>
            ),
          },
          {
            key: 'assigned_to',
            header: 'Assigned To',
            render: (row: Row) => {
              const relation = row.assigned_to_profile as { full_name: string } | { full_name: string }[] | null;
              const profile = Array.isArray(relation) ? relation[0] : relation;
              return profile?.full_name || '—';
            },
          },
        ],
      };

    case 'calibration':
      return {
        title: 'Calibration Report',
        description: 'Calibration records and results for all equipment',
        filterDefs: ['date_range'],
        fetchData: reportsService.getCalibrationReport,
        columns: [
          {
            key: 'asset',
            header: 'Asset',
            render: (row: Row) => {
              const asset = row.equipment_assets as { asset_code: string; name: string } | null;
              return asset ? `${asset.asset_code} — ${asset.name}` : '—';
            },
          },
          {
            key: 'type',
            header: 'Type',
            render: (row: Row) => {
              const type = row.calibration_types as { name: string } | null;
              return type?.name || '—';
            },
          },
          {
            key: 'calibration_date',
            header: 'Date',
            sortable: true,
            render: (row: Row) => new Date(row.calibration_date as string).toLocaleDateString(),
          },
          {
            key: 'result',
            header: 'Result',
            render: (row: Row) => (
              <Badge variant={resultVariant[row.result as string] || 'default'}>
                {formatLabel(row.result as string)}
              </Badge>
            ),
          },
          {
            key: 'next_due_date',
            header: 'Next Due',
            sortable: true,
            render: (row: Row) =>
              row.next_due_date ? new Date(row.next_due_date as string).toLocaleDateString() : '—',
          },
          { key: 'calibrated_by', header: 'Calibrated By' },
        ],
      };

    case 'training':
      return {
        title: 'Training Report',
        description: 'Training sessions and attendance records',
        filterDefs: ['category', 'date_range'],
        fetchData: reportsService.getTrainingReport,
        columns: [
          { key: 'title', header: 'Session', sortable: true },
          { key: 'trainer', header: 'Trainer' },
          {
            key: 'training_date',
            header: 'Date',
            sortable: true,
            render: (row: Row) => new Date(row.training_date as string).toLocaleDateString(),
          },
          {
            key: 'duration_hours',
            header: 'Duration',
            render: (row: Row) =>
              row.duration_hours ? `${row.duration_hours}h` : '—',
          },
          {
            key: 'attendees',
            header: 'Attendees',
            render: (row: Row) => {
              const records = row.staff_training_records as unknown[];
              return Array.isArray(records) ? records.length : 0;
            },
          },
          { key: 'location', header: 'Location' },
        ],
      };

    case 'spare-parts':
      return {
        title: 'Spare Parts Usage Report',
        description: 'Inventory levels and consumption analysis',
        filterDefs: ['category'],
        fetchData: reportsService.getSparePartsReport,
        columns: [
          { key: 'part_code', header: 'Part Code', sortable: true },
          { key: 'name', header: 'Name', sortable: true },
          { key: 'category', header: 'Category' },
          { key: 'current_stock', header: 'Stock', sortable: true },
          { key: 'reorder_level', header: 'Reorder Level' },
          {
            key: 'unit_cost',
            header: 'Unit Cost',
            render: (row: Row) =>
              row.unit_cost != null ? `$${(row.unit_cost as number).toFixed(2)}` : '—',
          },
          {
            key: 'stock_value',
            header: 'Stock Value',
            render: (row: Row) => {
              const stock = row.current_stock as number;
              const cost = row.unit_cost as number | null;
              return cost != null ? `$${(stock * cost).toFixed(2)}` : '—';
            },
          },
        ],
      };

    case 'disposal':
      return {
        title: 'Disposal Report',
        description: 'Equipment disposal requests and completed disposals',
        filterDefs: ['status', 'date_range'],
        fetchData: reportsService.getDisposalReport,
        columns: [
          { key: 'request_number', header: 'Request #', sortable: true },
          {
            key: 'asset',
            header: 'Asset',
            render: (row: Row) => {
              const asset = row.equipment_assets as { asset_code: string; name: string } | null;
              return asset ? `${asset.asset_code} — ${asset.name}` : '—';
            },
          },
          {
            key: 'disposal_method_proposed',
            header: 'Method',
            render: (row: Row) =>
              row.disposal_method_proposed ? formatLabel(row.disposal_method_proposed as string) : '—',
          },
          {
            key: 'status',
            header: 'Status',
            render: (row: Row) => (
              <Badge variant={statusVariant[row.status as string] || 'default'}>
                {formatLabel(row.status as string)}
              </Badge>
            ),
          },
          {
            key: 'disposal_value',
            header: 'Value',
            render: (row: Row) => {
              const disposed = row.disposed_assets as { disposal_value: number }[] | null;
              const val = disposed?.[0]?.disposal_value;
              return val != null ? `$${val.toFixed(2)}` : '—';
            },
          },
          {
            key: 'created_at',
            header: 'Date',
            sortable: true,
            render: (row: Row) => new Date(row.created_at as string).toLocaleDateString(),
          },
        ],
      };

    case 'work-orders':
      return {
        title: 'Work Order Report',
        description: 'Technical execution report for open, assigned, in-progress, on-hold, completed, and vendor work orders',
        filterDefs: ['status', 'date_range'],
        fetchData: reportsService.getWorkOrderReport,
        columns: [
          { key: 'work_order_number', header: 'WO #', sortable: true },
          {
            key: 'asset',
            header: 'Asset',
            render: (row: Row) => {
              const asset = row.equipment_assets as { asset_code: string; name: string } | null;
              return asset ? `${asset.asset_code} — ${asset.name}` : '—';
            },
          },
          {
            key: 'priority',
            header: 'Priority',
            render: (row: Row) => <Badge variant={row.priority === 'critical' ? 'error' : row.priority === 'high' ? 'warning' : 'info'}>{formatLabel(row.priority as string)}</Badge>,
          },
          {
            key: 'status',
            header: 'Status',
            render: (row: Row) => <Badge variant={statusVariant[row.status as string] || 'default'}>{formatLabel(row.status as string)}</Badge>,
          },
          {
            key: 'assigned_to',
            header: 'Assigned To',
            render: (row: Row) => {
              const profile = row.profiles as { full_name?: string } | null;
              return profile?.full_name ?? 'Unassigned';
            },
          },
          {
            key: 'created_at',
            header: 'Created',
            sortable: true,
            render: (row: Row) => new Date(row.created_at as string).toLocaleDateString(),
          },
          {
            key: 'completed_at',
            header: 'Completed',
            render: (row: Row) => row.completed_at ? new Date(row.completed_at as string).toLocaleDateString() : '—',
          },
        ],
      };

    case 'procurement-pipeline':
      return {
        title: 'Procurement Pipeline Report',
        description: 'Procurement request pipeline with priority, status, expected delivery, and contextual justification',
        filterDefs: ['status', 'date_range'],
        fetchData: reportsService.getProcurementReport,
        columns: [
          { key: 'request_number', header: 'Request #', sortable: true },
          { key: 'title', header: 'Title', sortable: true },
          {
            key: 'priority',
            header: 'Priority',
            render: (row: Row) => <Badge variant={row.priority === 'critical' ? 'error' : row.priority === 'high' ? 'warning' : 'info'}>{formatLabel(row.priority as string)}</Badge>,
          },
          {
            key: 'status',
            header: 'Status',
            render: (row: Row) => <Badge variant="purple">{formatLabel(row.status as string)}</Badge>,
          },
          {
            key: 'expected_delivery_date',
            header: 'Expected Delivery',
            render: (row: Row) => row.expected_delivery_date ? new Date(row.expected_delivery_date as string).toLocaleDateString() : 'TBD',
          },
          { key: 'justification', header: 'Justification' },
        ],
      };

    case 'replacement-planning':
      return {
        title: 'Replacement Planning Report',
        description: 'Replacement priority ranking with RPI component scores and generated justification',
        filterDefs: [],
        fetchData: () => reportsService.getReplacementReport(),
        columns: [
          { key: 'rank', header: 'Rank', sortable: true },
          {
            key: 'asset',
            header: 'Asset',
            render: (row: Row) => {
              const asset = row.equipment_assets as { asset_code: string; name: string } | null;
              return asset ? `${asset.asset_code} — ${asset.name}` : '—';
            },
          },
          {
            key: 'replacement_priority_index',
            header: 'RPI',
            render: (row: Row) => row.replacement_priority_index == null ? '—' : `${Math.round(Number(row.replacement_priority_index) * 100)}/100`,
          },
          { key: 'failure_score', header: 'Failure' },
          { key: 'availability_score', header: 'Availability' },
          { key: 'maintenance_burden_score', header: 'Maintenance' },
          { key: 'spare_part_score', header: 'Spare Support' },
          { key: 'risk_score', header: 'Risk' },
          { key: 'justification', header: 'Justification' },
        ],
      };

    case 'risk-fmea':
      return {
        title: 'Risk and FMEA Report',
        description: 'FMEA risk score report with severity, occurrence, detectability, RPN, risk band, and explanation',
        filterDefs: [],
        fetchData: () => reportsService.getRiskFmeaReport(),
        columns: [
          {
            key: 'asset',
            header: 'Asset',
            render: (row: Row) => {
              const asset = row.equipment_assets as { asset_code: string; name: string } | null;
              return asset ? `${asset.asset_code} — ${asset.name}` : '—';
            },
          },
          { key: 'severity', header: 'S', sortable: true },
          { key: 'occurrence', header: 'O', sortable: true },
          { key: 'detectability', header: 'D', sortable: true },
          { key: 'rpn', header: 'RPN', sortable: true },
          {
            key: 'risk_level',
            header: 'Risk Band',
            render: (row: Row) => <Badge variant={statusVariant[row.risk_level as string] || 'default'}>{formatLabel(row.risk_level as string)}</Badge>,
          },
          { key: 'assignment_method', header: 'Method' },
          { key: 'explanation', header: 'Explanation' },
        ],
      };

    case 'audit-security':
      return {
        title: 'Audit / Security Report',
        description: 'Audit evidence for security, roles, settings, equipment, and workflow changes',
        filterDefs: ['date_range'],
        fetchData: reportsService.getAuditSecurityReport,
        columns: [
          {
            key: 'created_at',
            header: 'Timestamp',
            sortable: true,
            render: (row: Row) => new Date(row.created_at as string).toLocaleString(),
          },
          {
            key: 'actor',
            header: 'Actor',
            render: (row: Row) => {
              const profile = row.profiles as { full_name?: string; email?: string } | null;
              return profile?.full_name ?? profile?.email ?? 'System / unknown';
            },
          },
          { key: 'action', header: 'Action' },
          { key: 'entity_type', header: 'Entity' },
          { key: 'entity_id', header: 'Record' },
        ],
      };

    default:
      return null;
  }
}

export default function ReportTypePage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const reportType = params.type as string;
  const effectiveReportType = normalizeReportType(reportType);

  const [data, setData] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<{ value: string; label: string }[]>([]);
  const [categoriesList, setCategoriesList] = useState<{ value: string; label: string }[]>([]);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [generatedAt, setGeneratedAt] = useState(() => new Date().toISOString());
  const [refreshStatus, setRefreshStatus] = useState('pending');

  const config = useMemo(() => getReportConfig(reportType), [reportType]);

  const loadReferenceData = useCallback(async () => {
    try {
      const [deptRes, catRes] = await Promise.all([
        settingsService.getAll('departments'),
        settingsService.getAll('equipment_categories'),
      ]);
      setDepartments(
        (deptRes.data || []).map((d: Record<string, unknown>) => ({
          value: d.id as string,
          label: d.name as string,
        }))
      );
      setCategoriesList(
        (catRes.data || []).map((c: Record<string, unknown>) => ({
          value: c.id as string,
          label: c.name as string,
        }))
      );
    } catch {
      // Non-critical; filters just won't be populated
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    try {
      const snapshot = await prepareReportSnapshotAction(reportType);
      if (snapshot.success && snapshot.data) {
        setGeneratedAt(snapshot.data.generatedAt);
        setRefreshStatus(snapshot.data.refreshStatus);
      } else {
        setGeneratedAt(new Date().toISOString());
        setRefreshStatus(snapshot.error ? `warning: ${snapshot.error}` : 'warning: refresh unavailable');
      }
      const filters: ReportFilters = {};
      if (filterValues.department_id) filters.department_id = filterValues.department_id;
      if (filterValues.category_id) filters.category_id = filterValues.category_id;
      if (filterValues.status) filters.status = filterValues.status;
      if (filterValues.date_from) filters.date_from = filterValues.date_from;
      if (filterValues.date_to) filters.date_to = filterValues.date_to;

      const { data: result, error } = await config.fetchData(filters);
      if (error) throw error;
      setData((result || []) as Row[]);
    } catch {
      toast('error', 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [config, filterValues, reportType, toast]);

  useEffect(() => { loadReferenceData(); }, [loadReferenceData]);
  useEffect(() => { loadData(); }, [loadData]);

  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg font-medium text-gray-900 dark:text-white">Report type not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/reports')}>
          <ArrowLeft className="h-4 w-4" />
          Back to Reports
        </Button>
      </div>
    );
  }

  const pmStatusOptions = [
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'completed', label: 'Completed' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'skipped', label: 'Skipped' },
    { value: 'in_progress', label: 'In Progress' },
  ];

  const disposalStatusOptions = [
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'completed', label: 'Completed' },
  ];

  const equipmentStatusOptions = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'disposed', label: 'Disposed' },
    { value: 'in_storage', label: 'In Storage' },
  ];
  const workOrderStatusOptions = [
    { value: 'open', label: 'Open' },
    { value: 'assigned', label: 'Assigned' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'on_hold', label: 'On Hold' },
    { value: 'completed', label: 'Completed' },
    { value: 'canceled', label: 'Canceled' },
  ];
  const procurementStatusOptions = [
    { value: 'requested', label: 'Requested' },
    { value: 'approved', label: 'Approved' },
    { value: 'ordered', label: 'Ordered' },
    { value: 'in_transit', label: 'In Transit' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'canceled', label: 'Canceled' },
  ];

  const filterDefs = config.filterDefs.flatMap((f) => {
    switch (f) {
      case 'department':
        return [{ key: 'department_id', label: 'Department', options: departments }];
      case 'category':
        return [{ key: 'category_id', label: 'Category', options: categoriesList }];
      case 'status':
        return [{
          key: 'status',
          label: 'Status',
          options: effectiveReportType === 'pm' ? pmStatusOptions
            : effectiveReportType === 'disposal' ? disposalStatusOptions
            : effectiveReportType === 'equipment' ? equipmentStatusOptions
            : effectiveReportType === 'work-orders' ? workOrderStatusOptions
            : effectiveReportType === 'procurement-pipeline' ? procurementStatusOptions
            : [],
        }];
      case 'date_range':
        return [];
      default:
        return [];
    }
  });

  const handleFilterChange = (key: string, value: string) => {
    setFilterValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleFilterReset = () => {
    setFilterValues({});
  };

  const handleExport = () => {
    const result = exportToCSV(data, config.columns, reportType);
    if (!result.success) {
      toast('warning', result.error ?? 'No rows to export');
      return;
    }
    toast('success', 'Report exported as CSV');
  };

  const handlePdfExport = () => {
    const result = exportToPDF({
      data,
      columns: config.columns,
      filename: reportType,
      title: config.title,
      filters: filterValues,
    });
    if (!result.success) {
      toast('warning', result.error ?? 'No rows to export');
      return;
    }
    toast('success', 'Report exported as PDF');
  };

  const handlePrint = () => {
    window.print();
  };

  const showDateFilters = config.filterDefs.includes('date_range');
  const statusCounts = data.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.status ?? row.condition ?? row.result ?? row.priority ?? 'record');
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const statusBreakdown = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topBreakdownTotal = Math.max(1, ...statusBreakdown.map(([, count]) => count));

  return (
    <div>
      <PageHeader
        title={config.title}
        description={config.description}
        breadcrumbs={[
          { label: 'Reports', href: '/reports' },
          { label: config.title },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={handlePdfExport}>
              <Download className="h-4 w-4" />
              Export PDF
            </Button>
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4" />
              Print
            </Button>
          </div>
        }
      />

      <section className="mb-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">Executive Summary</h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{summarizeReport(reportType, data)}</p>
            <p className="mt-2 text-sm text-[var(--text-muted)]">This report represents a system snapshot generated at {new Date(generatedAt).toLocaleString()}. Operational metrics were refreshed before report generation when the current role was permitted to run the safe snapshot refresh.</p>
          </div>
          <Badge variant={refreshStatus.startsWith('warning') ? 'warning' : 'success'}>{refreshStatus.startsWith('warning') ? 'Freshness warning' : 'Snapshot refreshed'}</Badge>
        </div>
      </section>

      <section className="mb-6 grid gap-3 md:grid-cols-3">
        <div className="panel-surface rounded-lg p-4">
          <p className="text-sm text-[var(--text-muted)]">Rows in evidence set</p>
          <p className="mt-1 text-2xl font-bold text-[var(--foreground)]">{loading ? '…' : data.length}</p>
        </div>
        <div className="panel-surface rounded-lg p-4">
          <p className="text-sm text-[var(--text-muted)]">Export status</p>
          <p className="mt-1 text-lg font-semibold text-[var(--foreground)]">CSV/PDF ready</p>
        </div>
        <div className="panel-surface rounded-lg p-4">
          <p className="text-sm text-[var(--text-muted)]">Generated at</p>
          <p className="mt-1 text-lg font-semibold text-[var(--foreground)]">{new Date(generatedAt).toLocaleString()}</p>
        </div>
      </section>

      {statusBreakdown.length > 0 && (
        <section className="mb-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
          <h2 className="text-base font-semibold text-[var(--foreground)]">Visual Summary</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {statusBreakdown.map(([label, count]) => (
              <div key={label} className="rounded-lg border border-[var(--border-subtle)] p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-[var(--foreground)]">{formatLabel(label)}</span>
                  <span className="text-[var(--text-muted)]">{count}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-[var(--surface-3)]">
                  <div className="h-2 rounded-full bg-[var(--brand)]" style={{ width: `${Math.max(8, (count / topBreakdownTotal) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mb-6 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
        <h2 className="text-base font-semibold text-[var(--foreground)]">Methodology</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{methodologyFor(reportType)}</p>
        {refreshStatus.startsWith('warning') && <p className="mt-2 text-sm text-amber-300">Data freshness note: {refreshStatus}</p>}
      </section>

      <div className="mb-6 space-y-4">
        {(filterDefs.length > 0 || showDateFilters) && (
          <div className="flex flex-wrap items-end gap-4">
            {filterDefs.length > 0 && (
              <FilterBar
                filters={filterDefs}
                values={filterValues}
                onChange={handleFilterChange}
                onReset={handleFilterReset}
              />
            )}
            {showDateFilters && (
              <div className="flex items-end gap-3">
                <div className="w-44">
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">From</label>
                  <input
                    type="date"
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                    value={filterValues.date_from || ''}
                    onChange={(e) => handleFilterChange('date_from', e.target.value)}
                  />
                </div>
                <div className="w-44">
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">To</label>
                  <input
                    type="date"
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                    value={filterValues.date_to || ''}
                    onChange={(e) => handleFilterChange('date_to', e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="text-sm text-gray-500 dark:text-gray-400">
          {loading ? 'Loading...' : `${data.length} record${data.length !== 1 ? 's' : ''} found`}
        </div>
      </div>

      <DataTable
        columns={config.columns}
        data={data}
        loading={loading}
        searchPlaceholder={`Search ${config.title.toLowerCase()}...`}
        emptyMessage="No data found for the selected filters"
      />
    </div>
  );
}
