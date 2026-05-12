'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, PackagePlus, PackageMinus, AlertTriangle, Boxes, ClipboardList, DollarSign, Wrench } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Tabs from '@/components/ui/Tabs';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import StatCard from '@/components/ui/StatCard';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import Table from '@/components/ui/Table';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import {
  getSpareParts,
  getLowStockParts,
} from '@/services/spare-parts.service';
import { getProcurementPipeline } from '@/services/procurement.service';
import { createSparePartAction, createStockIssueAction, createStockReceiptAction } from '@/actions/spare-parts.actions';
import { createClient } from '@/lib/supabase/client';
import { useRole } from '@/hooks/useRole';
import { procurementDetail } from '@/app/(dashboard)/command/_lib/command-center-routes';

type PartRow = Record<string, unknown>;
type ReceiptRow = Record<string, unknown>;
type IssueRow = Record<string, unknown>;
type LowStockRow = Record<string, unknown>;
type SpareTab = 'catalog' | 'lowstock' | 'blockers' | 'receipts' | 'issues';
type SpareFilter = 'all' | 'low-stock' | 'stockout' | 'blockers' | 'recent-received' | 'recent-issued' | 'pending-procurement' | 'high-cost' | 'ready-to-issue' | 'no-procurement' | 'with-procurement';

function normalizeSpareTab(value: string | null): SpareTab | '' {
  if (value === 'catalog' || value === 'receipts' || value === 'issues' || value === 'blockers') return value;
  if (value === 'lowstock' || value === 'low-stock') return 'lowstock';
  return '';
}

export default function SparePartsPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const { canManageParts, primaryRole } = useRole();
  const [parts, setParts] = useState<PartRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [procurementRows, setProcurementRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<SpareTab | ''>(() => normalizeSpareTab(searchParams.get('tab')));
  const [activeFilter, setActiveFilter] = useState<SpareFilter>(() => {
    const requested = searchParams.get('filter');
    if (requested === 'low-stock') return 'low-stock';
    if (requested === 'blockers') return 'blockers';
    if (requested === 'stockout') return 'stockout';
    return 'all';
  });

  const [addPartOpen, setAddPartOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);

  // Add Part form
  const [partCode, setPartCode] = useState('');
  const [partName, setPartName] = useState('');
  const [partCategory, setPartCategory] = useState('');
  const [partUnit, setPartUnit] = useState('pcs');
  const [partReorderLevel, setPartReorderLevel] = useState('');
  const [partUnitCost, setPartUnitCost] = useState('');

  // Receipt form
  const [recPartId, setRecPartId] = useState('');
  const [recQuantity, setRecQuantity] = useState('');
  const [recSupplier, setRecSupplier] = useState('');
  const [recInvoice, setRecInvoice] = useState('');
  const [recUnitCost, setRecUnitCost] = useState('');
  const [recNotes, setRecNotes] = useState('');

  // Issue form
  const [issPartId, setIssPartId] = useState('');
  const [issQuantity, setIssQuantity] = useState('');
  const [issDepartment, setIssDepartment] = useState('');
  const [issNotes, setIssNotes] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const [partsRes, receiptsRes, issuesRes, lowRes] = await Promise.all([
        getSpareParts(),
        supabase
          .from('stock_receipts')
          .select('id, part_id, quantity, received_by, received_date, supplier_id, invoice_ref, unit_cost, notes, created_at, spare_parts(id, part_code, name)')
          .order('received_date', { ascending: false }),
        supabase
          .from('stock_issues')
          .select('id, part_id, quantity, issued_to_event_id, issued_by, issue_date, department_id, notes, created_at, spare_parts(id, part_code, name), departments(id, name)')
          .order('issue_date', { ascending: false }),
        getLowStockParts(),
      ]);
      const procurementRes = await getProcurementPipeline();

      setParts((partsRes.data || []) as PartRow[]);
      setReceipts((receiptsRes.data || []) as ReceiptRow[]);
      setIssues((issuesRes.data || []) as IssueRow[]);
      setLowStock((lowRes.data || []) as LowStockRow[]);
      setProcurementRows((procurementRes.data || []) as Record<string, unknown>[]);
    } catch {
      toast('error', 'Failed to load spare parts data');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const partId = searchParams.get('partId') ?? searchParams.get('sparePartId');
    if (partId) {
      setRecPartId(partId);
      setIssPartId(partId);
    }
    if (searchParams.get('action') === 'issue') setIssueOpen(true);
    if (searchParams.get('action') === 'receive') setReceiptOpen(true);
  }, [searchParams]);

  const handleAddPart = async () => {
    if (!partCode || !partName) {
      toast('warning', 'Part code and name are required');
      return;
    }
    setSubmitting(true);
    try {
      const result = await createSparePartAction({
        part_code: partCode,
        name: partName,
        description: null,
        category: partCategory || null,
        unit: partUnit,
        reorder_level: parseInt(partReorderLevel) || 0,
        current_stock: 0,
        unit_cost: partUnitCost ? parseFloat(partUnitCost) : null,
        compatible_categories: [],
        is_active: true,
      });
      if (!result.success) throw new Error(result.error ?? 'Failed to add spare part');
      toast('success', 'Spare part added');
      setAddPartOpen(false);
      resetPartForm();
      loadData();
    } catch {
      toast('error', 'Failed to add spare part');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceipt = async () => {
    if (!recPartId || !recQuantity) {
      toast('warning', 'Part and quantity are required');
      return;
    }
    setSubmitting(true);
    try {
      const result = await createStockReceiptAction({
        part_id: recPartId,
        quantity: parseInt(recQuantity),
        received_by: null,
        received_date: new Date().toISOString().split('T')[0],
        supplier_id: recSupplier || null,
        invoice_ref: recInvoice || null,
        unit_cost: recUnitCost ? parseFloat(recUnitCost) : null,
        notes: recNotes || null,
      });
      if (!result.success) throw new Error(result.error ?? 'Failed to record receipt');
      toast('success', 'Stock receipt recorded');
      setReceiptOpen(false);
      resetReceiptForm();
      loadData();
    } catch {
      toast('error', 'Failed to record receipt');
    } finally {
      setSubmitting(false);
    }
  };

  const handleIssue = async () => {
    if (!issPartId || !issQuantity) {
      toast('warning', 'Part and quantity are required');
      return;
    }
    setSubmitting(true);
    try {
      const result = await createStockIssueAction({
        part_id: issPartId,
        quantity: parseInt(issQuantity),
        issued_to_event_id: null,
        issued_by: null,
        issue_date: new Date().toISOString().split('T')[0],
        department_id: issDepartment || null,
        notes: issNotes || null,
      });
      if (!result.success) throw new Error(result.error ?? 'Failed to record issue');
      toast('success', 'Stock issue recorded');
      setIssueOpen(false);
      resetIssueForm();
      loadData();
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'message' in err
        ? (err as { message: string }).message
        : 'Failed to record issue';
      toast('error', message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetPartForm = () => {
    setPartCode(''); setPartName(''); setPartCategory(''); setPartUnit('pcs');
    setPartReorderLevel(''); setPartUnitCost('');
  };
  const resetReceiptForm = () => {
    setRecPartId(''); setRecQuantity(''); setRecSupplier(''); setRecInvoice('');
    setRecUnitCost(''); setRecNotes('');
  };
  const resetIssueForm = () => {
    setIssPartId(''); setIssQuantity(''); setIssDepartment(''); setIssNotes('');
  };

  const partOptions = parts.map((p) => ({
    value: p.id as string,
    label: `${p.part_code} — ${p.name}`,
  }));

  function openProcurementForPart(row: Record<string, unknown>) {
    const haystack = `${row.part_code ?? ''} ${row.name ?? ''}`.toLowerCase();
    return procurementRows.find((request) => {
      if (['delivered', 'canceled'].includes(String(request.status ?? ''))) return false;
      const text = `${request.title ?? ''} ${request.justification ?? ''}`.toLowerCase();
      return haystack.split(/\s+/).filter(Boolean).some((token) => token.length > 3 && text.includes(token));
    });
  }

  function procurementParams(row: Record<string, unknown>, stock: number, reorder: number) {
    return new URLSearchParams({
      source: stock <= 0 ? 'spare-parts-stockout' : 'spare-parts-low-stock',
      partId: row.id as string,
      itemName: String(row.name ?? row.part_code ?? 'spare part'),
      currentStock: String(stock),
      reorderLevel: String(reorder),
      suggestedQuantity: String(Math.max(reorder * 2 - stock, 1)),
      reason: stock <= 0 ? 'Stockout blocks maintenance readiness' : 'Stock below reorder level',
    });
  }

  function selectStockView(tab: SpareTab, filter: SpareFilter = 'all') {
    setActiveTab(tab);
    setActiveFilter(filter);
  }

  const catalogColumns = [
    { key: 'part_code', header: 'Part Code', sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    { key: 'category', header: 'Category', sortable: true },
    {
      key: 'current_stock',
      header: 'Stock',
      sortable: true,
      render: (row: PartRow) => {
        const stock = row.current_stock as number;
        const reorder = row.reorder_level as number;
        const isLow = stock <= reorder;
        return (
          <span className={isLow ? 'font-semibold text-red-600' : ''}>
            {stock}
            {isLow && <AlertTriangle className="ml-1 inline h-3.5 w-3.5" />}
          </span>
        );
      },
    },
    {
      key: 'stock_state',
      header: 'State',
      render: (row: PartRow) => {
        const stock = Number(row.current_stock ?? 0);
        const reorder = Number(row.reorder_level ?? 0);
        if (stock <= 0) return <Badge variant="error">Stockout</Badge>;
        if (stock <= reorder) return <Badge variant="warning">Low</Badge>;
        return <Badge variant="success">Normal</Badge>;
      },
    },
    {
      key: 'reorder_level',
      header: 'Reorder Level',
    },
    {
      key: 'unit_cost',
      header: 'Unit Cost',
      render: (row: PartRow) =>
        row.unit_cost != null ? `$${(row.unit_cost as number).toFixed(2)}` : '—',
    },
    {
      key: 'action',
      header: 'Action',
      render: (row: PartRow) => {
        const stock = Number(row.current_stock ?? 0);
        const reorder = Number(row.reorder_level ?? 0);
        if (stock <= reorder) {
          const existing = openProcurementForPart(row);
          if (existing?.id) {
            return <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={procurementDetail(existing.id as string)}>Track Procurement</Link>;
          }
          const params = procurementParams(row, stock, reorder);
          return <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={`/procurement/requests/new?${params.toString()}`}>{stock <= 0 ? 'Create Urgent Procurement' : 'Request Procurement'}</Link>;
        }
        return canManageParts ? (
          <button type="button" className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" onClick={() => { setIssPartId(row.id as string); setIssueOpen(true); }}>
            Issue Part
          </button>
        ) : <span className="text-xs text-[var(--text-muted)]">View</span>;
      },
    },
  ];

  const receiptColumns = [
    {
      key: 'part_name',
      header: 'Part',
      render: (row: ReceiptRow) => {
        const part = row.spare_parts as { part_code: string; name: string } | null;
        return part ? `${part.part_code} — ${part.name}` : '—';
      },
    },
    { key: 'quantity', header: 'Quantity', sortable: true },
    { key: 'invoice_ref', header: 'Invoice Ref' },
    {
      key: 'unit_cost',
      header: 'Unit Cost',
      render: (row: ReceiptRow) =>
        row.unit_cost != null ? `$${(row.unit_cost as number).toFixed(2)}` : '—',
    },
    {
      key: 'received_date',
      header: 'Date',
      sortable: true,
      render: (row: ReceiptRow) => new Date(row.received_date as string).toLocaleDateString(),
    },
    {
      key: 'action',
      header: 'Action',
      render: (row: ReceiptRow) => (
        <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={`/spare-parts?receiptId=${row.id as string}`}>
          View Receipt
        </Link>
      ),
    },
  ];

  const issueColumns = [
    {
      key: 'part_name',
      header: 'Part',
      render: (row: IssueRow) => {
        const part = row.spare_parts as { part_code: string; name: string } | null;
        return part ? `${part.part_code} — ${part.name}` : '—';
      },
    },
    { key: 'quantity', header: 'Quantity', sortable: true },
    {
      key: 'department',
      header: 'Issued To',
      render: (row: IssueRow) => {
        const dept = row.departments as { name: string } | null;
        return dept?.name || '—';
      },
    },
    {
      key: 'issue_date',
      header: 'Date',
      sortable: true,
      render: (row: IssueRow) => new Date(row.issue_date as string).toLocaleDateString(),
    },
    {
      key: 'action',
      header: 'Action',
      render: (row: IssueRow) => (
        <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={`/spare-parts?issueId=${row.id as string}`}>
          View Issue
        </Link>
      ),
    },
  ];

  const lowStockColumns = [
    { key: 'part_code', header: 'Part Code', sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    { key: 'category', header: 'Category' },
    {
      key: 'current_stock',
      header: 'Current Stock',
      render: (row: LowStockRow) => (
        <span className="font-semibold text-red-600">{row.current_stock as number}</span>
      ),
    },
    { key: 'reorder_level', header: 'Reorder Level' },
    {
      key: 'procurement_status',
      header: 'Procurement',
      render: (row: LowStockRow) => {
        const existing = openProcurementForPart(row);
        return existing ? <Badge variant="info">{String(existing.status ?? 'open').replace(/_/g, ' ')}</Badge> : <span className="text-[var(--text-muted)]">No open request</span>;
      },
    },
    {
      key: 'deficit',
      header: 'Deficit',
      render: (row: LowStockRow) => (
        <Badge variant="error">{row.deficit as number}</Badge>
      ),
    },
    {
      key: 'unit_cost',
      header: 'Unit Cost',
      render: (row: LowStockRow) =>
        row.unit_cost != null ? `$${(row.unit_cost as number).toFixed(2)}` : '—',
    },
    {
      key: 'action',
      header: 'Action',
      render: (row: LowStockRow) => {
        const stock = Number(row.current_stock ?? 0);
        const reorder = Number(row.reorder_level ?? 0);
        const existing = openProcurementForPart(row);
        if (existing?.id) {
          return <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={procurementDetail(existing.id as string)}>Track Procurement</Link>;
        }
        const params = procurementParams(row, stock, reorder);
        return <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={`/procurement/requests/new?${params.toString()}`}>{stock <= 0 ? 'Create Urgent Procurement' : 'Request Procurement'}</Link>;
      },
    },
  ];

  if (loading) return <PageLoader />;

  const stockouts = lowStock.filter((row) => Number(row.current_stock ?? 0) <= 0);
  const recentReceipts = receipts.filter((row) => {
    if (!row.received_date) return false;
    return Date.now() - new Date(row.received_date as string).getTime() <= 30 * 86_400_000;
  });
  const recentIssues = issues.filter((row) => {
    if (!row.issue_date) return false;
    return Date.now() - new Date(row.issue_date as string).getTime() <= 30 * 86_400_000;
  });
  const openProcurement = procurementRows.filter((row) => !['delivered', 'canceled'].includes(String(row.status ?? 'requested')));
  const highCostStock = parts.filter((row) => Number(row.current_stock ?? 0) * Number(row.unit_cost ?? 0) >= 1000);
  const lowStockNoProcurement = lowStock.filter((row) => !openProcurementForPart(row));
  const lowStockWithProcurement = lowStock.filter((row) => Boolean(openProcurementForPart(row)));
  const readyToIssue = parts.filter((row) => Number(row.current_stock ?? 0) > Number(row.reorder_level ?? 0));
  const sortedHighCost = [...parts].sort((a, b) => Number(b.unit_cost ?? 0) * Number(b.current_stock ?? 0) - Number(a.unit_cost ?? 0) * Number(a.current_stock ?? 0));
  const defaultTab: SpareTab = normalizeSpareTab(searchParams.get('tab')) || (stockouts.length > 0 ? 'blockers' : lowStock.length > 0 ? 'lowstock' : 'catalog');
  const selectedTab = activeTab || defaultTab;
  const selectedFilter = activeFilter;
  const filteredCatalog = selectedFilter === 'high-cost'
    ? sortedHighCost
    : selectedFilter === 'ready-to-issue'
      ? readyToIssue
      : parts;
  const filteredLowStock = selectedFilter === 'stockout' || selectedFilter === 'blockers'
    ? stockouts
    : selectedFilter === 'no-procurement'
      ? lowStockNoProcurement
      : selectedFilter === 'with-procurement'
        ? lowStockWithProcurement
        : lowStock;
  const filteredReceipts = selectedFilter === 'recent-received' ? recentReceipts : receipts;
  const filteredIssues = selectedFilter === 'recent-issued' ? recentIssues : issues;

  const tabs = [
    {
      id: 'catalog',
      label: 'Catalog',
      count: parts.length,
      content: (
        <DataTable
          columns={catalogColumns}
          data={filteredCatalog}
          searchPlaceholder="Search parts..."
          emptyMessage="No spare parts in catalog"
          actions={canManageParts ? (
            <Button onClick={() => setAddPartOpen(true)}>
              <Plus className="h-4 w-4" />
              Add Part
            </Button>
          ) : undefined}
        />
      ),
    },
    {
      id: 'receipts',
      label: 'Receipts',
      count: receipts.length,
      content: (
        <DataTable
          columns={receiptColumns}
          data={filteredReceipts}
          searchPlaceholder="Search receipts..."
          emptyMessage="No stock receipts recorded"
          actions={canManageParts ? (
            <Button onClick={() => setReceiptOpen(true)}>
              <PackagePlus className="h-4 w-4" />
              Record Receipt
            </Button>
          ) : undefined}
        />
      ),
    },
    {
      id: 'issues',
      label: 'Issues',
      count: issues.length,
      content: (
        <DataTable
          columns={issueColumns}
          data={filteredIssues}
          searchPlaceholder="Search issues..."
          emptyMessage="No stock issues recorded"
          actions={canManageParts ? (
            <Button onClick={() => setIssueOpen(true)}>
              <PackageMinus className="h-4 w-4" />
              Record Issue
            </Button>
          ) : undefined}
        />
      ),
    },
    {
      id: 'lowstock',
      label: 'Low Stock',
      count: lowStock.length,
      content: (
        <Table
          columns={lowStockColumns}
          data={filteredLowStock}
          emptyMessage="All parts are above reorder level"
        />
      ),
    },
    {
      id: 'blockers',
      label: 'Blockers',
      count: stockouts.length,
      content: (
        <Table
          columns={lowStockColumns}
          data={filteredLowStock.filter((row) => Number(row.current_stock ?? 0) <= 0)}
          emptyMessage="No stockout blockers found"
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Spare Parts"
        description="Stock-control and maintenance support center for availability, low stock, receipts, issues, and procurement blockers."
        actions={canManageParts ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setReceiptOpen(true)}><PackagePlus className="h-4 w-4" /> Receive</Button>
            <Button variant="outline" onClick={() => setIssueOpen(true)}><PackageMinus className="h-4 w-4" /> Issue</Button>
            <Button onClick={() => setAddPartOpen(true)}><Plus className="h-4 w-4" /> Add Part</Button>
          </div>
        ) : <Badge variant="info">{primaryRole === 'viewer' ? 'Read-only' : 'View access'}</Badge>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Parts" value={parts.length} icon={<Boxes className="h-6 w-6" />} color="blue" active={selectedTab === 'catalog' && selectedFilter === 'all'} onClick={() => selectStockView('catalog')} />
        <StatCard label="Low Stock" value={lowStock.length} icon={<AlertTriangle className="h-6 w-6" />} color="orange" active={selectedTab === 'lowstock' && selectedFilter === 'low-stock'} onClick={() => selectStockView('lowstock', 'low-stock')} />
        <StatCard label="Stockout" value={stockouts.length} icon={<AlertTriangle className="h-6 w-6" />} color="red" active={selectedFilter === 'stockout'} onClick={() => selectStockView('blockers', 'stockout')} />
        <StatCard label="Stockout Blockers" value={stockouts.length} icon={<Wrench className="h-6 w-6" />} color="purple" active={selectedFilter === 'blockers'} onClick={() => selectStockView('blockers', 'blockers')} />
        <StatCard label="Recently Received" value={recentReceipts.length} icon={<PackagePlus className="h-6 w-6" />} color="green" active={selectedFilter === 'recent-received'} onClick={() => selectStockView('receipts', 'recent-received')} />
        <StatCard label="Recently Issued" value={recentIssues.length} icon={<PackageMinus className="h-6 w-6" />} color="yellow" active={selectedFilter === 'recent-issued'} onClick={() => selectStockView('issues', 'recent-issued')} />
        <StatCard label="Pending Procurement" value={openProcurement.length} icon={<ClipboardList className="h-6 w-6" />} color="purple" active={selectedFilter === 'with-procurement'} onClick={() => selectStockView('lowstock', 'with-procurement')} />
        <StatCard label="High-Cost Stock" value={highCostStock.length} icon={<DollarSign className="h-6 w-6" />} color="gray" active={selectedFilter === 'high-cost'} onClick={() => selectStockView('catalog', 'high-cost')} />
      </div>

      <section className="panel-surface rounded-lg p-4">
        <h2 className="text-base font-semibold text-[var(--foreground)]">Stock Action Queue</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Stock blockers and low-stock rows reuse the same procurement check as the table, so open procurement is tracked instead of duplicated.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Stockout blocking work', count: stockouts.length, desc: 'Parts preventing work-order completion or readiness recovery.', action: 'Open Blocked Work Orders', onClick: () => selectStockView('blockers', 'blockers'), tone: 'text-red-300' },
            { label: 'Low stock, no procurement', count: lowStockNoProcurement.length, desc: 'Parts below reorder threshold without an open procurement trail.', action: 'Request Procurement', onClick: () => selectStockView('lowstock', 'no-procurement'), tone: 'text-orange-300' },
            { label: 'Low stock, procurement open', count: lowStockWithProcurement.length, desc: 'Parts already in the procurement pipeline.', action: 'Track Procurement', onClick: () => selectStockView('lowstock', 'with-procurement'), tone: 'text-violet-300' },
            { label: 'Ready to issue', count: readyToIssue.length, desc: 'Parts above reorder level and available for maintenance support.', action: 'Issue Part', onClick: () => selectStockView('catalog', 'ready-to-issue'), tone: 'text-emerald-300' },
          ].map((item) => (
            <button key={item.label} type="button" onClick={item.onClick} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 text-left transition hover:border-[var(--brand)]/50">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-[var(--foreground)]">{item.label}</p>
                <p className={`text-2xl font-bold ${item.tone}`}>{item.count}</p>
              </div>
              <p className="mt-2 text-xs text-[var(--text-muted)]">{item.desc}</p>
              <p className="mt-3 text-xs font-medium text-[var(--brand)]">{item.action}</p>
            </button>
          ))}
        </div>
      </section>

      <Tabs tabs={tabs} activeTab={selectedTab} defaultTab={defaultTab} onChange={(tabId) => { setActiveTab(tabId as SpareTab); setActiveFilter('all'); }} />

      {/* Add Part Modal */}
      <Modal
        open={addPartOpen}
        onClose={() => { setAddPartOpen(false); resetPartForm(); }}
        title="Add Spare Part"
        footer={
          <>
            <Button variant="outline" onClick={() => { setAddPartOpen(false); resetPartForm(); }}>Cancel</Button>
            <Button onClick={handleAddPart} loading={submitting}>Add Part</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Part Code *" value={partCode} onChange={(e) => setPartCode(e.target.value)} placeholder="e.g. SP-001" />
            <Input label="Name *" value={partName} onChange={(e) => setPartName(e.target.value)} placeholder="Part name" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input label="Category" value={partCategory} onChange={(e) => setPartCategory(e.target.value)} placeholder="e.g. Filters" />
            <Input label="Unit" value={partUnit} onChange={(e) => setPartUnit(e.target.value)} placeholder="e.g. pcs, m, kg" />
            <Input label="Unit Cost ($)" type="number" step="0.01" value={partUnitCost} onChange={(e) => setPartUnitCost(e.target.value)} />
          </div>
          <Input label="Reorder Level" type="number" value={partReorderLevel} onChange={(e) => setPartReorderLevel(e.target.value)} placeholder="Minimum stock threshold" />
        </div>
      </Modal>

      {/* Record Receipt Modal */}
      <Modal
        open={receiptOpen}
        onClose={() => { setReceiptOpen(false); resetReceiptForm(); }}
        title="Record Stock Receipt"
        footer={
          <>
            <Button variant="outline" onClick={() => { setReceiptOpen(false); resetReceiptForm(); }}>Cancel</Button>
            <Button onClick={handleReceipt} loading={submitting}>Record Receipt</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select label="Part *" options={partOptions} placeholder="Select part" value={recPartId} onChange={(e) => setRecPartId(e.target.value)} />
          <Input label="Quantity *" type="number" value={recQuantity} onChange={(e) => setRecQuantity(e.target.value)} />
          <Input label="Invoice Reference" value={recInvoice} onChange={(e) => setRecInvoice(e.target.value)} />
          <Input label="Unit Cost ($)" type="number" step="0.01" value={recUnitCost} onChange={(e) => setRecUnitCost(e.target.value)} />
          <Textarea label="Notes" value={recNotes} onChange={(e) => setRecNotes(e.target.value)} />
        </div>
      </Modal>

      {/* Record Issue Modal */}
      <Modal
        open={issueOpen}
        onClose={() => { setIssueOpen(false); resetIssueForm(); }}
        title="Record Stock Issue"
        footer={
          <>
            <Button variant="outline" onClick={() => { setIssueOpen(false); resetIssueForm(); }}>Cancel</Button>
            <Button onClick={handleIssue} loading={submitting}>Record Issue</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select label="Part *" options={partOptions} placeholder="Select part" value={issPartId} onChange={(e) => setIssPartId(e.target.value)} />
          <Input label="Quantity *" type="number" value={issQuantity} onChange={(e) => setIssQuantity(e.target.value)} />
          <Input label="Department" value={issDepartment} onChange={(e) => setIssDepartment(e.target.value)} placeholder="Department or purpose" />
          <Textarea label="Notes" value={issNotes} onChange={(e) => setIssNotes(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
