import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Boxes,
  Check,
  Database,
  Download,
  FileSpreadsheet,
  LogOut,
  Megaphone,
  Menu,
  Package,
  Plus,
  Settings as SettingsIcon,
  ShoppingCart,
  Sliders,
  Trash2,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, makeSafeId, OperationType } from '../lib/firebase';
import {
  ALLOWED_ORDER_TRANSITIONS,
  currentMonthKey,
  downloadCsv,
  formatDateTime,
  formatPKR,
  generatePoNumber,
  ORDER_STATUS_LABELS,
  slugify,
} from '../lib/format';
import {
  logAuditEvent,
  receivePurchaseOrderAtomic,
  seedDevelopmentData,
  transitionOrderStatus,
} from '../services/businessService';
import {
  AbandonedCart,
  AudienceType,
  AuditLog,
  BusinessSettings,
  Campaign,
  Category,
  CommissionRecord,
  Coupon,
  Customer,
  ExpenseRecord,
  InventoryBatch,
  Order,
  OrderFinancial,
  OrderStatus,
  PaymentRecord,
  Product,
  ProductVariant,
  PurchaseItem,
  PurchaseOrder,
  ReturnRecord,
  Review,
  SalaryRecord,
  SalesmanProfile,
  SalesTarget,
  ShipmentRecord,
  StaffInvite,
  StockMovement,
  Supplier,
  UserProfile,
} from '../types';
import {
  AccountsReportsPanel,
  AuditLogsPanel,
  MarketingCouponsPanel,
  TeamSalesmenPayrollPanel,
} from './AdminFinanceAndTeam';

interface AdminPortalProps {
  currentUser: UserProfile;
  settings: BusinessSettings;
  categories: Category[];
  products: Product[];
  variants: ProductVariant[];
  onBackToStore: () => void;
  onOpenWizard: () => void;
  onSignOut: () => Promise<void>;
}

type AdminSection =
  | 'overview'
  | 'products'
  | 'inventory'
  | 'suppliers'
  | 'orders'
  | 'payments-courier'
  | 'customers'
  | 'team'
  | 'marketing'
  | 'accounts'
  | 'audit'
  | 'settings';

export const AdminPortal: React.FC<AdminPortalProps> = ({
  currentUser,
  settings,
  categories,
  products,
  variants,
  onBackToStore,
  onOpenWizard,
  onSignOut,
}) => {
  const isOwner = currentUser.role === 'OWNER';
  const isAdmin = isOwner || currentUser.role === 'ADMIN';
  const isInventoryMgr = isAdmin || currentUser.role === 'INVENTORY_MANAGER';
  const isSalesMgr = isAdmin || currentUser.role === 'SALES_MANAGER';
  const isPacking = isAdmin || currentUser.role === 'PACKING_STAFF';

  const defaultSection: AdminSection = isAdmin
    ? 'overview'
    : isInventoryMgr
    ? 'inventory'
    : 'orders';

  const [section, setSection] = useState<AdminSection>(defaultSection);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [statusNotice, setStatusNotice] = useState('');

  // Firestore Collections (role-gated listeners)
  const [orders, setOrders] = useState<Order[]>([]);
  const [inventory, setInventory] = useState<InventoryBatch[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [shipments, setShipments] = useState<ShipmentRecord[]>([]);
  const [returnsList, setReturnsList] = useState<ReturnRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [invites, setInvites] = useState<StaffInvite[]>([]);
  const [salesmen, setSalesmen] = useState<SalesmanProfile[]>([]);
  const [salesTargets, setSalesTargets] = useState<SalesTarget[]>([]);
  const [commissions, setCommissions] = useState<CommissionRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [salaries, setSalaries] = useState<SalaryRecord[]>([]);
  const [financials, setFinancials] = useState<OrderFinancial[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [abandonedCarts, setAbandonedCarts] = useState<AbandonedCart[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    const listen = <T,>(
      colName: string,
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      sortField?: string
    ) => {
      const u = onSnapshot(
        collection(db, colName),
        (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as T));
          if (sortField) {
            rows.sort((a: unknown, b: unknown) => {
              const av = String((a as Record<string, unknown>)[sortField] || '');
              const bv = String((b as Record<string, unknown>)[sortField] || '');
              return bv.localeCompare(av);
            });
          }
          setter(rows);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, colName)
      );
      unsubs.push(u);
    };

    if (isAdmin || isSalesMgr || isInventoryMgr || isPacking) {
      listen<Order>('orders', setOrders, 'createdAt');
      listen<ReturnRecord>('returns', setReturnsList, 'createdAt');
    }
    if (isAdmin || isPacking || isSalesMgr) {
      listen<ShipmentRecord>('shipments', setShipments, 'createdAt');
    }
    if (isInventoryMgr) {
      listen<InventoryBatch>('inventory', setInventory, 'createdAt');
      listen<StockMovement>('stock_movements', setMovements, 'createdAt');
      listen<Supplier>('suppliers', setSuppliers, 'createdAt');
      listen<PurchaseOrder>('purchase_orders', setPurchaseOrders, 'createdAt');
      listen<PurchaseItem>('purchase_items', setPurchaseItems);
    }
    if (isSalesMgr) {
      listen<Customer>('customers', setCustomers, 'updatedAt');
      listen<SalesmanProfile>('salesmen', setSalesmen, 'createdAt');
      listen<SalesTarget>('sales_targets', setSalesTargets, 'updatedAt');
      listen<Campaign>('campaigns', setCampaigns, 'createdAt');
      listen<AbandonedCart>('abandoned_carts', setAbandonedCarts, 'updatedAt');
    }
    if (isAdmin) {
      listen<PaymentRecord>('payments', setPayments, 'createdAt');
      listen<Review>('reviews', setReviews, 'createdAt');
      listen<UserProfile>('users', setUsers, 'createdAt');
      listen<StaffInvite>('staff_invites', setInvites, 'createdAt');
      listen<CommissionRecord>('commissions', setCommissions, 'createdAt');
      listen<ExpenseRecord>('expenses', setExpenses, 'createdAt');
      listen<SalaryRecord>('salary_records', setSalaries, 'createdAt');
      listen<OrderFinancial>('order_financials', setFinancials, 'createdAt');
      listen<Coupon>('coupons', setCoupons, 'createdAt');
    }
    if (isOwner) {
      listen<AuditLog>('audit_logs', setAuditLogs, 'createdAt');
    }

    return () => unsubs.forEach((u) => u());
  }, [isOwner, isAdmin, isInventoryMgr, isSalesMgr, isPacking]);

  // ---------------------------------------------------------------------------
  // Overview Metrics (Real Firestore Data Only)
  // ---------------------------------------------------------------------------
  const dashboardStats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const month = currentMonthKey();

    const activeOrders = orders.filter((o) => o.status !== 'CANCELLED');
    const todaySales = activeOrders
      .filter((o) => o.createdAt.startsWith(today))
      .reduce((s, o) => s + o.totalAmount, 0);
    const monthlySales = activeOrders
      .filter((o) => o.createdAt.startsWith(month))
      .reduce((s, o) => s + o.totalAmount, 0);

    const pendingOrders = orders.filter((o) =>
      ['NEW', 'CONFIRMED', 'AWAITING_PURCHASE', 'PROCESSING', 'PACKED'].includes(o.status)
    ).length;
    const deliveredOrders = orders.filter((o) => o.status === 'DELIVERED').length;
    const cancelledOrders = orders.filter((o) => o.status === 'CANCELLED').length;

    const lowStockVariants = variants.filter((v) => v.active && v.stockAvailable < 5);
    const inventoryValuation = inventory.reduce(
      (s, b) => s + Math.max(0, b.remainingQty) * b.purchaseCost,
      0
    );

    const deliveredIds = new Set(
      orders.filter((o) => o.status === 'DELIVERED').map((o) => o.id)
    );
    const deliveredRevenue = orders
      .filter((o) => o.status === 'DELIVERED')
      .reduce((s, o) => s + Math.max(0, o.subtotal - o.discountAmount), 0);
    const cogsTotal = financials
      .filter((f) => deliveredIds.has(f.orderId))
      .reduce((s, f) => s + (f.cogsTotal || 0), 0);
    const grossProfit = deliveredRevenue - cogsTotal;

    const monthlyExpenses = expenses
      .filter((e) => (e.expenseDate || e.createdAt).startsWith(month))
      .reduce((s, e) => s + e.amount, 0);
    const totalPaidSalaries = salaries
      .filter((s) => s.status === 'PAID' && s.monthKey === month)
      .reduce((sum, s) => sum + s.netPaid, 0);
    const totalCommissions = commissions
      .filter((c) => c.monthKey === month)
      .reduce((sum, c) => sum + c.amount, 0);
    const netProfit = grossProfit - monthlyExpenses - totalPaidSalaries - totalCommissions;

    const supplierPayable = suppliers.reduce((s, sp) => s + (sp.outstandingPayable || 0), 0);
    const codPending = orders
      .filter(
        (o) =>
          o.paymentMethod === 'COD' &&
          !['CANCELLED', 'RETURNED', 'REFUNDED'].includes(o.status) &&
          !['RECONCILED', 'VERIFIED'].includes(o.paymentStatus)
      )
      .reduce((s, o) => s + o.totalAmount, 0);

    // 7-Day Revenue Chart Data
    const chartDays: { label: string; total: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const sum = activeOrders
        .filter((o) => o.createdAt.startsWith(iso))
        .reduce((acc, o) => acc + o.totalAmount, 0);
      chartDays.push({
        label: d.toLocaleDateString('en-PK', { weekday: 'short' }),
        total: sum,
      });
    }

    return {
      todaySales,
      monthlySales,
      totalOrders: orders.length,
      pendingOrders,
      deliveredOrders,
      cancelledOrders,
      totalProducts: products.length,
      lowStockCount: lowStockVariants.length,
      lowStockVariants,
      inventoryValuation,
      grossProfit,
      netProfit,
      monthlyExpenses,
      supplierPayable,
      codPending,
      chartDays,
    };
  }, [orders, products, variants, inventory, financials, expenses, salaries, commissions, suppliers]);

  // ---------------------------------------------------------------------------
  // Products & Variants CRUD State
  // ---------------------------------------------------------------------------
  const [prodEditId, setProdEditId] = useState<string | null>(null);
  const [prodName, setProdName] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodCatId, setProdCatId] = useState(categories[0]?.id || '');
  const [prodAudience, setProdAudience] = useState<AudienceType>('Ladies');
  const [prodFabric, setProdFabric] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [prodPrice, setProdPrice] = useState('3000');
  const [prodDiscount, setProdDiscount] = useState('0');
  const [prodSizes, setProdSizes] = useState('S, M, L');
  const [prodColors, setProdColors] = useState('Ivory');
  const [prodImage, setProdImage] = useState('/src/assets/images/product_ladies_lawn_1795026585565.jpg');
  const [prodInitQty, setProdInitQty] = useState('10');
  const [prodInitCost, setProdInitCost] = useState('1500');
  const [prodSaving, setProdSaving] = useState(false);

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodName.trim() || !prodSku.trim()) return;
    setProdSaving(true);
    const now = new Date().toISOString();
    const cat = categories.find((c) => c.id === prodCatId) || categories[0];
    const sizesArr = prodSizes.split(',').map((s) => s.trim()).filter(Boolean);
    const colorsArr = prodColors.split(',').map((s) => s.trim()).filter(Boolean);
    const pid = prodEditId || makeSafeId(`prod_${slugify(prodName)}_${Date.now().toString().slice(-4)}`);

    try {
      let totalAvail = 0;
      const initQty = Math.max(0, Number(prodInitQty) || 0);
      const initCost = Math.max(0, Number(prodInitCost) || 0);

      if (!prodEditId) {
        for (let sIdx = 0; sIdx < sizesArr.length; sIdx++) {
          for (let cIdx = 0; cIdx < colorsArr.length; cIdx++) {
            const sz = sizesArr[sIdx];
            const col = colorsArr[cIdx];
            const vid = makeSafeId(`${pid}_${sz}_${col}`);
            const vSku = `${prodSku.trim().toUpperCase()}-${sz.slice(0, 2).toUpperCase()}-${cIdx + 1}`;
            totalAvail += initQty;
            await setDoc(doc(db, 'product_variants', vid), {
              productId: pid,
              sku: vSku,
              size: sz,
              color: col,
              sellingPrice: Number(prodPrice) || 0,
              stockAvailable: initQty,
              stockReserved: 0,
              active: true,
              updatedAt: now,
            });
            if (initQty > 0) {
              await setDoc(doc(db, 'inventory', makeSafeId(`bat_${vid}_${Date.now()}`)), {
                productId: pid,
                variantId: vid,
                sku: vSku,
                batchCode: `INIT-${vSku}`,
                purchaseCost: initCost,
                initialQty: initQty,
                remainingQty: initQty,
                reservedQty: 0,
                warehouseLocation: 'Main Warehouse',
                receivedAt: now,
                createdAt: now,
              });
            }
          }
        }
      } else {
        const existingProd = products.find((p) => p.id === pid);
        totalAvail = existingProd?.totalAvailable || 0;
      }

      await setDoc(
        doc(db, 'products', pid),
        {
          name: prodName.trim().slice(0, 140),
          slug: slugify(prodName),
          sku: prodSku.trim().toUpperCase().slice(0, 64),
          categoryId: cat?.id || 'cat_general',
          categoryName: cat?.name || 'Apparel',
          audience: prodAudience,
          fabric: prodFabric.trim().slice(0, 120),
          description: prodDesc.trim().slice(0, 2000),
          sellingPrice: Math.max(0, Number(prodPrice) || 0),
          discountPercent: Math.max(0, Math.min(90, Number(prodDiscount) || 0)),
          active: true,
          featured: true,
          images: [prodImage.trim() || '/src/assets/images/product_ladies_lawn_1795026585565.jpg'],
          sizes: sizesArr,
          colors: colorsArr,
          totalAvailable: totalAvail,
          createdAt: prodEditId ? products.find((p) => p.id === pid)?.createdAt || now : now,
          updatedAt: now,
        },
        { merge: true }
      );

      await logAuditEvent({
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        actorRole: currentUser.role,
        action: prodEditId ? 'UPDATE_PRODUCT' : 'CREATE_PRODUCT',
        entityType: 'products',
        entityId: pid,
        details: `${prodName} (${prodSku})`,
      });

      setProdEditId(null);
      setProdName('');
      setProdSku('');
      setProdFabric('');
      setProdDesc('');
      setStatusNotice(`Saved product ${prodName}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `products/${pid}`);
    } finally {
      setProdSaving(false);
    }
  };

  const handleDeleteProduct = async (product: Product) => {
    try {
      await deleteDoc(doc(db, 'products', product.id));
      await logAuditEvent({
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        actorRole: currentUser.role,
        action: 'DELETE_PRODUCT',
        entityType: 'products',
        entityId: product.id,
        details: `Deleted ${product.name}`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `products/${product.id}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Inventory & Suppliers & Procurement State
  // ---------------------------------------------------------------------------
  const [stockVariantId, setStockVariantId] = useState('');
  const [stockQty, setStockQty] = useState('10');
  const [stockCost, setStockCost] = useState('1500');
  const [stockLoc, setStockLoc] = useState('Main Warehouse');

  const [supName, setSupName] = useState('');
  const [supContact, setSupContact] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supCity, setSupCity] = useState('Faisalabad');
  const [supCatalog, setSupCatalog] = useState('');

  const [poSupplierId, setPoSupplierId] = useState('');
  const [poVariantId, setPoVariantId] = useState('');
  const [poQty, setPoQty] = useState('20');
  const [poCost, setPoCost] = useState('1500');
  const [poLinkedOrder, setPoLinkedOrder] = useState('');

  const handleAddOwnStockBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const variant = variants.find((v) => v.id === stockVariantId);
    if (!variant) return;
    const qty = Math.max(1, Number(stockQty) || 0);
    const cost = Math.max(0, Number(stockCost) || 0);
    const now = new Date().toISOString();

    try {
      const batchId = makeSafeId(`bat_${variant.id}_${Date.now()}`);
      await setDoc(doc(db, 'inventory', batchId), {
        productId: variant.productId,
        variantId: variant.id,
        sku: variant.sku,
        batchCode: `OWN-${Date.now().toString().slice(-5)}`,
        purchaseCost: cost,
        initialQty: qty,
        remainingQty: qty,
        reservedQty: 0,
        warehouseLocation: stockLoc,
        receivedAt: now,
        createdAt: now,
      });

      await updateDoc(doc(db, 'product_variants', variant.id), {
        stockAvailable: variant.stockAvailable + qty,
        updatedAt: now,
      });

      const parentProd = products.find((p) => p.id === variant.productId);
      if (parentProd) {
        await updateDoc(doc(db, 'products', parentProd.id), {
          totalAvailable: (parentProd.totalAvailable || 0) + qty,
          updatedAt: now,
        });
      }

      await setDoc(doc(db, 'stock_movements', makeSafeId(`mov_${Date.now()}`)), {
        productId: variant.productId,
        variantId: variant.id,
        sku: variant.sku,
        type: 'RECEIPT',
        quantity: qty,
        unitCost: cost,
        note: `Direct warehouse stock receipt (${stockLoc})`,
        performedBy: currentUser.uid,
        createdAt: now,
      });

      setStatusNotice(`Added ${qty} units to ${variant.sku} @ ${formatPKR(cost)}/unit`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'inventory');
    }
  };

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supName.trim() || !supPhone.trim()) return;
    const id = makeSafeId(`sup_${slugify(supName)}_${Date.now().toString().slice(-4)}`);
    const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'suppliers', id), {
        name: supName.trim(),
        contactPerson: supContact.trim(),
        phone: supPhone.trim(),
        city: supCity.trim(),
        catalogSummary: supCatalog.trim(),
        totalPurchased: 0,
        totalPaid: 0,
        outstandingPayable: 0,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      setSupName('');
      setSupContact('');
      setSupPhone('');
      setSupCatalog('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'suppliers');
    }
  };

  const handlePaySupplier = async (sup: Supplier, amount: number) => {
    if (amount <= 0) return;
    const paid = Math.min(sup.outstandingPayable, amount);
    try {
      await updateDoc(doc(db, 'suppliers', sup.id), {
        totalPaid: sup.totalPaid + paid,
        outstandingPayable: Math.max(0, sup.outstandingPayable - paid),
        updatedAt: new Date().toISOString(),
      });
      await logAuditEvent({
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        actorRole: currentUser.role,
        action: 'SUPPLIER_PAYMENT',
        entityType: 'suppliers',
        entityId: sup.id,
        details: `Paid ${formatPKR(paid)} to ${sup.name}`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `suppliers/${sup.id}`);
    }
  };

  const handleCreatePurchaseOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const sup = suppliers.find((s) => s.id === poSupplierId);
    const variant = variants.find((v) => v.id === poVariantId);
    if (!sup || !variant) return;
    const prod = products.find((p) => p.id === variant.productId);
    const qty = Math.max(1, Number(poQty) || 1);
    const cost = Math.max(0, Number(poCost) || 0);
    const totalCost = qty * cost;
    const poId = makeSafeId(`po_${Date.now()}`);
    const poNumber = generatePoNumber();
    const now = new Date().toISOString();

    try {
      await setDoc(doc(db, 'purchase_orders', poId), {
        poNumber,
        supplierId: sup.id,
        supplierName: sup.name,
        status: isOwner || isAdmin ? 'APPROVED' : 'REQUESTED',
        totalCost,
        paidAmount: 0,
        linkedOrderId: poLinkedOrder.trim(),
        requestedBy: currentUser.uid,
        approvedBy: isOwner || isAdmin ? currentUser.uid : '',
        createdAt: now,
        updatedAt: now,
      });

      await setDoc(doc(db, 'purchase_items', makeSafeId(`poi_${poId}_1`)), {
        poId,
        productId: variant.productId,
        variantId: variant.id,
        sku: variant.sku,
        productName: `${prod?.name || 'Product'} (${variant.size}/${variant.color})`,
        orderedQty: qty,
        receivedQty: 0,
        unitCost: cost,
        lineTotal: totalCost,
      });

      setPoLinkedOrder('');
      setStatusNotice(`Created Procurement PO ${poNumber}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'purchase_orders');
    }
  };

  // ---------------------------------------------------------------------------
  // Orders, Courier & Payment Verification State
  // ---------------------------------------------------------------------------
  const [orderStatusFilter, setOrderStatusFilter] = useState<'ALL' | OrderStatus>('ALL');
  const [orderSearch, setOrderSearch] = useState('');
  const [dispatchModalOrder, setDispatchModalOrder] = useState<Order | null>(null);
  const [dispCourier, setDispCourier] = useState(settings.courierProviders[0] || 'TCS');
  const [dispTracking, setDispTracking] = useState('');
  const [dispShippingCost, setDispShippingCost] = useState(String(settings.shippingCharges || 250));

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (orderStatusFilter !== 'ALL' && o.status !== orderStatusFilter) return false;
      if (orderSearch.trim()) {
        const q = orderSearch.toLowerCase();
        return (
          o.orderNumber.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.customerPhone.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [orders, orderStatusFilter, orderSearch]);

  const handleDispatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchModalOrder || !dispTracking.trim()) return;
    const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'shipments', makeSafeId(`shp_${dispatchModalOrder.id}`)), {
        orderId: dispatchModalOrder.id,
        orderNumber: dispatchModalOrder.orderNumber,
        courierCompany: dispCourier,
        shipmentNumber: `SHP-${dispatchModalOrder.orderNumber.slice(-6)}`,
        trackingNumber: dispTracking.trim(),
        dispatchDate: now.slice(0, 10),
        expectedDeliveryDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
        shippingCharges: Number(dispShippingCost) || 0,
        codAmount: dispatchModalOrder.paymentMethod === 'COD' ? dispatchModalOrder.totalAmount : 0,
        deliveryStatus: 'IN_TRANSIT',
        codRemitted: false,
        remittedAmount: 0,
        createdAt: now,
        updatedAt: now,
      });

      await transitionOrderStatus({
        order: dispatchModalOrder,
        nextStatus: 'DISPATCHED',
        actor: currentUser,
        courierCompany: dispCourier,
        trackingNumber: dispTracking.trim(),
        note: `Dispatched via ${dispCourier} · Tracking #${dispTracking.trim()}`,
      });

      setDispatchModalOrder(null);
      setDispTracking('');
      setStatusNotice(`Dispatched ${dispatchModalOrder.orderNumber}`);
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Failed to dispatch order.');
    }
  };

  const handleVerifyPayment = async (payment: PaymentRecord, approved: boolean) => {
    const now = new Date().toISOString();
    try {
      await updateDoc(doc(db, 'payments', payment.id), {
        status: approved ? 'VERIFIED' : 'REJECTED',
        verifiedBy: currentUser.uid,
        verifiedAt: now,
      });
      await updateDoc(doc(db, 'orders', payment.orderId), {
        paymentStatus: approved ? 'VERIFIED' : 'PENDING',
        updatedAt: now,
      });
      await logAuditEvent({
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        actorRole: currentUser.role,
        action: approved ? 'VERIFY_PAYMENT' : 'REJECT_PAYMENT',
        entityType: 'payments',
        entityId: payment.id,
        details: `Order ${payment.orderNumber} (${formatPKR(payment.amount)})`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `payments/${payment.id}`);
    }
  };

  const handleReconcileCod = async (shipment: ShipmentRecord) => {
    const now = new Date().toISOString();
    try {
      await updateDoc(doc(db, 'shipments', shipment.id), {
        deliveryStatus: 'DELIVERED',
        codRemitted: true,
        remittedAmount: shipment.codAmount || 0,
        updatedAt: now,
      });
      await updateDoc(doc(db, 'orders', shipment.orderId), {
        paymentStatus: 'RECONCILED',
        updatedAt: now,
      });
      await updateDoc(doc(db, 'payments', `${shipment.orderId}_pay`), {
        status: 'RECONCILED',
        verifiedBy: currentUser.uid,
        verifiedAt: now,
      });
      await logAuditEvent({
        actorUid: currentUser.uid,
        actorEmail: currentUser.email,
        actorRole: currentUser.role,
        action: 'RECONCILE_COD',
        entityType: 'shipments',
        entityId: shipment.id,
        details: `Reconciled COD ${formatPKR(shipment.codAmount || 0)} for ${shipment.orderNumber}`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `shipments/${shipment.id}`);
    }
  };

  const handleSeedDev = async () => {
    if (!import.meta.env.DEV) return;
    setSeedBusy(true);
    try {
      await seedDevelopmentData(currentUser);
      setStatusNotice('Development sample dataset populated in Firestore.');
    } catch (err) {
      setStatusNotice(err instanceof Error ? err.message : 'Seed failed.');
    } finally {
      setSeedBusy(false);
    }
  };

  const navItems: { id: AdminSection; label: string; icon: React.ReactNode; visible: boolean }[] = [
    { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" />, visible: isAdmin },
    { id: 'orders', label: `Orders (${orders.length})`, icon: <ShoppingCart className="w-4 h-4" />, visible: true },
    { id: 'products', label: `Products (${products.length})`, icon: <Package className="w-4 h-4" />, visible: isInventoryMgr },
    { id: 'inventory', label: 'Own Inventory (FIFO)', icon: <Boxes className="w-4 h-4" />, visible: isInventoryMgr },
    { id: 'suppliers', label: 'Suppliers & Procurement', icon: <Truck className="w-4 h-4" />, visible: isInventoryMgr },
    { id: 'payments-courier', label: 'Payments & Courier', icon: <FileSpreadsheet className="w-4 h-4" />, visible: isAdmin || isPacking || isSalesMgr },
    { id: 'customers', label: 'Customers & Reviews', icon: <Users className="w-4 h-4" />, visible: isSalesMgr },
    { id: 'team', label: 'Team, Salesmen & Payroll', icon: <Sliders className="w-4 h-4" />, visible: isAdmin },
    { id: 'marketing', label: 'Marketing & Coupons', icon: <Megaphone className="w-4 h-4" />, visible: isSalesMgr },
    { id: 'accounts', label: 'Accounts & P&L', icon: <BookOpen className="w-4 h-4" />, visible: isAdmin },
    { id: 'audit', label: 'Audit Logs', icon: <Database className="w-4 h-4" />, visible: isOwner },
    { id: 'settings', label: 'Business Settings', icon: <SettingsIcon className="w-4 h-4" />, visible: isAdmin },
  ];

  const maxChartVal = Math.max(1, ...dashboardStats.chartDays.map((d) => d.total));

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#0F172A] text-slate-200 flex flex-col transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-5 h-16 border-b border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white truncate">{settings.brandName}</p>
            <p className="text-[11px] text-slate-400">{currentUser.role}</p>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems
            .filter((n) => n.visible)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSection(item.id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors text-left ${
                  section === item.id
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
        </nav>

        <div className="p-3 border-t border-slate-800 space-y-2">
          <button
            type="button"
            onClick={onBackToStore}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white rounded-lg hover:bg-white/5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> View Customer Storefront
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-lg hover:bg-white/5"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 border border-slate-200 rounded-lg"
            >
              <Menu className="w-4 h-4" />
            </button>
            <h1 className="text-base font-semibold text-slate-900 capitalize">
              {navItems.find((n) => n.id === section)?.label || 'Operations'}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {import.meta.env.DEV && isOwner && (
              <button
                type="button"
                disabled={seedBusy}
                onClick={handleSeedDev}
                className="px-3 py-1.5 text-xs font-medium border border-amber-300 bg-amber-50 text-amber-900 rounded-lg hover:bg-amber-100 whitespace-nowrap"
              >
                {seedBusy ? 'Seeding...' : 'Dev Seed Sample Data'}
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={onOpenWizard}
                className="px-3.5 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 whitespace-nowrap"
              >
                Setup Wizard
              </button>
            )}
          </div>
        </header>

        {statusNotice && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-2.5 text-xs text-emerald-900 flex items-center justify-between">
            <span>{statusNotice}</span>
            <button type="button" onClick={() => setStatusNotice('')}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <main className="p-4 sm:p-8 flex-1 space-y-6 overflow-x-hidden">
          {/* OVERVIEW DASHBOARD */}
          {section === 'overview' && isAdmin && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {[
                  { label: "Today's Sales", value: formatPKR(dashboardStats.todaySales) },
                  { label: 'Monthly Sales', value: formatPKR(dashboardStats.monthlySales) },
                  { label: 'Total Orders', value: String(dashboardStats.totalOrders) },
                  { label: 'Pending Orders', value: String(dashboardStats.pendingOrders) },
                  { label: 'Delivered Orders', value: String(dashboardStats.deliveredOrders) },
                  { label: 'Cancelled Orders', value: String(dashboardStats.cancelledOrders) },
                  { label: 'Total Products', value: String(dashboardStats.totalProducts) },
                  { label: 'Low Stock Variants', value: String(dashboardStats.lowStockCount) },
                  { label: 'Inventory Valuation', value: formatPKR(dashboardStats.inventoryValuation) },
                  { label: 'Gross Profit (Delivered)', value: formatPKR(dashboardStats.grossProfit) },
                  { label: 'Net Profit (Month)', value: formatPKR(dashboardStats.netProfit) },
                  { label: 'Monthly Expenses', value: formatPKR(dashboardStats.monthlyExpenses) },
                  { label: 'Supplier Payable', value: formatPKR(dashboardStats.supplierPayable) },
                  { label: 'COD Pending', value: formatPKR(dashboardStats.codPending) },
                  { label: 'Active Salesmen', value: String(salesmen.filter((s) => s.active).length) },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-white border border-slate-200 rounded-xl p-4">
                    <p className="text-[11px] text-slate-500">{kpi.label}</p>
                    <p className="text-lg font-semibold text-slate-900 mt-1 tabular-nums">
                      {kpi.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* 7-Day Sales Bar Chart */}
                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-900">
                      7-Day Order Volume (PKR)
                    </h2>
                    <span className="text-xs text-slate-500">Live Firestore Orders</span>
                  </div>
                  <div className="h-48 flex items-end gap-3 pt-4">
                    {dashboardStats.chartDays.map((d, idx) => {
                      const pct = Math.max(4, Math.round((d.total / maxChartVal) * 100));
                      return (
                        <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                          <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                            {d.total > 0 ? `${Math.round(d.total / 1000)}k` : '0'}
                          </span>
                          <div className="w-full bg-slate-100 rounded-t-md h-32 flex items-end overflow-hidden">
                            <div
                              className="w-full bg-slate-900 rounded-t-md transition-all"
                              style={{ height: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[11px] text-slate-600">{d.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Low Stock Alerts & Salesman Leaderboard */}
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Low Stock Variants (&lt; 5 units)
                  </h2>
                  {dashboardStats.lowStockVariants.length === 0 ? (
                    <p className="text-xs text-slate-500">All active variants have healthy stock levels.</p>
                  ) : (
                    <div className="divide-y divide-slate-100 text-xs max-h-48 overflow-y-auto">
                      {dashboardStats.lowStockVariants.map((v) => (
                        <div key={v.id} className="py-2 flex items-center justify-between">
                          <div>
                            <span className="font-mono font-semibold text-slate-900">{v.sku}</span>
                            <span className="text-slate-500 ml-2">
                              {v.size} / {v.color}
                            </span>
                          </div>
                          <span className="font-semibold text-red-700 tabular-nums">
                            {v.stockAvailable} left
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* PRODUCTS & VARIANTS */}
          {section === 'products' && isInventoryMgr && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <form
                onSubmit={handleSaveProduct}
                className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900">
                    {prodEditId ? 'Edit Product' : 'Create Product & Variants'}
                  </h2>
                  {prodEditId && (
                    <button
                      type="button"
                      onClick={() => {
                        setProdEditId(null);
                        setProdName('');
                        setProdSku('');
                      }}
                      className="text-xs text-slate-500 underline"
                    >
                      New Product
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Product Name</label>
                    <input
                      type="text"
                      required
                      value={prodName}
                      onChange={(e) => setProdName(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">SKU Prefix</label>
                    <input
                      type="text"
                      required
                      value={prodSku}
                      onChange={(e) => setProdSku(e.target.value.toUpperCase())}
                      placeholder="ZL-LWN-105"
                      className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Category</label>
                    <select
                      value={prodCatId}
                      onChange={(e) => setProdCatId(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Audience</label>
                    <select
                      value={prodAudience}
                      onChange={(e) => setProdAudience(e.target.value as AudienceType)}
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Ladies">Ladies</option>
                      <option value="Gents">Gents</option>
                      <option value="Both">Both</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Selling Price (PKR)</label>
                    <input
                      type="number"
                      required
                      value={prodPrice}
                      onChange={(e) => setProdPrice(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Discount %</label>
                    <input
                      type="number"
                      min={0}
                      max={90}
                      value={prodDiscount}
                      onChange={(e) => setProdDiscount(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg tabular-nums"
                    />
                  </div>
                </div>

                {!prodEditId && (
                  <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">
                        Initial Qty / Variant
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={prodInitQty}
                        onChange={(e) => setProdInitQty(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">
                        Purchase Cost (PKR, hidden)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={prodInitCost}
                        onChange={(e) => setProdInitCost(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white tabular-nums"
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Sizes (comma-sep)</label>
                    <input
                      type="text"
                      value={prodSizes}
                      onChange={(e) => setProdSizes(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Colors (comma-sep)</label>
                    <input
                      type="text"
                      value={prodColors}
                      onChange={(e) => setProdColors(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">Fabric</label>
                  <input
                    type="text"
                    value={prodFabric}
                    onChange={(e) => setProdFabric(e.target.value)}
                    placeholder="e.g. 100% Swiss Cotton Lawn"
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">Image URL</label>
                  <input
                    type="text"
                    value={prodImage}
                    onChange={(e) => setProdImage(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">Description</label>
                  <textarea
                    rows={2}
                    value={prodDesc}
                    onChange={(e) => setProdDesc(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <button
                  type="submit"
                  disabled={prodSaving}
                  className="w-full py-2.5 text-xs font-medium bg-slate-900 text-white rounded-lg"
                >
                  {prodSaving ? 'Saving...' : prodEditId ? 'Update Product' : 'Publish Product'}
                </button>
              </form>

              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Catalog ({products.length} products · {variants.length} variants)
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-medium">Product</th>
                        <th className="px-4 py-3 font-medium">SKU</th>
                        <th className="px-4 py-3 font-medium">Price</th>
                        <th className="px-4 py-3 font-medium">Stock</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {products.map((p) => (
                        <tr key={p.id}>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-900">{p.name}</p>
                            <p className="text-slate-500">
                              {p.categoryName} · {p.audience}
                            </p>
                          </td>
                          <td className="px-4 py-3 font-mono">{p.sku}</td>
                          <td className="px-4 py-3 tabular-nums">{formatPKR(p.sellingPrice)}</td>
                          <td className="px-4 py-3 tabular-nums font-medium">
                            {p.totalAvailable || 0}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() =>
                                updateDoc(doc(db, 'products', p.id), {
                                  active: !p.active,
                                  updatedAt: new Date().toISOString(),
                                })
                              }
                              className={`font-medium ${p.active ? 'text-emerald-700' : 'text-slate-400'}`}
                            >
                              {p.active ? 'Active' : 'Inactive'}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => {
                                setProdEditId(p.id);
                                setProdName(p.name);
                                setProdSku(p.sku);
                                setProdCatId(p.categoryId);
                                setProdAudience(p.audience);
                                setProdPrice(String(p.sellingPrice));
                                setProdDiscount(String(p.discountPercent || 0));
                                setProdFabric(p.fabric || '');
                                setProdDesc(p.description || '');
                                setProdImage(p.images[0] || '');
                              }}
                              className="text-slate-700 underline"
                            >
                              Edit
                            </button>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => handleDeleteProduct(p)}
                                className="text-red-600 hover:underline"
                              >
                                <Trash2 className="w-3.5 h-3.5 inline" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* OWN INVENTORY (FIFO) */}
          {section === 'inventory' && isInventoryMgr && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <form
                  onSubmit={handleAddOwnStockBatch}
                  className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
                >
                  <h3 className="text-sm font-semibold text-slate-900">
                    Record Own Stock Receipt (FIFO Batch)
                  </h3>
                  <select
                    required
                    value={stockVariantId}
                    onChange={(e) => setStockVariantId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Select Product Variant...</option>
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.sku} ({v.size} / {v.color}) · Avail: {v.stockAvailable}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">Quantity</label>
                      <input
                        type="number"
                        required
                        min={1}
                        value={stockQty}
                        onChange={(e) => setStockQty(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">Purchase Cost (PKR)</label>
                      <input
                        type="number"
                        required
                        min={0}
                        value={stockCost}
                        onChange={(e) => setStockCost(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                      />
                    </div>
                  </div>
                  <input
                    type="text"
                    value={stockLoc}
                    onChange={(e) => setStockLoc(e.target.value)}
                    placeholder="Warehouse location"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                  <button
                    type="submit"
                    className="w-full py-2.5 text-xs font-medium bg-slate-900 text-white rounded-lg"
                  >
                    Receive Own Stock Batch
                  </button>
                </form>

                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center">
                    <h3 className="text-sm font-semibold text-slate-900">
                      FIFO Inventory Batches ({inventory.length})
                    </h3>
                    <span className="text-xs font-semibold tabular-nums">
                      Total Valuation: {formatPKR(dashboardStats.inventoryValuation)}
                    </span>
                  </div>
                  <div className="overflow-x-auto max-h-80">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="px-4 py-2.5 font-medium">SKU / Batch</th>
                          <th className="px-4 py-2.5 font-medium">Unit Cost</th>
                          <th className="px-4 py-2.5 font-medium">Initial</th>
                          <th className="px-4 py-2.5 font-medium">Remaining</th>
                          <th className="px-4 py-2.5 font-medium text-right">Batch Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {inventory.map((b) => (
                          <tr key={b.id}>
                            <td className="px-4 py-2.5">
                              <p className="font-mono font-semibold">{b.sku}</p>
                              <p className="text-[11px] text-slate-400">{b.batchCode}</p>
                            </td>
                            <td className="px-4 py-2.5 tabular-nums">{formatPKR(b.purchaseCost)}</td>
                            <td className="px-4 py-2.5 tabular-nums">{b.initialQty}</td>
                            <td className="px-4 py-2.5 tabular-nums font-semibold">
                              {b.remainingQty}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {formatPKR(b.remainingQty * b.purchaseCost)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Stock Movement Audit Trail */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Inventory Movement Audit Trail ({movements.length})
                  </h3>
                </div>
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Time</th>
                        <th className="px-4 py-2.5 font-medium">Type</th>
                        <th className="px-4 py-2.5 font-medium">SKU</th>
                        <th className="px-4 py-2.5 font-medium">Qty</th>
                        <th className="px-4 py-2.5 font-medium">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {movements.slice(0, 60).map((m) => (
                        <tr key={m.id}>
                          <td className="px-4 py-2 tabular-nums text-slate-500">
                            {formatDateTime(m.createdAt)}
                          </td>
                          <td className="px-4 py-2 font-mono font-semibold">{m.type}</td>
                          <td className="px-4 py-2 font-mono">{m.sku || m.variantId}</td>
                          <td className="px-4 py-2 tabular-nums">{m.quantity}</td>
                          <td className="px-4 py-2 text-slate-600">{m.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SUPPLIERS & PROCUREMENT */}
          {section === 'suppliers' && isInventoryMgr && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <form
                  onSubmit={handleCreateSupplier}
                  className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
                >
                  <h3 className="text-sm font-semibold text-slate-900">Add Supplier</h3>
                  <input
                    type="text"
                    required
                    value={supName}
                    onChange={(e) => setSupName(e.target.value)}
                    placeholder="Supplier / Mill Name"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={supContact}
                      onChange={(e) => setSupContact(e.target.value)}
                      placeholder="Contact Person"
                      className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                    <input
                      type="text"
                      required
                      value={supPhone}
                      onChange={(e) => setSupPhone(e.target.value)}
                      placeholder="Phone"
                      className="px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <input
                    type="text"
                    value={supCity}
                    onChange={(e) => setSupCity(e.target.value)}
                    placeholder="City"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                  <input
                    type="text"
                    value={supCatalog}
                    onChange={(e) => setSupCatalog(e.target.value)}
                    placeholder="Catalog / Fabrics supplied"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                  <button
                    type="submit"
                    className="w-full py-2.5 text-xs font-medium bg-slate-900 text-white rounded-lg"
                  >
                    Save Supplier
                  </button>
                </form>

                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Suppliers &amp; Payables ({suppliers.length})
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="px-4 py-3 font-medium">Supplier</th>
                          <th className="px-4 py-3 font-medium">Purchased</th>
                          <th className="px-4 py-3 font-medium">Paid</th>
                          <th className="px-4 py-3 font-medium">Outstanding</th>
                          <th className="px-4 py-3 font-medium text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {suppliers.map((s) => (
                          <tr key={s.id}>
                            <td className="px-4 py-3">
                              <p className="font-semibold text-slate-900">{s.name}</p>
                              <p className="text-slate-500">
                                {s.city} · {s.phone}
                              </p>
                            </td>
                            <td className="px-4 py-3 tabular-nums">{formatPKR(s.totalPurchased)}</td>
                            <td className="px-4 py-3 tabular-nums text-emerald-700">
                              {formatPKR(s.totalPaid)}
                            </td>
                            <td className="px-4 py-3 tabular-nums font-semibold text-red-700">
                              {formatPKR(s.outstandingPayable)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {s.outstandingPayable > 0 && isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handlePaySupplier(s, s.outstandingPayable)}
                                  className="text-xs font-medium text-emerald-700 underline"
                                >
                                  Settle Balance
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Procurement Requests & Purchase Orders */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <form
                  onSubmit={handleCreatePurchaseOrder}
                  className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
                >
                  <h3 className="text-sm font-semibold text-slate-900">
                    Create Procurement / Purchase Order
                  </h3>
                  <select
                    required
                    value={poSupplierId}
                    onChange={(e) => setPoSupplierId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Select Supplier...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <select
                    required
                    value={poVariantId}
                    onChange={(e) => setPoVariantId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Select Variant to Procure...</option>
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.sku} ({v.size}/{v.color})
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      required
                      min={1}
                      value={poQty}
                      onChange={(e) => setPoQty(e.target.value)}
                      placeholder="Qty"
                      className="px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                    />
                    <input
                      type="number"
                      required
                      min={0}
                      value={poCost}
                      onChange={(e) => setPoCost(e.target.value)}
                      placeholder="Unit Cost"
                      className="px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                    />
                  </div>
                  <input
                    type="text"
                    value={poLinkedOrder}
                    onChange={(e) => setPoLinkedOrder(e.target.value)}
                    placeholder="Linked Customer Order # (optional)"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                  <button
                    type="submit"
                    className="w-full py-2.5 text-xs font-medium bg-slate-900 text-white rounded-lg inline-flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Submit Purchase Order
                  </button>
                </form>

                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Purchase Orders &amp; Goods Receiving ({purchaseOrders.length})
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="px-4 py-3 font-medium">PO #</th>
                          <th className="px-4 py-3 font-medium">Supplier</th>
                          <th className="px-4 py-3 font-medium">Total Cost</th>
                          <th className="px-4 py-3 font-medium">Status</th>
                          <th className="px-4 py-3 font-medium text-right">Workflow Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {purchaseOrders.map((po) => {
                          const poItems = purchaseItems.filter((i) => i.poId === po.id);
                          const sup = suppliers.find((s) => s.id === po.supplierId);
                          return (
                            <tr key={po.id}>
                              <td className="px-4 py-3 font-mono font-semibold">
                                {po.poNumber}
                                {po.linkedOrderId && (
                                  <p className="text-[10px] text-amber-700">
                                    For {po.linkedOrderId}
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3">{po.supplierName || po.supplierId}</td>
                              <td className="px-4 py-3 tabular-nums font-semibold">
                                {formatPKR(po.totalCost)}
                              </td>
                              <td className="px-4 py-3 font-medium">{po.status}</td>
                              <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                                {po.status === 'REQUESTED' && isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateDoc(doc(db, 'purchase_orders', po.id), {
                                        status: 'APPROVED',
                                        approvedBy: currentUser.uid,
                                        updatedAt: new Date().toISOString(),
                                      })
                                    }
                                    className="px-2.5 py-1 text-xs font-medium bg-slate-900 text-white rounded"
                                  >
                                    Approve
                                  </button>
                                )}
                                {['APPROVED', 'ORDERED'].includes(po.status) && sup && poItems.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      receivePurchaseOrderAtomic({
                                        po,
                                        items: poItems,
                                        supplier: sup,
                                        actor: currentUser,
                                      }).then(() => setStatusNotice(`Received stock for ${po.poNumber}`))
                                    }
                                    className="px-2.5 py-1 text-xs font-medium bg-emerald-700 text-white rounded"
                                  >
                                    Receive Goods to Stock
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ORDERS WORKFLOW */}
          {section === 'orders' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      'ALL',
                      'NEW',
                      'CONFIRMED',
                      'AWAITING_PURCHASE',
                      'PROCESSING',
                      'PACKED',
                      'DISPATCHED',
                      'DELIVERED',
                      'CANCELLED',
                      'RETURNED',
                      'REFUNDED',
                    ] as const
                  ).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setOrderStatusFilter(st)}
                      className={`px-2.5 py-1.5 text-[11px] font-medium rounded-lg border ${
                        orderStatusFilter === st
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200'
                      }`}
                    >
                      {st === 'ALL' ? 'All' : ORDER_STATUS_LABELS[st]}
                    </button>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    placeholder="Search order #, phone..."
                    className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                  />
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() =>
                        downloadCsv(
                          `orders-${new Date().toISOString().slice(0, 10)}.csv`,
                          ['Order #', 'Date', 'Customer', 'Phone', 'City', 'Source', 'Status', 'Payment', 'Total (PKR)'],
                          filteredOrders.map((o) => [
                            o.orderNumber,
                            o.createdAt,
                            o.customerName,
                            o.customerPhone,
                            o.customerCity,
                            o.source,
                            o.status,
                            o.paymentStatus,
                            o.totalAmount,
                          ])
                        )
                      }
                      className="px-3 py-1.5 text-xs font-medium border border-slate-300 bg-white rounded-lg inline-flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" /> CSV
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-medium">Order</th>
                        <th className="px-4 py-3 font-medium">Customer</th>
                        <th className="px-4 py-3 font-medium">Items</th>
                        <th className="px-4 py-3 font-medium">Payment</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium text-right">Total</th>
                        <th className="px-4 py-3 font-medium text-right">Transition</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredOrders.map((ord) => {
                        const transitions = ALLOWED_ORDER_TRANSITIONS[ord.status] || [];
                        return (
                          <tr key={ord.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <p className="font-mono font-semibold text-slate-900">{ord.orderNumber}</p>
                              <p className="text-[11px] text-slate-400">
                                {ord.source} {ord.salesmanName ? `· ${ord.salesmanName}` : ''}
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-900">{ord.customerName}</p>
                              <p className="text-slate-500 font-mono">
                                {ord.customerPhone} · {ord.customerCity}
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              {ord.itemsSummary?.map((it, idx) => (
                                <p key={idx} className="text-slate-700">
                                  {it.quantity}× {it.productName} ({it.size})
                                </p>
                              ))}
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium">{ord.paymentMethod}</p>
                              <p className="text-[11px] text-slate-500">{ord.paymentStatus}</p>
                            </td>
                            <td className="px-4 py-3 font-semibold text-slate-900">
                              {ORDER_STATUS_LABELS[ord.status]}
                              {ord.trackingNumber && (
                                <p className="text-[11px] font-mono text-slate-500">
                                  {ord.courierCompany}: {ord.trackingNumber}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums">
                              {formatPKR(ord.totalAmount)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex flex-wrap justify-end gap-1.5">
                                {transitions.map((nextSt) =>
                                  nextSt === 'DISPATCHED' ? (
                                    <button
                                      key={nextSt}
                                      type="button"
                                      onClick={() => setDispatchModalOrder(ord)}
                                      className="px-2.5 py-1 text-[11px] font-medium bg-slate-900 text-white rounded"
                                    >
                                      Dispatch
                                    </button>
                                  ) : (
                                    <button
                                      key={nextSt}
                                      type="button"
                                      onClick={() =>
                                        transitionOrderStatus({
                                          order: ord,
                                          nextStatus: nextSt,
                                          actor: currentUser,
                                        }).then(() =>
                                          setStatusNotice(`${ord.orderNumber} -> ${nextSt}`)
                                        )
                                      }
                                      className={`px-2 py-1 text-[11px] font-medium rounded border ${
                                        nextSt === 'CANCELLED'
                                          ? 'border-red-200 text-red-700 hover:bg-red-50'
                                          : 'border-slate-300 text-slate-800 hover:bg-slate-100'
                                      }`}
                                    >
                                      {ORDER_STATUS_LABELS[nextSt]}
                                    </button>
                                  )
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {dispatchModalOrder && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                  <form
                    onSubmit={handleDispatchSubmit}
                    className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4"
                  >
                    <h3 className="text-base font-semibold">
                      Book Courier &amp; Dispatch {dispatchModalOrder.orderNumber}
                    </h3>
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">Courier Company</label>
                      <select
                        value={dispCourier}
                        onChange={(e) => setDispCourier(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        {settings.courierProviders.map((cp) => (
                          <option key={cp} value={cp}>{cp}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">Tracking Number</label>
                      <input
                        type="text"
                        required
                        value={dispTracking}
                        onChange={(e) => setDispTracking(e.target.value)}
                        placeholder="CN / Consignment #"
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">Courier Fee (PKR)</label>
                      <input
                        type="number"
                        value={dispShippingCost}
                        onChange={(e) => setDispShippingCost(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setDispatchModalOrder(null)}
                        className="px-4 py-2 text-xs border border-slate-300 rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg"
                      >
                        Confirm Dispatch
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* PAYMENTS & COURIER RECONCILIATION */}
          {section === 'payments-courier' && (
            <div className="space-y-6">
              {isAdmin && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Payment Verification Queue ({payments.length})
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="px-4 py-3 font-medium">Order #</th>
                          <th className="px-4 py-3 font-medium">Method</th>
                          <th className="px-4 py-3 font-medium">Ref / Proof</th>
                          <th className="px-4 py-3 font-medium">Amount</th>
                          <th className="px-4 py-3 font-medium">Status</th>
                          <th className="px-4 py-3 font-medium text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {payments.map((p) => (
                          <tr key={p.id}>
                            <td className="px-4 py-3 font-mono font-semibold">{p.orderNumber}</td>
                            <td className="px-4 py-3">{p.method}</td>
                            <td className="px-4 py-3">
                              <span className="font-mono">{p.transactionRef || '—'}</span>
                              {p.proofNote && <p className="text-slate-500">{p.proofNote}</p>}
                            </td>
                            <td className="px-4 py-3 tabular-nums font-semibold">
                              {formatPKR(p.amount)}
                            </td>
                            <td className="px-4 py-3 font-medium">{p.status}</td>
                            <td className="px-4 py-3 text-right space-x-2">
                              {p.status === 'PENDING' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleVerifyPayment(p, true)}
                                    className="px-2.5 py-1 text-xs font-medium bg-emerald-700 text-white rounded"
                                  >
                                    Verify
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleVerifyPayment(p, false)}
                                    className="px-2.5 py-1 text-xs font-medium border border-red-200 text-red-700 rounded"
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Courier Shipments &amp; COD Remittance ({shipments.length})
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-medium">Order #</th>
                        <th className="px-4 py-3 font-medium">Courier &amp; Tracking</th>
                        <th className="px-4 py-3 font-medium">COD Amount</th>
                        <th className="px-4 py-3 font-medium">Delivery</th>
                        <th className="px-4 py-3 font-medium text-right">COD Remittance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {shipments.map((sh) => (
                        <tr key={sh.id}>
                          <td className="px-4 py-3 font-mono font-semibold">{sh.orderNumber}</td>
                          <td className="px-4 py-3">
                            {sh.courierCompany} · <span className="font-mono">{sh.trackingNumber}</span>
                          </td>
                          <td className="px-4 py-3 tabular-nums font-semibold">
                            {formatPKR(sh.codAmount || 0)}
                          </td>
                          <td className="px-4 py-3">{sh.deliveryStatus}</td>
                          <td className="px-4 py-3 text-right">
                            {sh.codRemitted ? (
                              <span className="text-emerald-700 font-semibold inline-flex items-center gap-1">
                                <Check className="w-3.5 h-3.5" /> Reconciled
                              </span>
                            ) : isAdmin ? (
                              <button
                                type="button"
                                onClick={() => handleReconcileCod(sh)}
                                className="px-2.5 py-1 text-xs font-medium bg-slate-900 text-white rounded"
                              >
                                Mark COD Received
                              </button>
                            ) : (
                              <span className="text-slate-400">Pending</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* CUSTOMERS & REVIEWS */}
          {section === 'customers' && isSalesMgr && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Customer Profiles &amp; Segmentation ({customers.length})
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-medium">Customer</th>
                        <th className="px-4 py-3 font-medium">Mobile</th>
                        <th className="px-4 py-3 font-medium">City</th>
                        <th className="px-4 py-3 font-medium">Segment</th>
                        <th className="px-4 py-3 font-medium">Orders</th>
                        <th className="px-4 py-3 font-medium text-right">Total Spent</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {customers.map((c) => (
                        <tr key={c.id}>
                          <td className="px-4 py-3 font-semibold text-slate-900">{c.name}</td>
                          <td className="px-4 py-3 font-mono">{c.phone}</td>
                          <td className="px-4 py-3">{c.city}</td>
                          <td className="px-4 py-3">{c.segment}</td>
                          <td className="px-4 py-3 tabular-nums">{c.totalOrders}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold">
                            {formatPKR(c.totalSpent)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {isAdmin && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Customer Review Moderation ({reviews.length})
                    </h3>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {reviews.map((rev) => (
                      <div key={rev.id} className="p-4 flex items-center justify-between gap-4 text-xs">
                        <div>
                          <p className="font-semibold text-slate-900">
                            {rev.customerName} · {rev.rating}/5 · <span className="text-slate-500">{rev.status}</span>
                          </p>
                          <p className="text-slate-600 mt-0.5">{rev.comment}</p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => updateDoc(doc(db, 'reviews', rev.id), { status: 'APPROVED' })}
                            className="px-2.5 py-1 bg-emerald-700 text-white rounded"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => updateDoc(doc(db, 'reviews', rev.id), { status: 'REJECTED' })}
                            className="px-2.5 py-1 border border-red-200 text-red-700 rounded"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {section === 'team' && isAdmin && (
            <TeamSalesmenPayrollPanel
              users={users}
              invites={invites}
              salesmen={salesmen}
              salesTargets={salesTargets}
              commissions={commissions}
              salaries={salaries}
              actor={currentUser}
            />
          )}

          {section === 'marketing' && isSalesMgr && (
            <MarketingCouponsPanel
              coupons={coupons}
              campaigns={campaigns}
              abandonedCarts={abandonedCarts}
              orders={orders}
            />
          )}

          {section === 'accounts' && isAdmin && (
            <AccountsReportsPanel
              orders={orders}
              financials={financials}
              expenses={expenses}
              salaries={salaries}
              commissions={commissions}
              payments={payments}
              suppliers={suppliers}
              batches={inventory}
              actor={currentUser}
            />
          )}

          {section === 'audit' && isOwner && <AuditLogsPanel logs={auditLogs} />}

          {section === 'settings' && isAdmin && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 max-w-2xl">
              <h2 className="text-base font-semibold text-slate-900">Business Configuration</h2>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-slate-500">Brand Name</p>
                  <p className="font-semibold text-slate-900 mt-0.5">{settings.brandName}</p>
                </div>
                <div>
                  <p className="text-slate-500">Audience Focus</p>
                  <p className="font-semibold text-slate-900 mt-0.5">{settings.audienceType}</p>
                </div>
                <div>
                  <p className="text-slate-500">Shipping Charge / Threshold</p>
                  <p className="font-semibold text-slate-900 mt-0.5 tabular-nums">
                    {formatPKR(settings.shippingCharges)} / Free above {formatPKR(settings.freeShippingThreshold)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">WhatsApp Number</p>
                  <p className="font-mono font-semibold text-slate-900 mt-0.5">
                    {settings.whatsappNumber || 'Not configured'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenWizard}
                className="px-5 py-2.5 text-xs font-medium bg-slate-900 text-white rounded-lg"
              >
                Edit All Settings in Setup Wizard
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
