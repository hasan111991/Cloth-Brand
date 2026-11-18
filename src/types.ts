export type UserRole =
  | 'OWNER'
  | 'ADMIN'
  | 'SALES_MANAGER'
  | 'SALESMAN'
  | 'INVENTORY_MANAGER'
  | 'PACKING_STAFF'
  | 'CUSTOMER';

export type AudienceType = 'Ladies' | 'Gents' | 'Both';

export type OrderSource = 'WEBSITE' | 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM' | 'DIRECT';

export type OrderStatus =
  | 'NEW'
  | 'CONFIRMED'
  | 'AWAITING_PURCHASE'
  | 'PROCESSING'
  | 'PACKED'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURNED'
  | 'REFUNDED';

export type PaymentMethod = 'COD' | 'BANK_TRANSFER';

export type PaymentStatus =
  | 'PENDING'
  | 'PROOF_SUBMITTED'
  | 'VERIFIED'
  | 'COD_EXPECTED'
  | 'COD_COLLECTED'
  | 'RECONCILED'
  | 'REFUNDED';

export type PurchaseOrderStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'ORDERED'
  | 'PARTIAL_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED';

export interface BonusTier {
  suits: number;
  bonus: number;
}

export interface SalesmanDefaults {
  monthlySalary: number;
  monthlyTargetSuits: number;
  avgPurchasePrice: number;
  avgSellingPrice: number;
  bonusTiers: BonusTier[];
}

export interface BusinessSettings {
  brandName: string;
  tagline: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  audienceType: AudienceType;
  contactEmail: string;
  phone: string;
  whatsappNumber: string;
  address: string;
  deliveryCoverage: string;
  courierProviders: string[];
  returnPolicy: string;
  shippingPolicy: string;
  privacyPolicy: string;
  termsPolicy: string;
  aboutText: string;
  shippingCharges: number;
  freeShippingThreshold: number;
  paymentMethods: PaymentMethod[];
  bankDetails: string;
  currency: 'PKR';
  setupCompleted: boolean;
  salesmanDefaults: SalesmanDefaults;
  updatedAt: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  city?: string;
  address?: string;
  role: UserRole;
  active: boolean;
  baseSalary?: number;
  salesmanId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StaffInvite {
  id: string;
  email: string;
  displayName?: string;
  role: Exclude<UserRole, 'OWNER' | 'CUSTOMER'>;
  baseSalary?: number;
  monthlyTargetSuits?: number;
  claimed: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  audience: AudienceType;
  description?: string;
  active: boolean;
  sortOrder?: number;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  sku: string;
  categoryId: string;
  categoryName?: string;
  audience: AudienceType;
  description?: string;
  fabric?: string;
  sellingPrice: number;
  discountPercent?: number;
  active: boolean;
  featured?: boolean;
  images: string[];
  sizes: string[];
  colors: string[];
  totalAvailable?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  size: string;
  color: string;
  sellingPrice?: number;
  stockAvailable: number;
  stockReserved: number;
  active: boolean;
  updatedAt: string;
}

export interface InventoryBatch {
  id: string;
  productId: string;
  variantId: string;
  sku: string;
  batchCode?: string;
  purchaseCost: number;
  initialQty: number;
  remainingQty: number;
  reservedQty: number;
  supplierId?: string;
  purchaseOrderId?: string;
  warehouseLocation?: string;
  receivedAt?: string;
  createdAt: string;
}

export interface StockMovement {
  id: string;
  productId: string;
  variantId: string;
  sku?: string;
  type: 'RECEIPT' | 'RESERVE' | 'RELEASE' | 'DEDUCT' | 'RETURN' | 'ADJUSTMENT';
  quantity: number;
  unitCost?: number;
  referenceId?: string;
  note?: string;
  performedBy: string;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  city?: string;
  address?: string;
  catalogSummary?: string;
  totalPurchased: number;
  totalPaid: number;
  outstandingPayable: number;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName?: string;
  status: PurchaseOrderStatus;
  totalCost: number;
  paidAmount: number;
  linkedOrderId?: string;
  notes?: string;
  requestedBy: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseItem {
  id: string;
  poId: string;
  productId: string;
  variantId: string;
  sku?: string;
  productName?: string;
  orderedQty: number;
  receivedQty: number;
  unitCost: number;
  lineTotal: number;
}

export interface Customer {
  id: string;
  uid?: string;
  name: string;
  phone: string;
  email?: string;
  city: string;
  address?: string;
  segment: 'NEW' | 'REPEAT' | 'VIP' | 'INACTIVE';
  assignedSalesmanId?: string;
  totalOrders: number;
  totalSpent: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItemSummary {
  productId: string;
  variantId: string;
  sku: string;
  productName: string;
  size: string;
  color: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface OrderStatusEntry {
  status: OrderStatus;
  note: string;
  actor: string;
  timestamp: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerUid?: string;
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerAddress: string;
  salesmanId?: string;
  salesmanName?: string;
  referralCode?: string;
  source: OrderSource;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  courierCompany?: string;
  trackingNumber?: string;
  couponCode?: string;
  subtotal: number;
  discountAmount: number;
  shippingCharges: number;
  totalAmount: number;
  suitsCount: number;
  itemsSummary: OrderItemSummary[];
  statusHistory: OrderStatusEntry[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderTracking {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  courierCompany?: string;
  trackingNumber?: string;
  city?: string;
  totalAmount?: number;
  statusHistory?: OrderStatusEntry[];
  updatedAt: string;
}

export interface OrderFinancial {
  id: string;
  orderId: string;
  orderNumber: string;
  revenue: number;
  discount?: number;
  shippingCharged?: number;
  cogsTotal: number;
  grossProfit: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  customerUid?: string;
  method: PaymentMethod;
  amount: number;
  transactionRef?: string;
  proofNote?: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'RECONCILED';
  verifiedBy?: string;
  verifiedAt?: string;
  createdAt: string;
}

export interface ShipmentRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  courierCompany: string;
  shipmentNumber?: string;
  trackingNumber: string;
  dispatchDate?: string;
  expectedDeliveryDate?: string;
  shippingCharges?: number;
  codAmount?: number;
  deliveryStatus: 'BOOKED' | 'IN_TRANSIT' | 'DELIVERED' | 'RETURNED' | 'FAILED';
  codRemitted: boolean;
  remittedAmount?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface ReturnRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  reason: string;
  refundAmount: number;
  restocked?: boolean;
  status: 'REQUESTED' | 'APPROVED' | 'RECEIVED' | 'REFUNDED' | 'REJECTED';
  processedBy?: string;
  createdAt: string;
}

export interface SalesmanProfile {
  id: string;
  uid: string;
  name: string;
  email?: string;
  phone?: string;
  referralCode: string;
  monthlySalary: number;
  monthlyTargetSuits: number;
  avgPurchasePrice?: number;
  avgSellingPrice?: number;
  bonusTiers: BonusTier[];
  active: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface SalesTarget {
  id: string;
  salesmanId: string;
  monthKey: string;
  targetSuits: number;
  deliveredSuits: number;
  deliveredRevenue?: number;
  bonusEarned: number;
  updatedAt: string;
}

export interface CommissionRecord {
  id: string;
  salesmanId: string;
  orderId: string;
  orderNumber?: string;
  monthKey: string;
  suitsCount?: number;
  amount: number;
  type?: 'ORDER_DELIVERED' | 'TIER_BONUS';
  status: 'EARNED' | 'APPROVED' | 'PAID';
  createdAt: string;
}

export interface ExpenseRecord {
  id: string;
  category: 'MARKETING' | 'PACKAGING' | 'COURIER' | 'RENT' | 'UTILITIES' | 'OPERATING' | 'OTHER';
  description: string;
  amount: number;
  expenseDate: string;
  recordedBy: string;
  createdAt: string;
}

export interface SalaryRecord {
  id: string;
  employeeUid: string;
  employeeName: string;
  role: string;
  monthKey: string;
  baseSalary: number;
  bonusAmount?: number;
  deductions?: number;
  netPaid: number;
  status: 'PENDING' | 'PAID';
  paidDate?: string;
  createdAt: string;
}

export interface Coupon {
  id: string;
  code: string;
  discountType: 'PERCENT' | 'FIXED';
  discountValue: number;
  minOrderAmount?: number;
  maxUses?: number;
  usedCount?: number;
  active: boolean;
  createdAt: string;
}

export interface Review {
  id: string;
  productId: string;
  customerUid?: string;
  customerName: string;
  rating: number;
  comment: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}

export interface Lead {
  id: string;
  salesmanId: string;
  customerName: string;
  phone: string;
  source: 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM' | 'DIRECT';
  interestedProduct?: string;
  status: 'NEW' | 'CONTACTED' | 'FOLLOW_UP' | 'CONVERTED' | 'LOST';
  notes?: string;
  nextFollowUp?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Campaign {
  id: string;
  name: string;
  channel: 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM' | 'WEBSITE';
  utmCode: string;
  budget?: number;
  active: boolean;
  createdAt: string;
}

export interface AbandonedCart {
  id: string;
  customerName?: string;
  customerPhone: string;
  itemsCount: number;
  totalValue: number;
  recovered: boolean;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: string;
  createdAt: string;
}

export interface CartItem {
  product: Product;
  variant: ProductVariant;
  quantity: number;
}
