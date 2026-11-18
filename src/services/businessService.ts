import { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  BOOTSTRAPPED_OWNER_EMAIL,
  db,
  handleFirestoreError,
  makeSafeId,
  OperationType,
} from '../lib/firebase';
import {
  ALLOWED_ORDER_TRANSITIONS,
  calculateBonusForSuits,
  currentMonthKey,
  DEFAULT_BONUS_TIERS,
  generateOrderNumber,
  generatePoNumber,
  slugify,
} from '../lib/format';
import {
  BusinessSettings,
  CartItem,
  Category,
  Coupon,
  InventoryBatch,
  Order,
  OrderItemSummary,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PurchaseItem,
  PurchaseOrder,
  SalesmanProfile,
  Supplier,
  UserProfile,
} from '../types';

export const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  brandName: 'PakAtelier',
  tagline: 'Contemporary Pakistani Apparel & Textile House',
  logoUrl: '',
  primaryColor: '#0F3D2E',
  accentColor: '#9A7B3E',
  audienceType: 'Both',
  contactEmail: '',
  phone: '',
  whatsappNumber: '',
  address: '',
  deliveryCoverage: 'Nationwide across Pakistan (Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad & 120+ cities)',
  courierProviders: ['TCS', 'Leopards Courier', 'Trax', 'PostEx', 'M&P'],
  returnPolicy: 'Unworn garments with original tags may be exchanged or returned within 7 days of delivery.',
  shippingPolicy: 'Standard nationwide courier delivery within 2–4 working days across Pakistan.',
  privacyPolicy: 'Customer contact and delivery records are used solely for order fulfillment, courier dispatch, and service updates.',
  termsPolicy: 'All orders are subject to stock confirmation and courier verification. Prices are listed in PKR.',
  aboutText: 'Crafted from fine Pakistani cottons, embroidered lawn, and tailored fabrics with transparent pricing and direct nationwide dispatch.',
  shippingCharges: 250,
  freeShippingThreshold: 5000,
  paymentMethods: ['COD', 'BANK_TRANSFER'],
  bankDetails: 'Configure your business IBAN / Easypaisa / JazzCash instructions in Business Settings.',
  currency: 'PKR',
  setupCompleted: false,
  salesmanDefaults: {
    monthlySalary: 40000,
    monthlyTargetSuits: 60,
    avgPurchasePrice: 1500,
    avgSellingPrice: 3000,
    bonusTiers: DEFAULT_BONUS_TIERS,
  },
  updatedAt: new Date().toISOString(),
};

export async function logAuditEvent(params: {
  actorUid: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: string;
}): Promise<void> {
  const id = makeSafeId(`aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  try {
    await setDoc(doc(db, 'audit_logs', id), {
      actorUid: params.actorUid,
      actorEmail: params.actorEmail || '',
      actorRole: params.actorRole || '',
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      details: (params.details || '').slice(0, 490),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('Audit log write skipped:', error);
  }
}

export async function fetchBusinessSettings(): Promise<BusinessSettings> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'business'));
    if (snap.exists()) {
      return { ...DEFAULT_BUSINESS_SETTINGS, ...(snap.data() as Partial<BusinessSettings>) };
    }
    return DEFAULT_BUSINESS_SETTINGS;
  } catch (error) {
    console.warn('Could not load settings/business, using initial template:', error);
    return DEFAULT_BUSINESS_SETTINGS;
  }
}

export async function saveBusinessSettings(
  settings: BusinessSettings,
  actor: UserProfile
): Promise<void> {
  const now = new Date().toISOString();
  const payload: BusinessSettings = {
    brandName: settings.brandName.trim().slice(0, 100) || 'PakAtelier',
    tagline: (settings.tagline || '').slice(0, 200),
    logoUrl: (settings.logoUrl || '').slice(0, 500),
    primaryColor: /^#[0-9A-Fa-f]{6}$/.test(settings.primaryColor) ? settings.primaryColor : '#0F3D2E',
    accentColor: /^#[0-9A-Fa-f]{6}$/.test(settings.accentColor) ? settings.accentColor : '#9A7B3E',
    audienceType: settings.audienceType,
    contactEmail: (settings.contactEmail || '').slice(0, 150),
    phone: (settings.phone || '').slice(0, 30),
    whatsappNumber: (settings.whatsappNumber || '').slice(0, 30),
    address: (settings.address || '').slice(0, 300),
    deliveryCoverage: (settings.deliveryCoverage || '').slice(0, 300),
    courierProviders: settings.courierProviders.slice(0, 15),
    returnPolicy: (settings.returnPolicy || '').slice(0, 2000),
    shippingPolicy: (settings.shippingPolicy || '').slice(0, 2000),
    privacyPolicy: (settings.privacyPolicy || '').slice(0, 2000),
    termsPolicy: (settings.termsPolicy || '').slice(0, 2000),
    aboutText: (settings.aboutText || '').slice(0, 2000),
    shippingCharges: Math.max(0, Number(settings.shippingCharges) || 0),
    freeShippingThreshold: Math.max(0, Number(settings.freeShippingThreshold) || 0),
    paymentMethods: settings.paymentMethods.length > 0 ? settings.paymentMethods : ['COD'],
    bankDetails: (settings.bankDetails || '').slice(0, 500),
    currency: 'PKR',
    setupCompleted: Boolean(settings.setupCompleted),
    salesmanDefaults: settings.salesmanDefaults || DEFAULT_BUSINESS_SETTINGS.salesmanDefaults,
    updatedAt: now,
  };

  try {
    await setDoc(doc(db, 'settings', 'business'), payload);
    await logAuditEvent({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'UPDATE_BUSINESS_SETTINGS',
      entityType: 'settings',
      entityId: 'business',
      details: `Updated configuration for ${payload.brandName}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/business');
  }
}

export async function syncUserProfile(firebaseUser: User): Promise<UserProfile> {
  const ref = doc(db, 'users', firebaseUser.uid);
  const now = new Date().toISOString();
  const email = (firebaseUser.email || '').toLowerCase();

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existing = snap.data() as UserProfile;
      if (email === BOOTSTRAPPED_OWNER_EMAIL && existing.role !== 'OWNER') {
        await updateDoc(ref, { role: 'OWNER', active: true, updatedAt: now });
        return { ...existing, role: 'OWNER', active: true, updatedAt: now };
      }
      return existing;
    }

    let assignedRole: UserProfile['role'] =
      email === BOOTSTRAPPED_OWNER_EMAIL ? 'OWNER' : 'CUSTOMER';
    let baseSalary = 0;

    if (email && email !== BOOTSTRAPPED_OWNER_EMAIL) {
      try {
        const inviteSnap = await getDoc(doc(db, 'staff_invites', email));
        if (inviteSnap.exists()) {
          const inv = inviteSnap.data();
          if (inv?.role) {
            assignedRole = inv.role;
            baseSalary = Number(inv.baseSalary) || 0;
          }
        }
      } catch {
        // Ignore if no invite exists
      }
    }

    const profile: UserProfile = {
      uid: firebaseUser.uid,
      email,
      displayName: (firebaseUser.displayName || email.split('@')[0] || 'User').slice(0, 120),
      phone: '',
      city: '',
      address: '',
      role: assignedRole,
      active: true,
      baseSalary,
      createdAt: now,
      updatedAt: now,
    };

    await setDoc(ref, profile);
    return profile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${firebaseUser.uid}`);
  }
}

export interface PlaceOrderInput {
  items: CartItem[];
  customerUid?: string;
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerAddress: string;
  paymentMethod: PaymentMethod;
  transactionRef?: string;
  proofNote?: string;
  couponCode?: string;
  referralCode?: string;
  salesmanId?: string;
  salesmanName?: string;
  source: OrderSource;
  shippingCharges: number;
  freeShippingThreshold: number;
  notes?: string;
  allowProcurementBackorder?: boolean;
}

export async function placeOrderAtomic(input: PlaceOrderInput): Promise<{
  orderNumber: string;
  totalAmount: number;
  status: OrderStatus;
}> {
  if (input.items.length === 0) {
    throw new Error('Cannot place an order with an empty bag.');
  }

  const orderNumber = generateOrderNumber();
  const now = new Date().toISOString();

  // Validate coupon if provided
  let appliedCoupon: Coupon | null = null;
  if (input.couponCode && input.couponCode.trim()) {
    const code = input.couponCode.trim().toUpperCase();
    try {
      const couponSnap = await getDoc(doc(db, 'coupons', code));
      if (couponSnap.exists()) {
        const c = { id: couponSnap.id, ...couponSnap.data() } as Coupon;
        if (c.active && (!c.maxUses || (c.usedCount || 0) < c.maxUses)) {
          appliedCoupon = c;
        }
      }
    } catch {
      // Ignore missing coupon
    }
  }

  try {
    let finalTotal = 0;
    let finalStatus: OrderStatus = 'NEW';

    await runTransaction(db, async (tx) => {
      // 1. Read all variants & products first
      const variantDocs = await Promise.all(
        input.items.map((item) => tx.get(doc(db, 'product_variants', item.variant.id)))
      );
      const uniqueProductIds = Array.from(new Set(input.items.map((i) => i.product.id)));
      const productDocs = await Promise.all(
        uniqueProductIds.map((pid) => tx.get(doc(db, 'products', pid)))
      );

      const productMap = new Map<string, { currentTotal: number }>();
      productDocs.forEach((pSnap, idx) => {
        if (!pSnap.exists()) {
          throw new Error(`Product ${uniqueProductIds[idx]} is no longer available.`);
        }
        const pData = pSnap.data();
        productMap.set(uniqueProductIds[idx], {
          currentTotal: Number(pData.totalAvailable) || 0,
        });
      });

      let needsProcurement = false;
      const itemsSummary: OrderItemSummary[] = [];
      let subtotal = 0;
      let suitsCount = 0;

      input.items.forEach((item, idx) => {
        const vSnap = variantDocs[idx];
        if (!vSnap.exists()) {
          throw new Error(`Selected variant ${item.variant.sku} was not found.`);
        }
        const vData = vSnap.data();
        const available = Number(vData.stockAvailable) || 0;
        const reserved = Number(vData.stockReserved) || 0;

        if (available < item.quantity) {
          if (input.allowProcurementBackorder) {
            needsProcurement = true;
          } else {
            throw new Error(
              `Insufficient stock for ${item.product.name} (${item.variant.size} / ${item.variant.color}). Available: ${available}`
            );
          }
        }

        const basePrice = item.variant.sellingPrice || item.product.sellingPrice;
        const discountPct = item.product.discountPercent || 0;
        const unitPrice = Math.round(basePrice * (1 - discountPct / 100));
        const lineTotal = unitPrice * item.quantity;

        subtotal += lineTotal;
        suitsCount += item.quantity;

        itemsSummary.push({
          productId: item.product.id,
          variantId: item.variant.id,
          sku: item.variant.sku,
          productName: item.product.name,
          size: item.variant.size,
          color: item.variant.color,
          quantity: item.quantity,
          unitPrice,
          lineTotal,
        });

        // Reserve stock if available
        if (available >= item.quantity) {
          tx.update(doc(db, 'product_variants', item.variant.id), {
            stockAvailable: available - item.quantity,
            stockReserved: reserved + item.quantity,
            updatedAt: now,
          });
          const pEntry = productMap.get(item.product.id);
          if (pEntry) {
            pEntry.currentTotal = Math.max(0, pEntry.currentTotal - item.quantity);
          }
        }
      });

      // Update product totalAvailable cache
      productMap.forEach((val, pid) => {
        tx.update(doc(db, 'products', pid), {
          totalAvailable: val.currentTotal,
          updatedAt: now,
        });
      });

      // Calculate discount & shipping
      let discountAmount = 0;
      if (appliedCoupon && subtotal >= (appliedCoupon.minOrderAmount || 0)) {
        discountAmount =
          appliedCoupon.discountType === 'PERCENT'
            ? Math.round((subtotal * appliedCoupon.discountValue) / 100)
            : Math.min(subtotal, appliedCoupon.discountValue);
      }
      const shipping =
        input.freeShippingThreshold > 0 && subtotal - discountAmount >= input.freeShippingThreshold
          ? 0
          : input.shippingCharges;
      const totalAmount = Math.max(1, subtotal - discountAmount + shipping);
      finalTotal = totalAmount;

      const orderStatus: OrderStatus = needsProcurement ? 'AWAITING_PURCHASE' : 'NEW';
      finalStatus = orderStatus;

      const paymentStatus =
        input.paymentMethod === 'BANK_TRANSFER' && input.transactionRef?.trim()
          ? 'PROOF_SUBMITTED'
          : 'PENDING';

      const statusHistory = [
        {
          status: orderStatus,
          note: needsProcurement
            ? 'Order created with insufficient own stock — queued for supplier procurement'
            : 'Order placed and stock reserved',
          actor: input.customerName,
          timestamp: now,
        },
      ];

      const orderPayload: Record<string, unknown> = {
        orderNumber,
        customerName: input.customerName.trim().slice(0, 120),
        customerPhone: input.customerPhone.trim().slice(0, 30),
        customerCity: input.customerCity.trim().slice(0, 80),
        customerAddress: input.customerAddress.trim().slice(0, 350),
        source: input.source,
        status: orderStatus,
        paymentMethod: input.paymentMethod,
        paymentStatus,
        subtotal,
        discountAmount,
        shippingCharges: shipping,
        totalAmount,
        suitsCount,
        itemsSummary,
        statusHistory,
        createdAt: now,
        updatedAt: now,
      };

      if (input.customerUid) orderPayload.customerUid = input.customerUid;
      if (input.salesmanId) orderPayload.salesmanId = input.salesmanId;
      if (input.salesmanName) orderPayload.salesmanName = input.salesmanName;
      if (input.referralCode) orderPayload.referralCode = input.referralCode;
      if (appliedCoupon) orderPayload.couponCode = appliedCoupon.code;
      if (input.notes) orderPayload.notes = input.notes.slice(0, 500);

      tx.set(doc(db, 'orders', orderNumber), orderPayload);

      tx.set(doc(db, 'order_tracking', orderNumber), {
        orderNumber,
        status: orderStatus,
        paymentStatus,
        city: input.customerCity.trim().slice(0, 80),
        totalAmount,
        statusHistory,
        updatedAt: now,
      });

      itemsSummary.forEach((line, idx) => {
        const lineDoc: Record<string, unknown> = {
          orderId: orderNumber,
          productId: line.productId,
          variantId: line.variantId,
          sku: line.sku,
          productName: line.productName,
          size: line.size,
          color: line.color,
          quantity: line.quantity,
          sellingPriceSnapshot: line.unitPrice,
          lineTotal: line.lineTotal,
        };
        if (input.customerUid) lineDoc.customerUid = input.customerUid;
        if (input.salesmanId) lineDoc.salesmanId = input.salesmanId;
        tx.set(doc(db, 'order_items', `${orderNumber}_${idx}`), lineDoc);

        if (!needsProcurement) {
          tx.set(doc(db, 'stock_movements', `${orderNumber}_res_${idx}`), {
            productId: line.productId,
            variantId: line.variantId,
            sku: line.sku,
            type: 'RESERVE',
            quantity: line.quantity,
            referenceId: orderNumber,
            note: `Reserved for order ${orderNumber}`,
            performedBy: input.customerUid || input.customerName.slice(0, 60),
            createdAt: now,
          });
        }
      });

      const paymentDoc: Record<string, unknown> = {
        orderId: orderNumber,
        orderNumber,
        method: input.paymentMethod,
        amount: totalAmount,
        transactionRef: (input.transactionRef || '').slice(0, 120),
        proofNote: (input.proofNote || '').slice(0, 500),
        status: 'PENDING',
        createdAt: now,
      };
      if (input.customerUid) paymentDoc.customerUid = input.customerUid;
      tx.set(doc(db, 'payments', `${orderNumber}_pay`), paymentDoc);
    });

    // Best-effort customer CRM record creation
    try {
      const custId = makeSafeId(input.customerPhone.replace(/\D/g, '') || `cust_${Date.now()}`);
      const custDoc: Record<string, unknown> = {
        name: input.customerName.trim().slice(0, 120),
        phone: input.customerPhone.trim().slice(0, 30),
        city: input.customerCity.trim().slice(0, 80),
        address: input.customerAddress.trim().slice(0, 350),
        segment: 'NEW',
        totalOrders: 1,
        totalSpent: finalTotal,
        createdAt: now,
        updatedAt: now,
      };
      if (input.customerUid) custDoc.uid = input.customerUid;
      if (input.salesmanId) custDoc.assignedSalesmanId = input.salesmanId;
      await setDoc(doc(db, 'customers', custId), custDoc, { merge: true });
    } catch {
      // Non-blocking for guest checkout
    }

    return { orderNumber, totalAmount: finalTotal, status: finalStatus };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Insufficient stock')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `orders/${orderNumber}`);
  }
}

export async function transitionOrderStatus(params: {
  order: Order;
  nextStatus: OrderStatus;
  actor: UserProfile;
  note?: string;
  courierCompany?: string;
  trackingNumber?: string;
}): Promise<void> {
  const { order, nextStatus, actor } = params;
  const allowed = ALLOWED_ORDER_TRANSITIONS[order.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new Error(`Invalid status transition from ${order.status} to ${nextStatus}.`);
  }

  const now = new Date().toISOString();
  const nextHistory = [
    ...(order.statusHistory || []),
    {
      status: nextStatus,
      note: params.note || `Moved to ${nextStatus}`,
      actor: actor.displayName || actor.email,
      timestamp: now,
    },
  ];

  try {
    // Handle FIFO deduction & financials when order moves to DISPATCHED or DELIVERED
    let computedCogs = 0;
    const shouldDeductFifo =
      (nextStatus === 'DISPATCHED' || nextStatus === 'DELIVERED') &&
      !['DISPATCHED', 'DELIVERED'].includes(order.status);

    if (shouldDeductFifo && ['OWNER', 'ADMIN'].includes(actor.role)) {
      for (const item of order.itemsSummary || []) {
        const batchesSnap = await getDocs(
          query(collection(db, 'inventory'), where('variantId', '==', item.variantId))
        );
        const sortedBatches = batchesSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<InventoryBatch, 'id'>) }))
          .filter((b) => b.remainingQty > 0)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        let needed = item.quantity;
        for (const batch of sortedBatches) {
          if (needed <= 0) break;
          const take = Math.min(needed, batch.remainingQty);
          computedCogs += take * batch.purchaseCost;
          needed -= take;
          await updateDoc(doc(db, 'inventory', batch.id), {
            remainingQty: batch.remainingQty - take,
          });
        }

        // Deduct variant reserved stock
        const vSnap = await getDoc(doc(db, 'product_variants', item.variantId));
        if (vSnap.exists()) {
          const v = vSnap.data();
          await updateDoc(doc(db, 'product_variants', item.variantId), {
            stockReserved: Math.max(0, (Number(v.stockReserved) || 0) - item.quantity),
            updatedAt: now,
          });
        }

        await setDoc(doc(db, 'stock_movements', makeSafeId(`mov_${order.id}_${item.variantId}_${Date.now()}`)), {
          productId: item.productId,
          variantId: item.variantId,
          sku: item.sku,
          type: 'DEDUCT',
          quantity: item.quantity,
          unitCost: item.quantity > 0 ? Math.round(computedCogs / item.quantity) : 0,
          referenceId: order.orderNumber,
          note: `Fulfilled order ${order.orderNumber} (${nextStatus})`,
          performedBy: actor.uid,
          createdAt: now,
        });
      }

      const revenue = Math.max(0, order.subtotal - order.discountAmount);
      const grossProfit = revenue - computedCogs;
      await setDoc(doc(db, 'order_financials', order.id), {
        orderId: order.id,
        orderNumber: order.orderNumber,
        revenue,
        discount: order.discountAmount,
        shippingCharged: order.shippingCharges,
        cogsTotal: computedCogs,
        grossProfit,
        status: nextStatus,
        createdAt: order.createdAt,
        updatedAt: now,
      });
    } else if (shouldDeductFifo) {
      // Packing staff dispatching: still release stockReserved and log movement
      for (const item of order.itemsSummary || []) {
        const vSnap = await getDoc(doc(db, 'product_variants', item.variantId));
        if (vSnap.exists()) {
          const v = vSnap.data();
          await updateDoc(doc(db, 'product_variants', item.variantId), {
            stockReserved: Math.max(0, (Number(v.stockReserved) || 0) - item.quantity),
            updatedAt: now,
          });
        }
        await setDoc(doc(db, 'stock_movements', makeSafeId(`mov_${order.id}_${item.variantId}_${Date.now()}`)), {
          productId: item.productId,
          variantId: item.variantId,
          sku: item.sku,
          type: 'DEDUCT',
          quantity: item.quantity,
          referenceId: order.orderNumber,
          note: `Dispatched order ${order.orderNumber}`,
          performedBy: actor.uid,
          createdAt: now,
        });
      }
    }

    // Release reserved stock if cancelled before dispatch
    if (nextStatus === 'CANCELLED' && !['DISPATCHED', 'DELIVERED'].includes(order.status)) {
      for (const item of order.itemsSummary || []) {
        const vSnap = await getDoc(doc(db, 'product_variants', item.variantId));
        if (vSnap.exists()) {
          const v = vSnap.data();
          const newReserved = Math.max(0, (Number(v.stockReserved) || 0) - item.quantity);
          const newAvail = (Number(v.stockAvailable) || 0) + item.quantity;
          await updateDoc(doc(db, 'product_variants', item.variantId), {
            stockReserved: newReserved,
            stockAvailable: newAvail,
            updatedAt: now,
          });
        }
        const pSnap = await getDoc(doc(db, 'products', item.productId));
        if (pSnap.exists()) {
          await updateDoc(doc(db, 'products', item.productId), {
            totalAvailable: (Number(pSnap.data().totalAvailable) || 0) + item.quantity,
            updatedAt: now,
          });
        }
        await setDoc(doc(db, 'stock_movements', makeSafeId(`rel_${order.id}_${item.variantId}_${Date.now()}`)), {
          productId: item.productId,
          variantId: item.variantId,
          sku: item.sku,
          type: 'RELEASE',
          quantity: item.quantity,
          referenceId: order.orderNumber,
          note: `Released reserved stock for cancelled order ${order.orderNumber}`,
          performedBy: actor.uid,
          createdAt: now,
        });
      }
    }

    // Update order & public tracking
    const orderUpdate: Record<string, unknown> = {
      status: nextStatus,
      statusHistory: nextHistory,
      updatedAt: now,
    };
    if (params.courierCompany) orderUpdate.courierCompany = params.courierCompany;
    if (params.trackingNumber) orderUpdate.trackingNumber = params.trackingNumber;

    await updateDoc(doc(db, 'orders', order.id), orderUpdate);

    const trackUpdate: Record<string, unknown> = {
      orderNumber: order.orderNumber,
      status: nextStatus,
      paymentStatus: order.paymentStatus,
      statusHistory: nextHistory,
      updatedAt: now,
    };
    if (params.courierCompany || order.courierCompany) {
      trackUpdate.courierCompany = params.courierCompany || order.courierCompany;
    }
    if (params.trackingNumber || order.trackingNumber) {
      trackUpdate.trackingNumber = params.trackingNumber || order.trackingNumber;
    }
    await setDoc(doc(db, 'order_tracking', order.orderNumber), trackUpdate, { merge: true });

    // Salesman target & bonus attribution ONLY on DELIVERED (prevent duplicate attribution!)
    let effectiveSalesmanId = order.salesmanId;
    if (nextStatus === 'DELIVERED' && !effectiveSalesmanId && order.referralCode && ['OWNER', 'ADMIN'].includes(actor.role)) {
      const refSnap = await getDocs(
        query(collection(db, 'salesmen'), where('referralCode', '==', order.referralCode))
      );
      if (!refSnap.empty) {
        effectiveSalesmanId = refSnap.docs[0].id;
        await updateDoc(doc(db, 'orders', order.id), {
          salesmanId: effectiveSalesmanId,
          salesmanName: String(refSnap.docs[0].data().name || ''),
        });
      }
    }

    if (nextStatus === 'DELIVERED' && effectiveSalesmanId && ['OWNER', 'ADMIN'].includes(actor.role)) {
      const monthKey = currentMonthKey(new Date(order.createdAt || now));
      const commId = makeSafeId(`comm_${order.id}`);
      const existingComm = await getDoc(doc(db, 'commissions', commId));
      if (!existingComm.exists()) {
        const salesmanSnap = await getDoc(doc(db, 'salesmen', effectiveSalesmanId));
        const salesmanData = salesmanSnap.exists()
          ? (salesmanSnap.data() as SalesmanProfile)
          : null;
        const targetId = makeSafeId(`${effectiveSalesmanId}_${monthKey}`);
        const targetRef = doc(db, 'sales_targets', targetId);
        const targetSnap = await getDoc(targetRef);

        const prevSuits = targetSnap.exists() ? Number(targetSnap.data().deliveredSuits) || 0 : 0;
        const prevRev = targetSnap.exists() ? Number(targetSnap.data().deliveredRevenue) || 0 : 0;
        const newSuits = prevSuits + (order.suitsCount || 1);
        const newRev = prevRev + Math.max(0, order.subtotal - order.discountAmount);
        const tiers = salesmanData?.bonusTiers || DEFAULT_BONUS_TIERS;
        const prevBonus = calculateBonusForSuits(prevSuits, tiers);
        const newBonus = calculateBonusForSuits(newSuits, tiers);
        const incrementalBonus = Math.max(0, newBonus - prevBonus);

        await setDoc(targetRef, {
          salesmanId: effectiveSalesmanId,
          monthKey,
          targetSuits: salesmanData?.monthlyTargetSuits || 60,
          deliveredSuits: newSuits,
          deliveredRevenue: newRev,
          bonusEarned: newBonus,
          updatedAt: now,
        });

        await setDoc(doc(db, 'commissions', commId), {
          salesmanId: effectiveSalesmanId,
          orderId: order.id,
          orderNumber: order.orderNumber,
          monthKey,
          suitsCount: order.suitsCount || 1,
          amount: incrementalBonus,
          type: incrementalBonus > 0 ? 'TIER_BONUS' : 'ORDER_DELIVERED',
          status: 'EARNED',
          createdAt: now,
        });
      }
    }

    await logAuditEvent({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: `ORDER_STATUS_${nextStatus}`,
      entityType: 'orders',
      entityId: order.id,
      details: `Order ${order.orderNumber} transitioned ${order.status} -> ${nextStatus}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${order.id}`);
  }
}

export async function receivePurchaseOrderAtomic(params: {
  po: PurchaseOrder;
  items: PurchaseItem[];
  supplier: Supplier;
  actor: UserProfile;
}): Promise<void> {
  const { po, items, supplier, actor } = params;
  const now = new Date().toISOString();

  try {
    await runTransaction(db, async (tx) => {
      const variantSnaps = await Promise.all(
        items.map((it) => tx.get(doc(db, 'product_variants', it.variantId)))
      );
      const uniquePids = Array.from(new Set(items.map((i) => i.productId)));
      const productSnaps = await Promise.all(
        uniquePids.map((pid) => tx.get(doc(db, 'products', pid)))
      );

      const productTotals = new Map<string, number>();
      productSnaps.forEach((snap, idx) => {
        productTotals.set(uniquePids[idx], snap.exists() ? Number(snap.data().totalAvailable) || 0 : 0);
      });

      items.forEach((item, idx) => {
        const qtyToReceive = Math.max(0, item.orderedQty - item.receivedQty);
        if (qtyToReceive <= 0) return;

        const batchId = makeSafeId(`bat_${po.poNumber}_${idx}_${Date.now()}`);
        tx.set(doc(db, 'inventory', batchId), {
          productId: item.productId,
          variantId: item.variantId,
          sku: item.sku || '',
          batchCode: po.poNumber,
          purchaseCost: item.unitCost,
          initialQty: qtyToReceive,
          remainingQty: qtyToReceive,
          reservedQty: 0,
          supplierId: supplier.id,
          purchaseOrderId: po.id,
          warehouseLocation: 'Main Warehouse',
          receivedAt: now,
          createdAt: now,
        });

        const vSnap = variantSnaps[idx];
        if (vSnap.exists()) {
          const curAvail = Number(vSnap.data().stockAvailable) || 0;
          tx.update(doc(db, 'product_variants', item.variantId), {
            stockAvailable: curAvail + qtyToReceive,
            updatedAt: now,
          });
        }

        productTotals.set(item.productId, (productTotals.get(item.productId) || 0) + qtyToReceive);

        tx.update(doc(db, 'purchase_items', item.id), {
          receivedQty: item.orderedQty,
        });

        tx.set(doc(db, 'stock_movements', makeSafeId(`rec_${po.poNumber}_${idx}_${Date.now()}`)), {
          productId: item.productId,
          variantId: item.variantId,
          sku: item.sku || '',
          type: 'RECEIPT',
          quantity: qtyToReceive,
          unitCost: item.unitCost,
          referenceId: po.poNumber,
          note: `Received from ${supplier.name} (${po.poNumber})`,
          performedBy: actor.uid,
          createdAt: now,
        });
      });

      productTotals.forEach((total, pid) => {
        tx.update(doc(db, 'products', pid), {
          totalAvailable: total,
          updatedAt: now,
        });
      });

      tx.update(doc(db, 'purchase_orders', po.id), {
        status: 'RECEIVED',
        updatedAt: now,
      });

      tx.update(doc(db, 'suppliers', supplier.id), {
        totalPurchased: (supplier.totalPurchased || 0) + po.totalCost,
        outstandingPayable: (supplier.outstandingPayable || 0) + (po.totalCost - (po.paidAmount || 0)),
        updatedAt: now,
      });
    });

    await logAuditEvent({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'RECEIVE_PURCHASE_ORDER',
      entityType: 'purchase_orders',
      entityId: po.id,
      details: `Received ${po.poNumber} from ${supplier.name} (PKR ${po.totalCost})`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `purchase_orders/${po.id}`);
  }
}

export async function seedDevelopmentData(actor: UserProfile): Promise<void> {
  if (!import.meta.env.DEV) {
    throw new Error('Development seed tool cannot run in production.');
  }
  const now = new Date().toISOString();
  const batch = writeBatch(db);

  // 1. Settings
  const settings: BusinessSettings = {
    ...DEFAULT_BUSINESS_SETTINGS,
    brandName: 'Zayr & Loom',
    tagline: 'Pakistani Embroidered Lawn, Tailored Shalwar Kameez & Festive Pret',
    contactEmail: actor.email,
    phone: '+92 300 4128890',
    whatsappNumber: '923004128890',
    address: 'Plot 42-B, Gulberg III Textile District, Lahore, Pakistan',
    bankDetails: 'Meezan Bank — Account Title: Zayr & Loom Apparel | IBAN: PK12MEZN0002140104829104 | JazzCash/Easypaisa: 0300-4128890',
    setupCompleted: true,
    updatedAt: now,
  };
  batch.set(doc(db, 'settings', 'business'), settings);

  // 2. Categories
  const categories: Category[] = [
    { id: 'cat_lawn', name: 'Embroidered Lawn', slug: 'embroidered-lawn', audience: 'Ladies', description: '3-piece breathable cotton lawn with organza & chiffon dupattas', active: true, sortOrder: 1, createdAt: now },
    { id: 'cat_festive', name: 'Festive & Raw Silk', slug: 'festive-raw-silk', audience: 'Ladies', description: 'Formal zari and resham embroidered raw silk ensembles', active: true, sortOrder: 2, createdAt: now },
    { id: 'cat_gents', name: 'Gents Shalwar Kameez', slug: 'gents-shalwar-kameez', audience: 'Gents', description: 'Egyptian cotton & wash-and-wear tailored suits', active: true, sortOrder: 3, createdAt: now },
  ];
  categories.forEach((c) => batch.set(doc(db, 'categories', c.id), c));

  // 3. Products & Variants & FIFO Batches
  const productsSeed = [
    {
      id: 'prod_safa_lawn',
      name: 'Safa Ivory & Sage 3-Piece Lawn',
      sku: 'ZL-LWN-101',
      categoryId: 'cat_lawn',
      categoryName: 'Embroidered Lawn',
      audience: 'Ladies' as const,
      fabric: 'Swiss Voile Cotton Lawn · Embroidered Organza Dupatta',
      description: 'Three-piece breathable Swiss cotton lawn ensemble featuring delicate sage paisley resham embroidery on ivory base, paired with a scalloped organza dupatta and dyed cambric trouser.',
      sellingPrice: 4850,
      discountPercent: 10,
      featured: true,
      images: ['/src/assets/images/product_ladies_lawn_1795026585565.jpg', '/src/assets/images/hero_pakistani_atelier_1795026585328.jpg'],
      sizes: ['Unstitched', 'S', 'M', 'L'],
      colors: ['Ivory Sage'],
      purchaseCost: 2300,
      qtyPerVariant: 15,
    },
    {
      id: 'prod_zoya_emerald',
      name: 'Zoya Emerald Zari Raw Silk',
      sku: 'ZL-SLK-204',
      categoryId: 'cat_festive',
      categoryName: 'Festive & Raw Silk',
      audience: 'Ladies' as const,
      fabric: 'Pure Medium Raw Silk · Antique Tilla & Zari',
      description: 'Formal forest emerald raw silk shirt with intricate antique gold zari motif along the neckline and hem, accompanied by a hand-finished organza dupatta.',
      sellingPrice: 8900,
      discountPercent: 0,
      featured: true,
      images: ['/src/assets/images/product_festive_silk_1795026586489.jpg', '/src/assets/images/hero_pakistani_atelier_1795026585328.jpg'],
      sizes: ['S', 'M', 'L'],
      colors: ['Forest Emerald'],
      purchaseCost: 4400,
      qtyPerVariant: 10,
    },
    {
      id: 'prod_humayun_cotton',
      name: 'Humayun Charcoal Egyptian Cotton Suit',
      sku: 'ZL-GNT-301',
      categoryId: 'cat_gents',
      categoryName: 'Gents Shalwar Kameez',
      audience: 'Gents' as const,
      fabric: '100% Giza Egyptian Cotton · Contrast Stitch Collar',
      description: 'Tailored two-piece gents shalwar kameez woven from breathable long-staple Egyptian cotton with crisp contrast top-stitching on the ban collar and placket.',
      sellingPrice: 3600,
      discountPercent: 0,
      featured: true,
      images: ['/src/assets/images/product_gents_shalwar_1795026587658.jpg'],
      sizes: ['M', 'L', 'XL'],
      colors: ['Charcoal', 'Warm Stone'],
      purchaseCost: 1650,
      qtyPerVariant: 18,
    },
    {
      id: 'prod_noor_atelier',
      name: 'Noor Gulberg Festive Chiffon Set',
      sku: 'ZL-SLK-209',
      categoryId: 'cat_festive',
      categoryName: 'Festive & Raw Silk',
      audience: 'Ladies' as const,
      fabric: 'Crinkle Chiffon · Silk Lining Included',
      description: 'Evening festive ensemble crafted in deep jewel tones with traditional hand-worked mukesh and gotta border accents.',
      sellingPrice: 7400,
      discountPercent: 5,
      featured: false,
      images: ['/src/assets/images/hero_pakistani_atelier_1795026585328.jpg', '/src/assets/images/product_festive_silk_1795026586489.jpg'],
      sizes: ['S', 'M', 'L'],
      colors: ['Emerald Gold'],
      purchaseCost: 3700,
      qtyPerVariant: 8,
    },
    {
      id: 'prod_karigar_khaddar',
      name: 'Multan Karigar Handloom Suit',
      sku: 'ZL-LWN-112',
      categoryId: 'cat_lawn',
      categoryName: 'Embroidered Lawn',
      audience: 'Ladies' as const,
      fabric: 'Artisan Hand-Embroidered Cotton',
      description: 'Inspired by southern Punjab handloom heritage, featuring rich geometric threadwork on soft breathable cotton.',
      sellingPrice: 3400,
      discountPercent: 0,
      featured: false,
      images: ['/src/assets/images/craftsmanship_loom_1795026586550.jpg', '/src/assets/images/product_ladies_lawn_1795026585565.jpg'],
      sizes: ['Unstitched', 'M', 'L'],
      colors: ['Indigo Earth'],
      purchaseCost: 1500,
      qtyPerVariant: 14,
    },
    {
      id: 'prod_mirza_stone',
      name: 'Mirza Classic Stone Wash & Wear',
      sku: 'ZL-GNT-308',
      categoryId: 'cat_gents',
      categoryName: 'Gents Shalwar Kameez',
      audience: 'Gents' as const,
      fabric: 'All-Season Microfiber Boski Finish',
      description: 'Wrinkle-resistant gents daily and Friday wear shalwar kameez in warm sandstone with horn buttons and relaxed straight cut.',
      sellingPrice: 3000,
      discountPercent: 0,
      featured: false,
      images: ['/src/assets/images/product_gents_shalwar_1795026587658.jpg'],
      sizes: ['M', 'L', 'XL'],
      colors: ['Warm Stone'],
      purchaseCost: 1500,
      qtyPerVariant: 20,
    },
  ];

  // 4. Suppliers
  const sup1: Supplier = {
    id: 'sup_faisalabad_mills',
    name: 'Chenab Looms & Mills',
    contactPerson: 'Haji Tariq Mahmood',
    phone: '+92 321 8664411',
    email: 'orders@chenablooms.pk',
    city: 'Faisalabad',
    address: 'Millat Road Textile Zone, Faisalabad',
    catalogSummary: 'Swiss Lawn, Egyptian Cotton, Cambric & Dyed Fabrics',
    totalPurchased: 185000,
    totalPaid: 140000,
    outstandingPayable: 45000,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  const sup2: Supplier = {
    id: 'sup_lahore_zari',
    name: 'Anarkali Zari Craft Workshop',
    contactPerson: 'Ustad Saleem Raza',
    phone: '+92 333 4291100',
    email: 'workshop@anarkalizari.pk',
    city: 'Lahore',
    address: 'Ichhra Embroidery Market, Lahore',
    catalogSummary: 'Raw Silk Festive Suits, Tilla & Organza Dupattas',
    totalPurchased: 96000,
    totalPaid: 96000,
    outstandingPayable: 0,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  batch.set(doc(db, 'suppliers', sup1.id), sup1);
  batch.set(doc(db, 'suppliers', sup2.id), sup2);

  for (const p of productsSeed) {
    let totalAvailable = 0;
    p.sizes.forEach((sz, sIdx) => {
      p.colors.forEach((col, cIdx) => {
        const varId = makeSafeId(`${p.id}_${sz}_${col}`);
        const varSku = `${p.sku}-${sz.slice(0, 2).toUpperCase()}-${cIdx + 1}`;
        totalAvailable += p.qtyPerVariant;
        batch.set(doc(db, 'product_variants', varId), {
          productId: p.id,
          sku: varSku,
          size: sz,
          color: col,
          sellingPrice: p.sellingPrice,
          stockAvailable: p.qtyPerVariant,
          stockReserved: 0,
          active: true,
          updatedAt: now,
        });
        batch.set(doc(db, 'inventory', makeSafeId(`bat_${varId}_init`)), {
          productId: p.id,
          variantId: varId,
          sku: varSku,
          batchCode: `INIT-${p.sku}-${sIdx + 1}`,
          purchaseCost: p.purchaseCost,
          initialQty: p.qtyPerVariant,
          remainingQty: p.qtyPerVariant,
          reservedQty: 0,
          supplierId: p.audience === 'Gents' ? sup1.id : sup2.id,
          warehouseLocation: 'Lahore Main Warehouse',
          receivedAt: now,
          createdAt: now,
        });
      });
    });

    batch.set(doc(db, 'products', p.id), {
      name: p.name,
      slug: slugify(p.name),
      sku: p.sku,
      categoryId: p.categoryId,
      categoryName: p.categoryName,
      audience: p.audience,
      description: p.description,
      fabric: p.fabric,
      sellingPrice: p.sellingPrice,
      discountPercent: p.discountPercent,
      active: true,
      featured: p.featured,
      images: p.images,
      sizes: p.sizes,
      colors: p.colors,
      totalAvailable,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 5. Coupons & Campaigns
  batch.set(doc(db, 'coupons', 'EID10'), {
    code: 'EID10',
    discountType: 'PERCENT',
    discountValue: 10,
    minOrderAmount: 3000,
    maxUses: 200,
    usedCount: 0,
    active: true,
    createdAt: now,
  });
  batch.set(doc(db, 'coupons', 'WELCOME500'), {
    code: 'WELCOME500',
    discountType: 'FIXED',
    discountValue: 500,
    minOrderAmount: 4000,
    maxUses: 100,
    usedCount: 0,
    active: true,
    createdAt: now,
  });

  batch.set(doc(db, 'campaigns', 'camp_lawn_fb'), {
    name: 'Summer Lawn Collection Launch',
    channel: 'FACEBOOK',
    utmCode: 'fb_summer_lawn',
    budget: 25000,
    active: true,
    createdAt: now,
  });
  batch.set(doc(db, 'campaigns', 'camp_gents_ig'), {
    name: 'Gents Friday Egyptian Cotton',
    channel: 'INSTAGRAM',
    utmCode: 'ig_gents_cotton',
    budget: 15000,
    active: true,
    createdAt: now,
  });

  // 6. Sample Salesman profile (owner can also test salesman attribution)
  batch.set(doc(db, 'salesmen', actor.uid), {
    uid: actor.uid,
    name: actor.displayName || 'Lead Salesman',
    email: actor.email,
    phone: '+92 300 4128890',
    referralCode: 'ZAYR01',
    monthlySalary: 40000,
    monthlyTargetSuits: 60,
    avgPurchasePrice: 1500,
    avgSellingPrice: 3000,
    bonusTiers: DEFAULT_BONUS_TIERS,
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  // 7. Sample PO (REQUESTED) so procurement workflow is immediately testable
  const poId = makeSafeId(`po_dev_${Date.now()}`);
  const poNumber = generatePoNumber();
  batch.set(doc(db, 'purchase_orders', poId), {
    poNumber,
    supplierId: sup1.id,
    supplierName: sup1.name,
    status: 'REQUESTED',
    totalCost: 30000,
    paidAmount: 0,
    notes: 'Replenishment batch for Mirza Classic Stone Wash & Wear',
    requestedBy: actor.uid,
    createdAt: now,
    updatedAt: now,
  });
  batch.set(doc(db, 'purchase_items', makeSafeId(`poi_${poId}_1`)), {
    poId,
    productId: 'prod_mirza_stone',
    variantId: makeSafeId('prod_mirza_stone_L_Warm Stone'),
    sku: 'ZL-GNT-308-L-1',
    productName: 'Mirza Classic Stone Wash & Wear (L / Warm Stone)',
    orderedQty: 20,
    receivedQty: 0,
    unitCost: 1500,
    lineTotal: 30000,
  });

  // 8. Sample Expenses
  batch.set(doc(db, 'expenses', makeSafeId(`exp_pkg_${Date.now()}`)), {
    category: 'PACKAGING',
    description: 'Branded kraft garment boxes & tissue wraps (500 units)',
    amount: 12500,
    expenseDate: now.slice(0, 10),
    recordedBy: actor.uid,
    createdAt: now,
  });

  try {
    await batch.commit();
    await logAuditEvent({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'DEV_SEED_DATA',
      entityType: 'system',
      entityId: 'seed',
      details: 'Populated development-only Pakistani clothing business dataset',
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'dev_seed');
  }
}
