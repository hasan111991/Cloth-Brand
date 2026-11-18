import React, { useMemo, useState } from 'react';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { Download, Plus } from 'lucide-react';
import { db, handleFirestoreError, makeSafeId, OperationType } from '../lib/firebase';
import {
  currentMonthKey,
  DEFAULT_BONUS_TIERS,
  downloadCsv,
  formatDate,
  formatDateTime,
  formatPKR,
} from '../lib/format';
import { logAuditEvent } from '../services/businessService';
import {
  AbandonedCart,
  AuditLog,
  Campaign,
  CommissionRecord,
  Coupon,
  ExpenseRecord,
  InventoryBatch,
  Order,
  OrderFinancial,
  PaymentRecord,
  SalaryRecord,
  SalesmanProfile,
  SalesTarget,
  StaffInvite,
  Supplier,
  UserProfile,
  UserRole,
} from '../types';

export const AccountsReportsPanel: React.FC<{
  orders: Order[];
  financials: OrderFinancial[];
  expenses: ExpenseRecord[];
  salaries: SalaryRecord[];
  commissions: CommissionRecord[];
  payments: PaymentRecord[];
  suppliers: Supplier[];
  batches: InventoryBatch[];
  actor: UserProfile;
}> = ({
  orders,
  financials,
  expenses,
  salaries,
  commissions,
  payments,
  suppliers,
  batches,
  actor,
}) => {
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all' | 'custom'>('month');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 8) + '01');
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [expCat, setExpCat] = useState<ExpenseRecord['category']>('OPERATING');
  const [expDesc, setExpDesc] = useState('');
  const [expAmt, setExpAmt] = useState('');
  const [expDate, setExpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [savingExp, setSavingExp] = useState(false);

  const inRange = (iso: string) => {
    const day = (iso || '').slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (period === 'all') return true;
    if (period === 'today') return day === today;
    if (period === 'month') return day.startsWith(currentMonthKey());
    if (period === 'week') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return day >= d.toISOString().slice(0, 10);
    }
    return (!startDate || day >= startDate) && (!endDate || day <= endDate);
  };

  const metrics = useMemo(() => {
    const deliveredOrders = orders.filter((o) => o.status === 'DELIVERED' && inRange(o.createdAt));
    const deliveredIds = new Set(deliveredOrders.map((o) => o.id));
    const revenue = deliveredOrders.reduce((s, o) => s + Math.max(0, o.subtotal - o.discountAmount), 0);

    const matchingFin = financials.filter((f) => deliveredIds.has(f.orderId));
    const cogs = matchingFin.reduce((s, f) => s + (f.cogsTotal || 0), 0);
    const grossProfit = revenue - cogs;

    const periodExpenses = expenses
      .filter((e) => inRange(e.expenseDate || e.createdAt))
      .reduce((s, e) => s + e.amount, 0);

    const periodSalaries = salaries
      .filter((s) => s.status === 'PAID' && inRange(s.paidDate || s.createdAt))
      .reduce((sum, s) => sum + s.netPaid, 0);

    const periodCommissions = commissions
      .filter((c) => inRange(c.createdAt))
      .reduce((sum, c) => sum + c.amount, 0);

    const refundsTotal = orders
      .filter((o) => o.status === 'REFUNDED' && inRange(o.updatedAt))
      .reduce((sum, o) => sum + o.totalAmount, 0);

    const netProfit = grossProfit - periodExpenses - periodSalaries - periodCommissions - refundsTotal;

    const cashReceived = payments
      .filter((p) => ['VERIFIED', 'RECONCILED'].includes(p.status) && inRange(p.createdAt))
      .reduce((sum, p) => sum + p.amount, 0);

    const pendingCod = orders
      .filter(
        (o) =>
          o.paymentMethod === 'COD' &&
          !['CANCELLED', 'RETURNED', 'REFUNDED'].includes(o.status) &&
          !['RECONCILED', 'VERIFIED'].includes(o.paymentStatus)
      )
      .reduce((sum, o) => sum + o.totalAmount, 0);

    const supplierPayable = suppliers.reduce((sum, s) => sum + (s.outstandingPayable || 0), 0);
    const inventoryValuation = batches.reduce(
      (sum, b) => sum + Math.max(0, b.remainingQty) * b.purchaseCost,
      0
    );

    return {
      deliveredCount: deliveredOrders.length,
      revenue,
      cogs,
      grossProfit,
      periodExpenses,
      periodSalaries,
      periodCommissions,
      refundsTotal,
      netProfit,
      cashReceived,
      pendingCod,
      supplierPayable,
      inventoryValuation,
    };
  }, [orders, financials, expenses, salaries, commissions, payments, suppliers, batches, period, startDate, endDate]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(expAmt);
    if (!expDesc.trim() || !Number.isFinite(amount) || amount <= 0) return;
    setSavingExp(true);
    try {
      const id = makeSafeId(`exp_${Date.now()}`);
      const now = new Date().toISOString();
      await setDoc(doc(db, 'expenses', id), {
        category: expCat,
        description: expDesc.trim().slice(0, 300),
        amount,
        expenseDate: expDate,
        recordedBy: actor.uid,
        createdAt: now,
      });
      await logAuditEvent({
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'ADD_EXPENSE',
        entityType: 'expenses',
        entityId: id,
        details: `${expCat}: PKR ${amount} - ${expDesc}`,
      });
      setExpDesc('');
      setExpAmt('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'expenses');
    } finally {
      setSavingExp(false);
    }
  };

  const handleExportReport = () => {
    downloadCsv(
      `profit-loss-${period}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Metric', 'Amount (PKR)'],
      [
        ['Delivered Orders Count', metrics.deliveredCount],
        ['Delivered Sales Revenue (Net of Discounts)', metrics.revenue],
        ['Cost of Goods Sold (FIFO COGS)', metrics.cogs],
        ['Gross Profit', metrics.grossProfit],
        ['Operating Expenses', metrics.periodExpenses],
        ['Paid Salaries', metrics.periodSalaries],
        ['Sales Commissions', metrics.periodCommissions],
        ['Customer Refunds', metrics.refundsTotal],
        ['Net Profit', metrics.netProfit],
        ['Cash Received (Verified/Reconciled)', metrics.cashReceived],
        ['Pending COD Receivables', metrics.pendingCod],
        ['Supplier Payables', metrics.supplierPayable],
        ['Current Warehouse Inventory Valuation', metrics.inventoryValuation],
      ]
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          {(
            [
              { id: 'today', label: 'Today' },
              { id: 'week', label: 'Last 7 Days' },
              { id: 'month', label: 'This Month' },
              { id: 'all', label: 'All Time' },
              { id: 'custom', label: 'Custom' },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                period === p.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {period === 'custom' && (
            <>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              />
            </>
          )}
          <button
            type="button"
            onClick={handleExportReport}
            className="px-3.5 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg inline-flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Export P&amp;L CSV
          </button>
        </div>
      </div>

      {/* Separated Financial KPIs (Never double-counting inventory purchases as expenses) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Delivered Sales Revenue</p>
          <p className="text-xl font-semibold text-slate-900 mt-1 tabular-nums">
            {formatPKR(metrics.revenue)}
          </p>
          <p className="text-xs text-slate-500 mt-1">{metrics.deliveredCount} delivered orders</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">FIFO COGS (Delivered)</p>
          <p className="text-xl font-semibold text-slate-900 mt-1 tabular-nums">
            {formatPKR(metrics.cogs)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Historical batch cost snapshots</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Gross Profit</p>
          <p className="text-xl font-semibold text-emerald-700 mt-1 tabular-nums">
            {formatPKR(metrics.grossProfit)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Revenue minus FIFO COGS</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs text-slate-500">Net Profit</p>
          <p
            className={`text-xl font-semibold mt-1 tabular-nums ${
              metrics.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {formatPKR(metrics.netProfit)}
          </p>
          <p className="text-xs text-slate-500 mt-1">After expenses, salaries &amp; commissions</p>
        </div>
      </div>

      {/* Balance & Cash Flow Separation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Cash Received (Verified)</p>
          <p className="text-base font-semibold tabular-nums mt-1">{formatPKR(metrics.cashReceived)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Pending COD Receivables</p>
          <p className="text-base font-semibold tabular-nums mt-1 text-amber-700">
            {formatPKR(metrics.pendingCod)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Supplier Payables</p>
          <p className="text-base font-semibold tabular-nums mt-1 text-red-700">
            {formatPKR(metrics.supplierPayable)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Warehouse Inventory Value</p>
          <p className="text-base font-semibold tabular-nums mt-1">
            {formatPKR(metrics.inventoryValuation)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleAddExpense}
          className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold text-slate-900">Record Operating Expense</h3>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Category</label>
            <select
              value={expCat}
              onChange={(e) => setExpCat(e.target.value as ExpenseRecord['category'])}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="MARKETING">Marketing / Ads</option>
              <option value="PACKAGING">Packaging Materials</option>
              <option value="COURIER">Courier / Logistics</option>
              <option value="RENT">Rent &amp; Warehouse</option>
              <option value="UTILITIES">Electricity &amp; Utilities</option>
              <option value="OPERATING">General Operating</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Description</label>
            <input
              type="text"
              required
              value={expDesc}
              onChange={(e) => setExpDesc(e.target.value)}
              placeholder="e.g. Meta Ads weekly spend"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-600 mb-1">Amount (PKR)</label>
              <input
                type="number"
                required
                min={1}
                value={expAmt}
                onChange={(e) => setExpAmt(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Date</label>
              <input
                type="date"
                required
                value={expDate}
                onChange={(e) => setExpDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={savingExp}
            className="w-full py-2.5 text-xs font-medium bg-slate-900 text-white rounded-lg"
          >
            {savingExp ? 'Saving...' : 'Log Expense'}
          </button>
        </form>

        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center">
            <h3 className="text-sm font-semibold text-slate-900">
              Expense Ledger ({expenses.length})
            </h3>
            <span className="text-xs text-slate-500 tabular-nums">
              Period Total: {formatPKR(metrics.periodExpenses)}
            </span>
          </div>
          {expenses.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No expenses logged yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {expenses.map((ex) => (
                    <tr key={ex.id}>
                      <td className="px-4 py-3 tabular-nums text-slate-600">{ex.expenseDate}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{ex.category}</td>
                      <td className="px-4 py-3 text-slate-700">{ex.description}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {formatPKR(ex.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const TeamSalesmenPayrollPanel: React.FC<{
  users: UserProfile[];
  invites: StaffInvite[];
  salesmen: SalesmanProfile[];
  salesTargets: SalesTarget[];
  commissions: CommissionRecord[];
  salaries: SalaryRecord[];
  actor: UserProfile;
}> = ({ users, invites, salesmen, salesTargets, commissions, salaries, actor }) => {
  const [invEmail, setInvEmail] = useState('');
  const [invName, setInvName] = useState('');
  const [invRole, setInvRole] = useState<StaffInvite['role']>('SALESMAN');
  const [invSalary, setInvSalary] = useState('40000');
  const [invTarget, setInvTarget] = useState('60');

  const [editingSalesman, setEditingSalesman] = useState<SalesmanProfile | null>(null);
  const [salEmployeeUid, setSalEmployeeUid] = useState('');
  const [salBonus, setSalBonus] = useState('0');
  const [salDeduct, setSalDeduct] = useState('0');
  const monthKey = currentMonthKey();

  const handleInviteStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = invEmail.trim().toLowerCase();
    if (!email) return;
    const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'staff_invites', email), {
        email,
        displayName: invName.trim().slice(0, 120),
        role: invRole,
        baseSalary: Number(invSalary) || 0,
        monthlyTargetSuits: Number(invTarget) || 60,
        claimed: false,
        createdAt: now,
      });
      await logAuditEvent({
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'INVITE_STAFF',
        entityType: 'staff_invites',
        entityId: email,
        details: `Assigned role ${invRole} to ${email}`,
      });
      setInvEmail('');
      setInvName('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `staff_invites/${email}`);
    }
  };

  const handleUpdateUserRole = async (u: UserProfile, role: UserRole) => {
    const now = new Date().toISOString();
    try {
      await updateDoc(doc(db, 'users', u.uid), { role, updatedAt: now });
      if (role === 'SALESMAN' && !salesmen.some((s) => s.uid === u.uid)) {
        await setDoc(doc(db, 'salesmen', u.uid), {
          uid: u.uid,
          name: u.displayName,
          email: u.email,
          phone: u.phone || '',
          referralCode: u.uid.slice(0, 6).toUpperCase(),
          monthlySalary: 40000,
          monthlyTargetSuits: 60,
          avgPurchasePrice: 1500,
          avgSellingPrice: 3000,
          bonusTiers: DEFAULT_BONUS_TIERS,
          active: true,
          createdAt: now,
          updatedAt: now,
        });
      }
      await logAuditEvent({
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'CHANGE_USER_ROLE',
        entityType: 'users',
        entityId: u.uid,
        details: `${u.email} role -> ${role}`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${u.uid}`);
    }
  };

  const handleSaveSalesmanConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSalesman) return;
    try {
      await updateDoc(doc(db, 'salesmen', editingSalesman.id), {
        monthlySalary: editingSalesman.monthlySalary,
        monthlyTargetSuits: editingSalesman.monthlyTargetSuits,
        referralCode: editingSalesman.referralCode.toUpperCase(),
        bonusTiers: editingSalesman.bonusTiers,
        active: editingSalesman.active,
        updatedAt: new Date().toISOString(),
      });
      setEditingSalesman(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `salesmen/${editingSalesman.id}`);
    }
  };

  const handleRecordSalary = async (e: React.FormEvent) => {
    e.preventDefault();
    const emp = users.find((u) => u.uid === salEmployeeUid);
    if (!emp) return;
    const base = emp.baseSalary || 40000;
    const bonus = Number(salBonus) || 0;
    const ded = Number(salDeduct) || 0;
    const net = Math.max(0, base + bonus - ded);
    const now = new Date().toISOString();
    const id = makeSafeId(`sal_${emp.uid}_${monthKey}_${Date.now()}`);
    try {
      await setDoc(doc(db, 'salary_records', id), {
        employeeUid: emp.uid,
        employeeName: emp.displayName,
        role: emp.role,
        monthKey,
        baseSalary: base,
        bonusAmount: bonus,
        deductions: ded,
        netPaid: net,
        status: 'PAID',
        paidDate: now.slice(0, 10),
        createdAt: now,
      });
      setSalBonus('0');
      setSalDeduct('0');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'salary_records');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleInviteStaff}
          className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
        >
          <h3 className="text-sm font-semibold text-slate-900">Authorize Employee by Email</h3>
          <p className="text-xs text-slate-500">
            Staff members receive their assigned role automatically when signing in with Google.
          </p>
          <input
            type="email"
            required
            value={invEmail}
            onChange={(e) => setInvEmail(e.target.value)}
            placeholder="staff@gmail.com"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
          />
          <input
            type="text"
            value={invName}
            onChange={(e) => setInvName(e.target.value)}
            placeholder="Full Name"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
          />
          <select
            value={invRole}
            onChange={(e) => setInvRole(e.target.value as StaffInvite['role'])}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
          >
            <option value="SALESMAN">Salesman</option>
            <option value="SALES_MANAGER">Sales Manager</option>
            <option value="INVENTORY_MANAGER">Inventory Manager</option>
            <option value="PACKING_STAFF">Packing Staff</option>
            <option value="ADMIN">Admin</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              value={invSalary}
              onChange={(e) => setInvSalary(e.target.value)}
              placeholder="Base Salary"
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
            />
            <input
              type="number"
              value={invTarget}
              onChange={(e) => setInvTarget(e.target.value)}
              placeholder="Target Suits"
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2.5 text-xs font-medium bg-slate-900 text-white rounded-lg"
          >
            Save Staff Authorization
          </button>
          {invites.length > 0 && (
            <div className="pt-2 border-t border-slate-100 text-xs space-y-1">
              <p className="font-medium text-slate-700">Pre-Authorized Emails ({invites.length})</p>
              {invites.map((i) => (
                <div key={i.id} className="flex justify-between text-slate-500">
                  <span className="truncate">{i.email}</span>
                  <span className="font-mono">{i.role}</span>
                </div>
              ))}
            </div>
          )}
        </form>

        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Registered Users &amp; Role Access ({users.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Name / Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.uid}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{u.displayName}</p>
                      <p className="text-slate-500">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        disabled={u.role === 'OWNER'}
                        value={u.role}
                        onChange={(e) => handleUpdateUserRole(u, e.target.value as UserRole)}
                        className="px-2 py-1 text-xs border border-slate-200 rounded bg-white disabled:opacity-60"
                      >
                        <option value="OWNER">OWNER</option>
                        <option value="ADMIN">ADMIN</option>
                        <option value="SALES_MANAGER">SALES_MANAGER</option>
                        <option value="SALESMAN">SALESMAN</option>
                        <option value="INVENTORY_MANAGER">INVENTORY_MANAGER</option>
                        <option value="PACKING_STAFF">PACKING_STAFF</option>
                        <option value="CUSTOMER">CUSTOMER</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Salesmen Targets & Commission Config */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">
            Salesmen Performance &amp; Target Configuration ({salesmen.length})
          </h3>
        </div>
        {salesmen.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No salesmen configured yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Salesman</th>
                  <th className="px-4 py-3 font-medium">Ref Code</th>
                  <th className="px-4 py-3 font-medium">Monthly Salary</th>
                  <th className="px-4 py-3 font-medium">Target Suits</th>
                  <th className="px-4 py-3 font-medium">Delivered ({monthKey})</th>
                  <th className="px-4 py-3 font-medium">Bonus Earned</th>
                  <th className="px-4 py-3 font-medium text-right">Edit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {salesmen.map((s) => {
                  const t = salesTargets.find(
                    (st) => st.salesmanId === s.uid && st.monthKey === monthKey
                  );
                  return (
                    <tr key={s.id}>
                      <td className="px-4 py-3 font-medium text-slate-900">{s.name}</td>
                      <td className="px-4 py-3 font-mono">{s.referralCode}</td>
                      <td className="px-4 py-3 tabular-nums">{formatPKR(s.monthlySalary)}</td>
                      <td className="px-4 py-3 tabular-nums">{s.monthlyTargetSuits}</td>
                      <td className="px-4 py-3 tabular-nums font-semibold">
                        {t?.deliveredSuits || 0}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-emerald-700 font-semibold">
                        {formatPKR(t?.bonusEarned || 0)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setEditingSalesman(s)}
                          className="text-xs font-medium text-slate-900 underline"
                        >
                          Configure
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {editingSalesman && (
          <form onSubmit={handleSaveSalesmanConfig} className="p-5 bg-slate-50 border-t border-slate-200 space-y-3">
            <p className="text-xs font-semibold text-slate-900">
              Edit Target &amp; Salary for {editingSalesman.name}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-slate-600 mb-1">Monthly Salary (PKR)</label>
                <input
                  type="number"
                  value={editingSalesman.monthlySalary}
                  onChange={(e) =>
                    setEditingSalesman({
                      ...editingSalesman,
                      monthlySalary: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-600 mb-1">Monthly Target (Suits)</label>
                <input
                  type="number"
                  value={editingSalesman.monthlyTargetSuits}
                  onChange={(e) =>
                    setEditingSalesman({
                      ...editingSalesman,
                      monthlyTargetSuits: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-600 mb-1">Referral Code</label>
                <input
                  type="text"
                  value={editingSalesman.referralCode}
                  onChange={(e) =>
                    setEditingSalesman({
                      ...editingSalesman,
                      referralCode: e.target.value.toUpperCase(),
                    })
                  }
                  className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-lg bg-white"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg">
                Save Changes
              </button>
              <button
                type="button"
                onClick={() => setEditingSalesman(null)}
                className="px-4 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Salary Disbursement + Commissions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleRecordSalary}
          className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
        >
          <h3 className="text-sm font-semibold text-slate-900">Record Salary Payout ({monthKey})</h3>
          <select
            required
            value={salEmployeeUid}
            onChange={(e) => setSalEmployeeUid(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
          >
            <option value="">Select Employee...</option>
            {users
              .filter((u) => u.role !== 'CUSTOMER')
              .map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName} ({u.role})
                </option>
              ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-600 mb-1">Bonus (PKR)</label>
              <input
                type="number"
                value={salBonus}
                onChange={(e) => setSalBonus(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-600 mb-1">Deductions (PKR)</label>
              <input
                type="number"
                value={salDeduct}
                onChange={(e) => setSalDeduct(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-full py-2.5 text-xs font-medium bg-slate-900 text-white rounded-lg"
          >
            Pay &amp; Record Salary
          </button>
        </form>

        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Salary &amp; Commission History ({salaries.length} salaries · {commissions.length} commissions)
            </h3>
          </div>
          {salaries.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">No salary payouts recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Month</th>
                    <th className="px-4 py-3 font-medium">Base</th>
                    <th className="px-4 py-3 font-medium">Bonus</th>
                    <th className="px-4 py-3 font-medium text-right">Net Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {salaries.map((sr) => (
                    <tr key={sr.id}>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {sr.employeeName} <span className="text-slate-400">· {sr.role}</span>
                      </td>
                      <td className="px-4 py-3 font-mono">{sr.monthKey}</td>
                      <td className="px-4 py-3 tabular-nums">{formatPKR(sr.baseSalary)}</td>
                      <td className="px-4 py-3 tabular-nums">{formatPKR(sr.bonusAmount || 0)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">
                        {formatPKR(sr.netPaid)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const MarketingCouponsPanel: React.FC<{
  coupons: Coupon[];
  campaigns: Campaign[];
  abandonedCarts: AbandonedCart[];
  orders: Order[];
}> = ({ coupons, campaigns, abandonedCarts, orders }) => {
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [discountValue, setDiscountValue] = useState('10');
  const [minOrder, setMinOrder] = useState('2000');

  const [campName, setCampName] = useState('');
  const [campChannel, setCampChannel] = useState<Campaign['channel']>('FACEBOOK');
  const [campUtm, setCampUtm] = useState('');
  const [campBudget, setCampBudget] = useState('10000');

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = code.trim().toUpperCase();
    if (!cleaned) return;
    await setDoc(doc(db, 'coupons', makeSafeId(cleaned)), {
      code: cleaned,
      discountType,
      discountValue: Number(discountValue) || 0,
      minOrderAmount: Number(minOrder) || 0,
      maxUses: 500,
      usedCount: 0,
      active: true,
      createdAt: new Date().toISOString(),
    });
    setCode('');
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campName.trim() || !campUtm.trim()) return;
    const id = makeSafeId(`camp_${Date.now()}`);
    await setDoc(doc(db, 'campaigns', id), {
      name: campName.trim(),
      channel: campChannel,
      utmCode: campUtm.trim(),
      budget: Number(campBudget) || 0,
      active: true,
      createdAt: new Date().toISOString(),
    });
    setCampName('');
    setCampUtm('');
  };

  const sourceCounts = useMemo(() => {
    const map: Record<string, number> = {
      WEBSITE: 0,
      WHATSAPP: 0,
      FACEBOOK: 0,
      INSTAGRAM: 0,
      DIRECT: 0,
    };
    orders.forEach((o) => {
      map[o.source] = (map[o.source] || 0) + 1;
    });
    return map;
  }, [orders]);

  return (
    <div className="space-y-6">
      {/* Order Source Breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {Object.entries(sourceCounts).map(([src, count]) => (
          <div key={src} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">{src}</p>
            <p className="text-xl font-semibold tabular-nums mt-1">{count}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Coupons */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">Discount Coupons</h3>
          <form onSubmit={handleCreateCoupon} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <input
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="CODE"
              className="px-3 py-2 text-xs font-mono uppercase border border-slate-300 rounded-lg"
            />
            <select
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as 'PERCENT' | 'FIXED')}
              className="px-2 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="PERCENT">% Off</option>
              <option value="FIXED">PKR Off</option>
            </select>
            <input
              type="number"
              required
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              placeholder="Value"
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg tabular-nums"
            />
            <button
              type="submit"
              className="px-3 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg inline-flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </form>
          <div className="divide-y divide-slate-100 text-xs">
            {coupons.map((c) => (
              <div key={c.id} className="py-2.5 flex items-center justify-between">
                <div>
                  <span className="font-mono font-semibold text-slate-900">{c.code}</span>
                  <span className="text-slate-500 ml-2">
                    {c.discountType === 'PERCENT' ? `${c.discountValue}% off` : formatPKR(c.discountValue)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => updateDoc(doc(db, 'coupons', c.id), { active: !c.active })}
                  className={`font-medium ${c.active ? 'text-emerald-700' : 'text-slate-400'}`}
                >
                  {c.active ? 'Active' : 'Paused'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Campaigns */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">Campaign Tracking</h3>
          <form onSubmit={handleCreateCampaign} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <input
              type="text"
              required
              value={campName}
              onChange={(e) => setCampName(e.target.value)}
              placeholder="Campaign Name"
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
            <select
              value={campChannel}
              onChange={(e) => setCampChannel(e.target.value as Campaign['channel'])}
              className="px-2 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="FACEBOOK">Facebook</option>
              <option value="INSTAGRAM">Instagram</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="WEBSITE">Website</option>
            </select>
            <input
              type="text"
              required
              value={campUtm}
              onChange={(e) => setCampUtm(e.target.value)}
              placeholder="utm_code"
              className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
            />
            <button
              type="submit"
              className="px-3 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg"
            >
              Add
            </button>
          </form>
          <div className="divide-y divide-slate-100 text-xs">
            {campaigns.map((cp) => (
              <div key={cp.id} className="py-2.5 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-900">{cp.name}</span>
                  <span className="text-slate-500 ml-2">
                    {cp.channel} · <span className="font-mono">{cp.utmCode}</span>
                  </span>
                </div>
                <span className="tabular-nums text-slate-600">{formatPKR(cp.budget || 0)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Abandoned Carts */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">
            Abandoned Cart Recovery ({abandonedCarts.length})
          </h3>
        </div>
        {abandonedCarts.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Incomplete checkouts where a customer entered a mobile number appear here for WhatsApp follow-up.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Mobile</th>
                  <th className="px-4 py-3 font-medium">Items</th>
                  <th className="px-4 py-3 font-medium">Cart Value</th>
                  <th className="px-4 py-3 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {abandonedCarts.map((ac) => (
                  <tr key={ac.id}>
                    <td className="px-4 py-3 font-medium">{ac.customerName || 'Guest Visitor'}</td>
                    <td className="px-4 py-3 font-mono">{ac.customerPhone}</td>
                    <td className="px-4 py-3 tabular-nums">{ac.itemsCount}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold">{formatPKR(ac.totalValue)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          updateDoc(doc(db, 'abandoned_carts', ac.id), { recovered: !ac.recovered })
                        }
                        className="text-xs underline text-slate-800"
                      >
                        {ac.recovered ? 'Recovered' : 'Mark Recovered'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export const AuditLogsPanel: React.FC<{ logs: AuditLog[] }> = ({ logs }) => (
  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
    <div className="px-5 py-4 border-b border-slate-200">
      <h3 className="text-sm font-semibold text-slate-900">
        Immutable Security &amp; Operations Audit Trail ({logs.length})
      </h3>
    </div>
    {logs.length === 0 ? (
      <div className="p-8 text-center text-sm text-slate-500">No audit entries recorded yet.</div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Timestamp</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Entity</th>
              <th className="px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.slice(0, 100).map((log) => (
              <tr key={log.id}>
                <td className="px-4 py-2.5 tabular-nums text-slate-500 whitespace-nowrap">
                  {formatDateTime(log.createdAt)}
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-medium text-slate-900">{log.actorEmail || log.actorUid}</span>
                  <span className="text-slate-400 ml-1">({log.actorRole})</span>
                </td>
                <td className="px-4 py-2.5 font-mono text-slate-800">{log.action}</td>
                <td className="px-4 py-2.5 font-mono text-slate-500">
                  {log.entityType}/{log.entityId}
                </td>
                <td className="px-4 py-2.5 text-slate-700">{log.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);
