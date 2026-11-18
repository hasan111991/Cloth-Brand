import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  ArrowLeft,
  Check,
  Copy,
  LogOut,
  Plus,
  ShoppingBag,
  Target,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';
import { db, handleFirestoreError, makeSafeId, OperationType } from '../lib/firebase';
import {
  calculateBonusForSuits,
  currentMonthKey,
  DEFAULT_BONUS_TIERS,
  formatDate,
  formatDateTime,
  formatPKR,
  isValidPakistaniPhone,
  ORDER_STATUS_LABELS,
  PAKISTAN_CITIES,
} from '../lib/format';
import { placeOrderAtomic } from '../services/businessService';
import {
  BusinessSettings,
  CommissionRecord,
  Lead,
  Order,
  OrderSource,
  PaymentMethod,
  Product,
  ProductVariant,
  SalesmanProfile,
  SalesTarget,
  UserProfile,
} from '../types';

interface SalesmanPortalProps {
  currentUser: UserProfile;
  settings: BusinessSettings;
  products: Product[];
  variants: ProductVariant[];
  onBackToStore: () => void;
  onSignOut: () => Promise<void>;
}

type SalesmanTab = 'dashboard' | 'leads' | 'create-order' | 'orders' | 'commissions';

export const SalesmanPortal: React.FC<SalesmanPortalProps> = ({
  currentUser,
  settings,
  products,
  variants,
  onBackToStore,
  onSignOut,
}) => {
  const [tab, setTab] = useState<SalesmanTab>('dashboard');
  const [salesmanProfile, setSalesmanProfile] = useState<SalesmanProfile | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [targets, setTargets] = useState<SalesTarget[]>([]);
  const [commissions, setCommissions] = useState<CommissionRecord[]>([]);
  const [copiedLink, setCopiedLink] = useState(false);

  // Lead form
  const [leadName, setLeadName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadSource, setLeadSource] = useState<'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM' | 'DIRECT'>('WHATSAPP');
  const [leadProduct, setLeadProduct] = useState('');
  const [leadNotes, setLeadNotes] = useState('');
  const [leadNextDate, setLeadNextDate] = useState('');
  const [leadSaving, setLeadSaving] = useState(false);

  // Order creation form
  const [ordName, setOrdName] = useState('');
  const [ordPhone, setOrdPhone] = useState('');
  const [ordCity, setOrdCity] = useState('Lahore');
  const [ordAddress, setOrdAddress] = useState('');
  const [ordSource, setOrdSource] = useState<OrderSource>('WHATSAPP');
  const [ordPayment, setOrdPayment] = useState<PaymentMethod>('COD');
  const [ordProductId, setOrdProductId] = useState(products[0]?.id || '');
  const [ordVariantId, setOrdVariantId] = useState('');
  const [ordQty, setOrdQty] = useState(1);
  const [ordNotes, setOrdNotes] = useState('');
  const [ordMsg, setOrdMsg] = useState('');
  const [ordError, setOrdError] = useState('');
  const [ordSubmitting, setOrdSubmitting] = useState(false);

  const monthKey = currentMonthKey();

  useEffect(() => {
    const qProfile = query(collection(db, 'salesmen'), where('uid', '==', currentUser.uid));
    const u1 = onSnapshot(
      qProfile,
      (snap) => {
        if (!snap.empty) {
          const d = snap.docs[0];
          setSalesmanProfile({ id: d.id, ...(d.data() as Omit<SalesmanProfile, 'id'>) });
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'salesmen')
    );

    const qOrders = query(collection(db, 'orders'), where('salesmanId', '==', currentUser.uid));
    const u2 = onSnapshot(
      qOrders,
      (snap) => {
        setOrders(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Order, 'id'>) }))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'orders')
    );

    const qLeads = query(collection(db, 'leads'), where('salesmanId', '==', currentUser.uid));
    const u3 = onSnapshot(
      qLeads,
      (snap) => {
        setLeads(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<Lead, 'id'>) }))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'leads')
    );

    const qTargets = query(collection(db, 'sales_targets'), where('salesmanId', '==', currentUser.uid));
    const u4 = onSnapshot(
      qTargets,
      (snap) => {
        setTargets(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SalesTarget, 'id'>) })));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'sales_targets')
    );

    const qComm = query(collection(db, 'commissions'), where('salesmanId', '==', currentUser.uid));
    const u5 = onSnapshot(
      qComm,
      (snap) => {
        setCommissions(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<CommissionRecord, 'id'>) }))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'commissions')
    );

    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
    };
  }, [currentUser.uid]);

  const activeProducts = useMemo(() => products.filter((p) => p.active), [products]);
  const selectedProductVariants = useMemo(
    () => variants.filter((v) => v.productId === ordProductId && v.active),
    [variants, ordProductId]
  );

  useEffect(() => {
    if (!ordProductId && activeProducts[0]) {
      setOrdProductId(activeProducts[0].id);
    }
  }, [activeProducts, ordProductId]);

  useEffect(() => {
    if (selectedProductVariants.length > 0 && !selectedProductVariants.some((v) => v.id === ordVariantId)) {
      setOrdVariantId(selectedProductVariants[0].id);
    }
  }, [selectedProductVariants, ordVariantId]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const deliveredOrders = orders.filter((o) => o.status === 'DELIVERED');
  const todaySales = orders
    .filter((o) => o.createdAt.startsWith(todayKey) && o.status !== 'CANCELLED')
    .reduce((sum, o) => sum + o.totalAmount, 0);
  const monthlyDeliveredOrders = deliveredOrders.filter((o) => o.createdAt.startsWith(monthKey));
  const monthlyDeliveredSuits = monthlyDeliveredOrders.reduce((sum, o) => sum + (o.suitsCount || 1), 0);
  const monthlyDeliveredRevenue = monthlyDeliveredOrders.reduce(
    (sum, o) => sum + Math.max(0, o.subtotal - o.discountAmount),
    0
  );

  const bonusTiers = salesmanProfile?.bonusTiers || settings.salesmanDefaults?.bonusTiers || DEFAULT_BONUS_TIERS;
  const monthlySalary = salesmanProfile?.monthlySalary ?? settings.salesmanDefaults?.monthlySalary ?? 40000;
  const monthlyTarget = salesmanProfile?.monthlyTargetSuits ?? settings.salesmanDefaults?.monthlyTargetSuits ?? 60;
  const currentBonusEarned = calculateBonusForSuits(monthlyDeliveredSuits, bonusTiers);
  const progressPct = Math.min(100, Math.round((monthlyDeliveredSuits / Math.max(1, monthlyTarget)) * 100));

  const refCode = salesmanProfile?.referralCode || currentUser.uid.slice(0, 6).toUpperCase();
  const referralUrl = `${window.location.origin}/?ref=${refCode}`;

  const handleCopyLink = () => {
    navigator.clipboard?.writeText(referralUrl).catch(() => {});
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadName.trim() || !leadPhone.trim()) return;
    setLeadSaving(true);
    try {
      const id = makeSafeId(`lead_${currentUser.uid}_${Date.now()}`);
      const now = new Date().toISOString();
      await setDoc(doc(db, 'leads', id), {
        salesmanId: currentUser.uid,
        customerName: leadName.trim().slice(0, 120),
        phone: leadPhone.trim().slice(0, 30),
        source: leadSource,
        interestedProduct: leadProduct.trim().slice(0, 140),
        status: 'NEW',
        notes: leadNotes.trim().slice(0, 500),
        nextFollowUp: leadNextDate,
        createdAt: now,
        updatedAt: now,
      });
      setLeadName('');
      setLeadPhone('');
      setLeadProduct('');
      setLeadNotes('');
      setLeadNextDate('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'leads');
    } finally {
      setLeadSaving(false);
    }
  };

  const handleLeadStatusChange = async (lead: Lead, status: Lead['status']) => {
    try {
      await updateDoc(doc(db, 'leads', lead.id), {
        status,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `leads/${lead.id}`);
    }
  };

  const convertLeadToOrder = (lead: Lead) => {
    setOrdName(lead.customerName);
    setOrdPhone(lead.phone);
    setOrdSource(lead.source);
    setOrdNotes(lead.notes || '');
    setTab('create-order');
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrdError('');
    setOrdMsg('');

    if (!isValidPakistaniPhone(ordPhone)) {
      setOrdError('Please enter a valid Pakistani mobile number (03XX-XXXXXXX).');
      return;
    }
    const product = activeProducts.find((p) => p.id === ordProductId);
    const variant = selectedProductVariants.find((v) => v.id === ordVariantId);
    if (!product || !variant) {
      setOrdError('Please select a valid product and variant.');
      return;
    }

    setOrdSubmitting(true);
    try {
      const res = await placeOrderAtomic({
        items: [{ product, variant, quantity: ordQty }],
        customerName: ordName.trim(),
        customerPhone: ordPhone.trim(),
        customerCity: ordCity,
        customerAddress: ordAddress.trim(),
        paymentMethod: ordPayment,
        referralCode: refCode,
        salesmanId: currentUser.uid,
        salesmanName: salesmanProfile?.name || currentUser.displayName,
        source: ordSource,
        shippingCharges: settings.shippingCharges,
        freeShippingThreshold: settings.freeShippingThreshold,
        notes: ordNotes,
        allowProcurementBackorder: true,
      });

      setOrdMsg(
        `Order ${res.orderNumber} logged (${ORDER_STATUS_LABELS[res.status]}) · Total ${formatPKR(res.totalAmount)}`
      );
      setOrdName('');
      setOrdPhone('');
      setOrdAddress('');
      setOrdNotes('');
      setOrdQty(1);
    } catch (err) {
      setOrdError(err instanceof Error ? err.message : 'Failed to create order.');
    } finally {
      setOrdSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col">
      {/* Top Bar */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onBackToStore}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Storefront
          </button>
          <span className="text-slate-300">|</span>
          <h1 className="text-base font-semibold text-slate-900">
            {settings.brandName} · Salesman Portal
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-slate-500">
            {currentUser.displayName} · Ref: <span className="font-mono font-semibold text-slate-800">{refCode}</span>
          </span>
          <button
            type="button"
            onClick={onSignOut}
            className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </header>

      <div className="max-w-7xl w-full mx-auto px-4 sm:px-8 py-6 space-y-6 flex-1">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
          {(
            [
              { id: 'dashboard', label: 'Dashboard' },
              { id: 'leads', label: `Leads (${leads.length})` },
              { id: 'create-order', label: 'Register Order' },
              { id: 'orders', label: `My Orders (${orders.length})` },
              { id: 'commissions', label: 'Commissions & Targets' },
            ] as { id: SalesmanTab; label: string }[]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === t.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* DASHBOARD TAB */}
        {tab === 'dashboard' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-xs text-slate-500">Monthly Delivered Suits</p>
                <p className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
                  {monthlyDeliveredSuits} / {monthlyTarget}
                </p>
                <p className="text-xs text-emerald-700 mt-1 tabular-nums">{progressPct}% of monthly target</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-xs text-slate-500">Delivered Sales ({monthKey})</p>
                <p className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
                  {formatPKR(monthlyDeliveredRevenue)}
                </p>
                <p className="text-xs text-slate-500 mt-1">Only delivered orders qualify</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-xs text-slate-500">Today&apos;s Logged Orders</p>
                <p className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
                  {formatPKR(todaySales)}
                </p>
                <p className="text-xs text-slate-500 mt-1">All channels combined</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-xs text-slate-500">Base Salary + Current Tier Bonus</p>
                <p className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
                  {formatPKR(monthlySalary + currentBonusEarned)}
                </p>
                <p className="text-xs text-emerald-700 mt-1 tabular-nums">
                  Bonus unlocked: {formatPKR(currentBonusEarned)}
                </p>
              </div>
            </div>

            {/* Target Progress & Bonus Tiers */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Monthly Bonus Structure
                    </h2>
                    <p className="text-xs text-slate-500">
                      Progress counts eligible delivered orders only.
                    </p>
                  </div>
                  <Target className="w-5 h-5 text-slate-400" />
                </div>

                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {bonusTiers.map((tier) => {
                    const reached = monthlyDeliveredSuits >= tier.suits;
                    return (
                      <div
                        key={tier.suits}
                        className={`p-3 rounded-lg border text-xs ${
                          reached
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : 'bg-slate-50 border-slate-200 text-slate-600'
                        }`}
                      >
                        <p className="font-semibold tabular-nums">{tier.suits} Suits</p>
                        <p className="mt-1 tabular-nums">
                          {tier.bonus === 0 ? 'No bonus' : formatPKR(tier.bonus)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Referral Link Box */}
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900">
                    Your Referral Attribution Link
                  </h2>
                  <TrendingUp className="w-5 h-5 text-slate-400" />
                </div>
                <p className="text-xs text-slate-500">
                  Share this link on WhatsApp, Facebook, or Instagram. Any customer order placed through this link is attributed to code{' '}
                  <span className="font-mono font-semibold text-slate-900">{refCode}</span>.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={referralUrl}
                    className="flex-1 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
                  />
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="px-3.5 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedLink ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* LEADS TAB */}
        {tab === 'leads' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <form
              onSubmit={handleCreateLead}
              className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
            >
              <h2 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
                <UserPlus className="w-4 h-4" /> Register Lead (WhatsApp / Social)
              </h2>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Customer Name</label>
                <input
                  type="text"
                  required
                  value={leadName}
                  onChange={(e) => setLeadName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Mobile / WhatsApp</label>
                <input
                  type="text"
                  required
                  value={leadPhone}
                  onChange={(e) => setLeadPhone(e.target.value)}
                  placeholder="0300-1234567"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Channel Source</label>
                <select
                  value={leadSource}
                  onChange={(e) => setLeadSource(e.target.value as Lead['source'])}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="FACEBOOK">Facebook</option>
                  <option value="INSTAGRAM">Instagram</option>
                  <option value="DIRECT">Direct</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Interested Product</label>
                <input
                  type="text"
                  value={leadProduct}
                  onChange={(e) => setLeadProduct(e.target.value)}
                  placeholder="e.g. Safa Ivory Lawn"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Next Follow-Up Date</label>
                <input
                  type="date"
                  value={leadNextDate}
                  onChange={(e) => setLeadNextDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={leadNotes}
                  onChange={(e) => setLeadNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <button
                type="submit"
                disabled={leadSaving}
                className="w-full py-2.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
              >
                {leadSaving ? 'Saving...' : 'Save Lead'}
              </button>
            </form>

            <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Active Leads Pipeline</h2>
                <Users className="w-4 h-4 text-slate-400" />
              </div>
              {leads.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No leads registered yet. Log WhatsApp, Facebook, or Instagram inquiries on the left.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-medium">Customer</th>
                        <th className="px-4 py-3 font-medium">Source</th>
                        <th className="px-4 py-3 font-medium">Interest</th>
                        <th className="px-4 py-3 font-medium">Follow-up</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {leads.map((l) => (
                        <tr key={l.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-900">{l.customerName}</p>
                            <p className="font-mono text-slate-500">{l.phone}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{l.source}</td>
                          <td className="px-4 py-3 text-slate-600">{l.interestedProduct || '—'}</td>
                          <td className="px-4 py-3 tabular-nums text-slate-500">
                            {l.nextFollowUp || '—'}
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={l.status}
                              onChange={(e) => handleLeadStatusChange(l, e.target.value as Lead['status'])}
                              className="px-2 py-1 text-xs border border-slate-200 rounded bg-white"
                            >
                              <option value="NEW">NEW</option>
                              <option value="CONTACTED">CONTACTED</option>
                              <option value="FOLLOW_UP">FOLLOW_UP</option>
                              <option value="CONVERTED">CONVERTED</option>
                              <option value="LOST">LOST</option>
                            </select>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => convertLeadToOrder(l)}
                              className="text-xs font-medium text-emerald-700 hover:underline whitespace-nowrap"
                            >
                              Create Order
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
        )}

        {/* CREATE ORDER TAB */}
        {tab === 'create-order' && (
          <form
            onSubmit={handleCreateOrder}
            className="max-w-3xl bg-white border border-slate-200 rounded-xl p-6 space-y-5"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Register Assisted Order (WhatsApp / Facebook / Instagram / Direct)
                </h2>
                <p className="text-xs text-slate-500">
                  Automatically attributed to your profile ({refCode}). If own stock is 0, order queues for supplier procurement.
                </p>
              </div>
              <ShoppingBag className="w-5 h-5 text-slate-400" />
            </div>

            {ordError && (
              <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                {ordError}
              </div>
            )}
            {ordMsg && (
              <div className="p-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg">
                {ordMsg}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Customer Name</label>
                <input
                  type="text"
                  required
                  value={ordName}
                  onChange={(e) => setOrdName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Mobile Number</label>
                <input
                  type="tel"
                  required
                  value={ordPhone}
                  onChange={(e) => setOrdPhone(e.target.value)}
                  placeholder="0300-1234567"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">City</label>
                <select
                  value={ordCity}
                  onChange={(e) => setOrdCity(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {PAKISTAN_CITIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Order Source</label>
                <select
                  value={ordSource}
                  onChange={(e) => setOrdSource(e.target.value as OrderSource)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="FACEBOOK">Facebook</option>
                  <option value="INSTAGRAM">Instagram</option>
                  <option value="DIRECT">Direct / Phone</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Delivery Address</label>
              <input
                type="text"
                required
                value={ordAddress}
                onChange={(e) => setOrdAddress(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Product</label>
                <select
                  value={ordProductId}
                  onChange={(e) => setOrdProductId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {activeProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({formatPKR(p.sellingPrice)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Variant (Size / Color)</label>
                <select
                  value={ordVariantId}
                  onChange={(e) => setOrdVariantId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {selectedProductVariants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.size} / {v.color} (Stock: {v.stockAvailable})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Quantity & Payment</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={ordQty}
                    onChange={(e) => setOrdQty(Math.max(1, Number(e.target.value)))}
                    className="w-20 px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                  />
                  <select
                    value={ordPayment}
                    onChange={(e) => setOrdPayment(e.target.value as PaymentMethod)}
                    className="flex-1 px-2 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="COD">COD</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Order Notes</label>
              <input
                type="text"
                value={ordNotes}
                onChange={(e) => setOrdNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <button
              type="submit"
              disabled={ordSubmitting}
              className="px-6 py-2.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              {ordSubmitting ? 'Submitting Order...' : 'Submit Salesman Order'}
            </button>
          </form>
        )}

        {/* MY ORDERS TAB */}
        {tab === 'orders' && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">
                Attributed Orders ({orders.length})
              </h2>
            </div>
            {orders.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No orders attributed to your account yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 font-medium">Order #</th>
                      <th className="px-4 py-3 font-medium">Customer</th>
                      <th className="px-4 py-3 font-medium">Source</th>
                      <th className="px-4 py-3 font-medium">Suits</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.map((o) => (
                      <tr key={o.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                          {o.orderNumber}
                          <div className="text-[11px] font-sans font-normal text-slate-400">
                            {formatDateTime(o.createdAt)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{o.customerName}</p>
                          <p className="text-slate-500">{o.customerCity}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{o.source}</td>
                        <td className="px-4 py-3 tabular-nums">{o.suitsCount}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {ORDER_STATUS_LABELS[o.status]}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">
                          {formatPKR(o.totalAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* COMMISSIONS TAB */}
        {tab === 'commissions' && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">
                  Commission & Incentive History
                </h2>
              </div>
              {commissions.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  Commissions are recorded automatically once attributed orders reach Delivered status.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-medium">Order #</th>
                        <th className="px-4 py-3 font-medium">Month</th>
                        <th className="px-4 py-3 font-medium">Suits</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium text-right">Bonus Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {commissions.map((c) => (
                        <tr key={c.id}>
                          <td className="px-4 py-3 font-mono font-medium">{c.orderNumber || c.orderId}</td>
                          <td className="px-4 py-3 tabular-nums">{c.monthKey}</td>
                          <td className="px-4 py-3 tabular-nums">{c.suitsCount || 1}</td>
                          <td className="px-4 py-3">{c.type || 'ORDER_DELIVERED'}</td>
                          <td className="px-4 py-3 font-medium text-emerald-700">{c.status}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">
                            {formatPKR(c.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {targets.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="text-sm font-semibold text-slate-900">Monthly Target Snapshots</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-medium">Month</th>
                        <th className="px-4 py-3 font-medium">Target Suits</th>
                        <th className="px-4 py-3 font-medium">Delivered Suits</th>
                        <th className="px-4 py-3 font-medium">Bonus Earned</th>
                        <th className="px-4 py-3 font-medium">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {targets.map((t) => (
                        <tr key={t.id}>
                          <td className="px-4 py-3 font-mono">{t.monthKey}</td>
                          <td className="px-4 py-3 tabular-nums">{t.targetSuits}</td>
                          <td className="px-4 py-3 tabular-nums font-semibold">{t.deliveredSuits}</td>
                          <td className="px-4 py-3 tabular-nums text-emerald-700 font-semibold">
                            {formatPKR(t.bonusEarned)}
                          </td>
                          <td className="px-4 py-3 text-slate-500">{formatDate(t.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
